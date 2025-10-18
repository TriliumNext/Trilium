"use strict";

import sqlInit from "../services/sql_init.js";
import setupService from "../services/setup.js";
import { isElectron } from "../services/utils.js";
import assetPath from "../services/asset_path.js";
import appPath from "../services/app_path.js";
import type { Request, Response } from "express";
import { getCurrentLocale } from "../services/i18n.js";

function setupPage(req: Request, res: Response) {
    if (sqlInit.isDbInitialized()) {
        if (isElectron) {
            handleElectronRedirect();
        } else {
            res.redirect(".");
        }

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
        syncInProgress: syncInProgress,
        assetPath: assetPath,
        appPath: appPath,
        currentLocale: getCurrentLocale()
    });
}

async function handleElectronRedirect() {
    const windowService = (await import("../services/window.js")).default;
    const { app } = await import("electron");

    // Wait for the main window to be created before closing the setup window to prevent triggering `window-all-closed`.
    await windowService.createMainWindow(app);
    windowService.closeSetupWindow();

    const tray = (await import("../services/tray.js")).default;
    tray.createTray();
}

export default {
    setupPage
};
