/*
 * Make sure not to import any modules that depend on localized messages via i18next here, as the initializations
 * are loaded later and will result in an empty string.
 */

import { getLog, sql_init } from "@triliumnext/core";
import { t } from "i18next";

import { initializeServerCore } from "./core_init.js";
import port from "./services/port.js";

async function startApplication() {
    await initializeServerCore();

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
