import { initializeTranslations } from "@triliumnext/server/src/services/i18n.js";

import electron from "electron";
import sqlInit from "@triliumnext/server/src/services/sql_init.js";
import windowService from "@triliumnext/server/src/services/window.js";
import tray from "@triliumnext/server/src/services/tray.js";
import options from "@triliumnext/server/src/services/options.js";
import electronDebug from "electron-debug";
import electronDl from "electron-dl";
import { deferred } from "@triliumnext/server/src/services/utils.js";
import { PRODUCT_NAME } from "./app-info";

async function main() {
    const serverInitializedPromise = deferred<void>();

    // Prevent Trilium starting twice on first install and on uninstall for the Windows installer.
    if ((require("electron-squirrel-startup")).default) {
        process.exit(0);
    }

    // Adds debug features like hotkeys for triggering dev tools and reload
    electronDebug();
    electronDl({ saveAs: true });

    // needed for excalidraw export https://github.com/zadam/trilium/issues/4271
    electron.app.commandLine.appendSwitch("enable-experimental-web-platform-features");
    electron.app.commandLine.appendSwitch("lang", options.getOptionOrNull("formattingLocale") ?? "en");
    
    // Disable smooth scroll if the option is set
    const smoothScrollEnabled = options.getOptionOrNull("smoothScrollEnabled");
    if (smoothScrollEnabled === "false") {
        electron.app.commandLine.appendSwitch("disable-smooth-scrolling");
    }

    // Electron 36 crashes with "Using GTK 2/3 and GTK 4 in the same process is not supported" on some distributions.
    // See https://github.com/electron/electron/issues/46538 for more info.
    if (process.platform === "linux") {
        electron.app.setName(PRODUCT_NAME);
        electron.app.commandLine.appendSwitch("gtk-version", "3");
    }

    // Quit when all windows are closed, except on macOS. There, it's common
    // for applications and their menu bar to stay active until the user quits
    // explicitly with Cmd + Q.
    electron.app.on("window-all-closed", () => {
        if (process.platform !== "darwin") {
            electron.app.quit();
        }
    });

    electron.app.on("ready", async () => {
        await serverInitializedPromise;
        console.log("Starting Electron...");
        await onReady();
    });

    electron.app.on("will-quit", () => {
        electron.globalShortcut.unregisterAll();
    });

    // this is to disable electron warning spam in the dev console (local development only)
    process.env["ELECTRON_DISABLE_SECURITY_WARNINGS"] = "true";

    await initializeTranslations();
    const startTriliumServer = (await import("@triliumnext/server/src/www.js")).default;
    await startTriliumServer();
    console.log("Server loaded");
    serverInitializedPromise.resolve();
}

async function onReady() {
    //    electron.app.setAppUserModelId('com.github.zadam.trilium');

    // if db is not initialized -> setup process
    // if db is initialized, then we need to wait until the migration process is finished
    if (sqlInit.isDbInitialized()) {
        await sqlInit.dbReady;

        await windowService.createMainWindow(electron.app);

        if (process.platform === "darwin") {
            electron.app.on("activate", async () => {
                if (electron.BrowserWindow.getAllWindows().length === 0) {
                    await windowService.createMainWindow(electron.app);
                }
            });
        }

        tray.createTray();
    } else {
        await windowService.createSetupWindow();
    }

    await windowService.registerGlobalShortcuts();
}

main();
