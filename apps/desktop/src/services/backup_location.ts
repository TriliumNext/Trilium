import type { NativeDirectoryPickResult } from "@triliumnext/commons";
import { cls, getBackup, options as optionService } from "@triliumnext/core";
import electron from "electron";

import { showDirectoryPicker } from "./dialog";

/**
 * Registers the IPC handlers that move the backup folder.
 *
 * The main process writes `customDbBackupDir` itself, from the folder that the user accepts in the
 * OS dialog. The renderer never names a folder, so a script can at most open the picker.
 */
export function setupBackupLocationHandlers() {
    electron.ipcMain.handle("backup-location-choose", chooseBackupLocation);
    electron.ipcMain.handle("backup-location-reset", () => storeBackupLocation(""));
}

async function chooseBackupLocation(): Promise<NativeDirectoryPickResult> {
    const result = await showDirectoryPicker(getBackup().getBackupFolderPath() ?? undefined);
    if (result.status === "selected" && result.path) {
        storeBackupLocation(result.path);
    }

    return result;
}

function storeBackupLocation(directory: string) {
    cls.init(() => optionService.setOption("customDbBackupDir", directory));
}
