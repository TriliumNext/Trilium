import { PlatformProvider, t } from "@triliumnext/core";
import electron from "electron";

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
