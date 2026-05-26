import { PlatformProvider, t } from "@triliumnext/core";
import electron from "electron";

export default class DesktopPlatformProvider implements PlatformProvider {
    readonly isElectron = true;
    readonly isMac = process.platform === "darwin";
    readonly isWindows = process.platform === "win32";

    crash(message: string): void {
        electron.dialog.showErrorBox(t("modals.error_title"), message);
        electron.app.exit(1);
    }

    getEnv(key: string): string | undefined {
        return process.env[key];
    }
}
