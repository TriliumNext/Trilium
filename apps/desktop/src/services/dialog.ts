import type { NativeDirectoryPickResult } from "@triliumnext/commons";
import { default as electron } from "electron";
import { t } from "i18next";

/**
 * Registers the native picker IPC handlers.
 *
 * The renderer never supplies the answer: the OS dialog runs here in the main process and a path
 * only comes back once the user has accepted it, so a note script can at most pop the dialog.
 */
export function setupDialogHandlers() {
    electron.ipcMain.handle("dialog-pick-directory", async (_e, opts?: { defaultPath?: string }): Promise<NativeDirectoryPickResult> => {
        const focusedWindow = electron.BrowserWindow.getFocusedWindow();
        if (!focusedWindow) {
            return { status: "cancelled" };
        }

        // Async dialog: showOpenDialogSync blocks the main process event loop (freezing the UI, WebSockets
        // and background tasks) for as long as the picker is open.
        const { canceled, filePaths } = await electron.dialog.showOpenDialog(focusedWindow, {
            title: t("dialog.select_directory"),
            defaultPath: opts?.defaultPath,
            properties: ["openDirectory", "createDirectory"]
        });

        if (canceled || filePaths.length === 0) {
            return { status: "cancelled" };
        }

        return { status: "selected", path: filePaths[0] };
    });
}
