import { PlatformProvider, t } from "@triliumnext/core";
import dataDir from "@triliumnext/server/src/services/data_dir.js";
import electron from "electron";
import path from "path";

export default class DesktopPlatformProvider implements PlatformProvider {
    readonly isElectron = true;
    readonly isMac = process.platform === "darwin";
    readonly isWindows = process.platform === "win32";
    readonly isLinux = process.platform === "linux";

    crash(message: string): void {
        electron.dialog.showErrorBox(t("modals.error_title"), message);
        electron.app.exit(1);
    }

    getEnv(key: string): string | undefined {
        return process.env[key];
    }

    getDatabasePath(): string {
        return path.resolve(dataDir.DOCUMENT_PATH);
    }

    /**
     * Tolerate `EADDRINUSE` when this process was either launched with
     * `--new-window` (the primary instance handles it via `second-instance`)
     * or lost the single-instance lock race. In both cases the port collision
     * is expected and the process should just exit quietly instead of
     * showing an error dialog.
     */
    shouldIgnoreStartupError(error: NodeJS.ErrnoException): boolean {
        return error.code === "EADDRINUSE"
            && (process.argv.includes("--new-window") || !electron.app.requestSingleInstanceLock());
    }
}
