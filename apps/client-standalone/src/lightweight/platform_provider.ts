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
    readonly isMac = false;
    readonly isWindows = false;

    private envMap: Record<string, string> = {};

    constructor(queryString: string) {
        const params = new URLSearchParams(queryString);
        for (const [queryKey, envKey] of Object.entries(QUERY_TO_ENV)) {
            if (params.has(queryKey)) {
                this.envMap[envKey] = params.get(queryKey) || "true";
            }
        }
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
}
