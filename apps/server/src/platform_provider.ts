import { getLog, PlatformProvider } from "@triliumnext/core";

export default class ServerPlatformProvider implements PlatformProvider {
    readonly isElectron = !!process.versions["electron"];
    readonly isMac = process.platform === "darwin";
    readonly isWindows = process.platform === "win32";

    crash(message: string): void {
        getLog().banner(message);
        process.exit(1);
    }

    getEnv(key: string): string | undefined {
        return process.env[key];
    }
}
