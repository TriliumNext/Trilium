import { getLog, PlatformProvider } from "@triliumnext/core";
import path from "path";

import dataDir from "./services/data_dir.js";

export default class ServerPlatformProvider implements PlatformProvider {
    readonly isElectron = !!process.versions["electron"];
    readonly isMac = process.platform === "darwin";
    readonly isWindows = process.platform === "win32";
    readonly isLinux = process.platform === "linux";

    crash(message: string): void {
        getLog().banner(message);
        process.exit(1);
    }

    getEnv(key: string): string | undefined {
        return process.env[key];
    }

    getDatabasePath(): string {
        return path.resolve(dataDir.DOCUMENT_PATH);
    }
}
