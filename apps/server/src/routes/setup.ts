import { i18n, setup as setupService } from "@triliumnext/core";
import type { Request, Response } from "express";

import appPath from "../services/app_path.js";
import assetPath from "../services/asset_path.js";
import sqlInit from "../services/sql_init.js";

function setupPage(req: Request, res: Response) {
    if (sqlInit.isDbInitialized()) {
        // For HTTP browsers this navigates to the main app. The desktop
        // (Electron) flow doesn't depend on the response — its DB_INITIALIZED
        // subscriber swaps the setup window for the main window directly, so
        // the renderer issuing this request is about to be destroyed anyway.
        res.redirect(".");
        return;
    }

    // we got here because DB is not completely initialized, so if schema exists,
    // it means we're in "sync in progress" state.
    const syncInProgress = sqlInit.schemaExists();

    if (syncInProgress) {
        // trigger sync if it's not already running
        setupService.triggerSync();
    }

    res.render("setup", {
        syncInProgress,
        assetPath,
        appPath,
        currentLocale: i18n.getCurrentLocale()
    });
}

export default {
    setupPage
};
