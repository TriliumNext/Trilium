/*
 * Make sure not to import any modules that depend on localized messages via i18next here, as the initializations
 * are loaded later and will result in an empty string.
 */

import { initializeCore } from "@triliumnext/core";

import ClsHookedExecutionContext from "./cls_provider.js";
import NodejsCryptoProvider from "./crypto_provider.js";
import BetterSqlite3Provider from "./sql_provider.js";

async function startApplication() {
    const config = (await import("./services/config.js")).default;
    const { DOCUMENT_PATH } = (await import("./services/data_dir.js")).default;

    const dbProvider = new BetterSqlite3Provider();
    dbProvider.loadFromFile(DOCUMENT_PATH, config.General.readOnly);

    initializeCore({
        dbConfig: {
            provider: dbProvider,
            isReadOnly: config.General.readOnly,
            async onTransactionCommit() {
                const ws = (await import("./services/ws.js")).default;
                ws.sendTransactionEntityChangesToAllClients();
            },
            async onTransactionRollback() {
                const cls = (await import("./services/cls.js")).default;
                const becca_loader = (await import("@triliumnext/core")).becca_loader;
                const entity_changes = (await import("./services/entity_changes.js")).default;
                const log = (await import("./services/log")).default;

                const entityChangeIds = cls.getAndClearEntityChangeIds();

                if (entityChangeIds.length > 0) {
                    log.info("Transaction rollback dirtied the becca, forcing reload.");

                    becca_loader.load();
                }

                // the maxEntityChangeId has been incremented during failed transaction, need to recalculate
                entity_changes.recalculateMaxEntityChangeId();
            }
        },
        crypto: new NodejsCryptoProvider(),
        executionContext: new ClsHookedExecutionContext(),
        translations: (await import("./services/i18n.js")).initializeTranslations
    });
    const startTriliumServer = (await import("./www.js")).default;
    await startTriliumServer();
}

startApplication();
