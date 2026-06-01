import config from "./config.js";

/**
 * Throws if backend scripting is disabled.
 */
export function assertScriptingEnabled(): void {
    if (config.Security.backendScriptingEnabled) {
        return;
    }
    throw new Error(
        "Backend script execution is disabled. Set [Security] backendScriptingEnabled=true in config.ini or " +
        "TRILIUM_SECURITY_BACKEND_SCRIPTING_ENABLED=true to enable. WARNING: Backend scripts have full server access."
    );
}

export function assertSqlConsoleEnabled(): void {
    if (config.Security.sqlConsoleEnabled) {
        return;
    }
    throw new Error(
        "SQL console is disabled. Set [Security] sqlConsoleEnabled=true in config.ini to enable."
    );
}

export function isScriptingEnabled(): boolean {
    return config.Security.backendScriptingEnabled;
}
