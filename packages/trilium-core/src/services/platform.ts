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
}

let platformProvider: PlatformProvider | null = null;

export function initPlatform(provider: PlatformProvider) {
    platformProvider = provider;
}

export function getPlatform(): PlatformProvider {
    if (!platformProvider) throw new Error("Platform provider not initialized");
    return platformProvider;
}
