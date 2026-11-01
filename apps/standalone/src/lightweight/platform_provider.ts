import type { PlatformProvider } from "@triliumnext/core";

// Build-time constant injected by Vite (see `define` in vite.config.mts).
declare const __TRILIUM_INTEGRATION_TEST__: string;

/** Maps URL query parameter names to TRILIUM_ environment variable names. */
const QUERY_TO_ENV: Record<string, string> = {
    "safeMode": "TRILIUM_SAFE_MODE",
    "startNoteId": "TRILIUM_START_NOTE_ID",
};

export default class StandalonePlatformProvider implements PlatformProvider {
    readonly isElectron = false;
    readonly isStandalone = true;
    readonly isMac = matchesPlatform("Mac");
    readonly isWindows = matchesPlatform("Win");
    // Android reports a Linux platform string; keep `isLinux` meaning desktop Linux.
    readonly isLinux = matchesPlatform("Linux") && !navigator.userAgent.includes("Android");

    private envMap: Record<string, string> = {};

    constructor(queryString: string) {
        const params = new URLSearchParams(queryString);
        for (const [queryKey, envKey] of Object.entries(QUERY_TO_ENV)) {
            if (params.has(queryKey)) {
                this.envMap[envKey] = params.get(queryKey) || "true";
            }
        }
        /* v8 ignore next 3 -- @preserve: __TRILIUM_INTEGRATION_TEST__ is inlined empty outside integration builds, so this branch is unreachable under the standard (CI) build. */
        if (__TRILIUM_INTEGRATION_TEST__) {
            this.envMap["TRILIUM_INTEGRATION_TEST"] = __TRILIUM_INTEGRATION_TEST__;
        }
    }

    crash(message: string): void {
        console.error("[Standalone] FATAL:", message);
        self.postMessage({
            type: "FATAL_ERROR",
            message
        });
    }

    getEnv(key: string): string | undefined {
        return this.envMap[key];
    }

    /** The browser owns the storage the database lives in, and gives out no path to it. */
    getDatabasePath(): null {
        return null;
    }
}

/**
 * Reads the host OS from the worker's `navigator`. `navigator.platform` is deprecated but is the one
 * field a worker gets in every browser, and the client's `isMac()` reads it too — the two must agree,
 * or the shortcuts the settings pane renders differ from the ones `/api/keyboard-actions` served.
 */
function matchesPlatform(name: string) {
    return navigator.platform.includes(name);
}
