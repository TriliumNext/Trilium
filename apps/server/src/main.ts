/*
 * Make sure not to import any modules that depend on localized messages via i18next here, as the initializations
 * are loaded later and will result in an empty string.
 */

import { getLog, initializeCore, options, sql_init } from "@triliumnext/core";
import fs from "fs";
import { t } from "i18next";
import path from "path";

import ServerBackupService from "./backup_provider.js";
import ClsHookedExecutionContext from "./cls_provider.js";
import { loadCoreSchema } from "./core_assets.js";
import NodejsCryptoProvider from "./crypto_provider.js";
import NodejsInAppHelpProvider from "./in_app_help_provider.js";
import ServerLogService from "./log_provider.js";
import ServerPlatformProvider from "./platform_provider.js";
import dataDirs from "./services/data_dir.js";
import port from "./services/port.js";
import NodeRequestProvider from "./services/request.js";
import { RESOURCE_DIR } from "./services/resource_dir.js";
import WebSocketMessagingProvider from "./services/ws_messaging_provider.js";
import BetterSqlite3Provider from "./sql_provider.js";
import NodejsZipProvider from "./zip_provider.js";

async function startApplication() {
    const config = (await import("./services/config.js")).default;
    const { DOCUMENT_PATH } = (await import("./services/data_dir.js")).default;

    const dbProvider = new BetterSqlite3Provider();
    if (process.env.TRILIUM_INTEGRATION_TEST === "memory") {
        // Load the database file into memory so mutations don't persist to
        // disk between test runs. The fixture is provided externally (e.g.
        // copied into the data dir by CI or the Playwright config).
        dbProvider.loadFromBuffer(fs.readFileSync(DOCUMENT_PATH));
    } else {
        dbProvider.loadFromFile(DOCUMENT_PATH, config.General.readOnly);
    }

    const logService = new ServerLogService();

    await initializeCore({
        dbConfig: {
            provider: dbProvider,
            isReadOnly: config.General.readOnly,
            onTransactionCommit() {
                // Core types these hooks as synchronous (() => void) and invokes them without
                // awaiting, so the dynamic import must stay fire-and-forget rather than async.
                void import("@triliumnext/core").then(({ ws }) => {
                    ws.sendTransactionEntityChangesToAllClients();
                });
            },
            onTransactionRollback() {
                void import("@triliumnext/core").then(({ cls, becca_loader, entity_changes }) => {
                    const entityChangeIds = cls.getAndClearEntityChangeIds();

                    if (entityChangeIds.length > 0) {
                        logService.info("Transaction rollback dirtied the becca, forcing reload.");

                        becca_loader.load();
                    }

                    // the maxEntityChangeId has been incremented during failed transaction, need to recalculate
                    entity_changes.recalculateMaxEntityChangeId();
                });
            }
        },
        crypto: new NodejsCryptoProvider(),
        zip: new NodejsZipProvider(),
        zipExportProviderFactory: (await import("./services/export/zip/factory.js")).serverZipExportProviderFactory,
        request: new NodeRequestProvider(),
        executionContext: new ClsHookedExecutionContext(),
        messaging: new WebSocketMessagingProvider(),
        schema: loadCoreSchema(),
        platform: new ServerPlatformProvider(),
        log: logService,
        translations: (await import("./services/i18n.js")).initializeTranslationsWithParams,
        // demo.zip is a server-owned asset; src/assets is copied to dist/assets
        // by the build script, so the same RESOURCE_DIR-relative path works in
        // both source and bundled-production modes.
        getDemoArchive: async () => fs.readFileSync(path.join(RESOURCE_DIR, "db", "demo.zip")),
        inAppHelp: new NodejsInAppHelpProvider(),
        backup: new ServerBackupService(options),
        image: (await import("./services/image_provider.js")).serverImageProvider,
        config,
        extraAppInfo: {
            nodeVersion: process.version,
            dataDirectory: path.resolve(dataDirs.TRILIUM_DATA_DIR)
        }
    });
    const startTriliumServer = (await import("./www.js")).default;
    await startTriliumServer();

    if (!sql_init.isDbInitialized()) {
        getLog().banner(t("sql_init.db_not_initialized_server", { port }));
    }
}

startApplication().catch((err) => {
    console.error("Fatal error during Trilium server startup:", err);
    process.exit(1);
});
