import { beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { initializeCore, options } from "@triliumnext/core";
import { serverZipExportProviderFactory } from "../src/services/export/zip/factory.js";
import ServerBackupService from "../src/backup_provider.js";
import ClsHookedExecutionContext from "../src/cls_provider.js";
import NodejsCryptoProvider from "../src/crypto_provider.js";
import NodejsZipProvider from "../src/zip_provider.js";
import ServerPlatformProvider from "../src/platform_provider.js";
import BetterSqlite3Provider from "../src/sql_provider.js";
import NodejsInAppHelpProvider from "../src/in_app_help_provider.js";
import { initializeTranslationsWithParams } from "../src/services/i18n.js";
import ServerLogService from "../src/log_provider.js";
import { serverImageProvider } from "../src/services/image_provider.js";

// Initialize environment variables.
process.env.TRILIUM_DATA_DIR = join(__dirname, "db");
process.env.TRILIUM_RESOURCE_DIR = join(__dirname, "../src");
process.env.TRILIUM_INTEGRATION_TEST = "memory";
process.env.TRILIUM_ENV = "dev";
process.env.TRILIUM_PUBLIC_SERVER = "http://localhost:4200";

beforeAll(async () => {
    // Load the integration test database into memory. The fixture at
    // packages/trilium-core/src/test/fixtures/document.db is pre-seeded with
    // the schema, demo content, and a known password ("demo1234") that the
    // ETAPI tests log in with. Each test file runs in its own vitest fork
    // (pool: "forks"), so each gets a fresh in-memory copy and mutations
    // don't leak across files.
    const dbProvider = new BetterSqlite3Provider();
    dbProvider.loadFromBuffer(readFileSync(require.resolve("@triliumnext/core/src/test/fixtures/document.db")));

    await initializeCore({
        dbConfig: {
            provider: dbProvider,
            isReadOnly: false,
            onTransactionCommit() {},
            onTransactionRollback() {}
        },
        crypto: new NodejsCryptoProvider(),
        zip: new NodejsZipProvider(),
        zipExportProviderFactory: serverZipExportProviderFactory,
        executionContext: new ClsHookedExecutionContext(),
        schema: readFileSync(require.resolve("@triliumnext/core/src/assets/schema.sql"), "utf-8"),
        platform: new ServerPlatformProvider(),
        translations: initializeTranslationsWithParams,
        inAppHelp: new NodejsInAppHelpProvider(),
        backup: new ServerBackupService(options),
        log: new ServerLogService(),
        image: serverImageProvider
    });
});
