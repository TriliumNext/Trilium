/** The raw-row accessors the share cache and its entities read through. */
export interface ShareSql {
    getRawRows<T>(query: string, params?: string[]): T[];
    getRow<T>(query: string, params?: string[]): T;
    getColumn<T>(query: string, params?: string[]): T[];
}

/**
 * What the share subsystem needs from the platform hosting it. The Node server reads rows over a
 * second, read-only connection and loads templates from disk; the browser build shares the one
 * connection it has and carries its templates in the bundle.
 */
export interface ShareProvider {
    sql: ShareSql;
    /** Returns the share theme's EJS template of that name, such as `page` or `404`. */
    readTemplate(name: string): string;
    /** Returns true when a shared note can bring its own EJS template, which runs arbitrary JavaScript. */
    isScriptingEnabled(): boolean;
    /** Returns false while what {@link ShareProvider.sql} reads is still being opened. */
    isReady(): boolean;
}

let provider: ShareProvider | null = null;

export function initShare(shareProvider: ShareProvider) {
    provider = shareProvider;
}

export function getShareProvider(): ShareProvider {
    if (!provider) {
        throw new Error("Share provider has not been initialized. Call initShare() during startup.");
    }

    return provider;
}

/** Returns true when this platform registered a share provider and that provider can be read. */
export function isShareReady(): boolean {
    return !!provider && provider.isReady();
}
