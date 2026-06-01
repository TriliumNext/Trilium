/**
 * Interface for platform-specific services. This is used to abstract away platform-specific implementations, such as crash reporting, from the core logic of the application.
 */
export interface PlatformProvider {
    crash(message: string): void;
    /** Returns the value of an environment variable, or undefined if not set. */
    getEnv(key: string): string | undefined;
    readonly isElectron: boolean;
    readonly isMac: boolean;
    readonly isWindows: boolean;
    /**
     * Lets a platform decide whether an HTTP-server startup error should be
     * swallowed (logged-only) rather than treated as fatal. The desktop uses
     * this to tolerate `EADDRINUSE` when launched with `--new-window` or as a
     * secondary instance — the primary handles the request via Electron's
     * `second-instance` event. Optional; absent = always fatal.
     */
    shouldIgnoreStartupError?(error: NodeJS.ErrnoException): boolean;
}

let platformProvider: PlatformProvider | null = null;

export function initPlatform(provider: PlatformProvider) {
    platformProvider = provider;
}

export function getPlatform(): PlatformProvider {
    if (!platformProvider) throw new Error("Platform provider not initialized");
    return platformProvider;
}
