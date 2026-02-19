import config from "./config.js";
import { isElectron } from "./utils.js";

/**
 * Throws if scripting is disabled. Desktop (Electron) always allows scripting.
 */
export function assertScriptingEnabled(): void {
    if (isElectron || config.Scripting.enabled) {
        return;
    }
    throw new Error(
        "Script execution is disabled. Set [Scripting] enabled=true in config.ini or " +
        "TRILIUM_SCRIPTING_ENABLED=true to enable. WARNING: Scripts have full server access."
    );
}

export function assertSqlConsoleEnabled(): void {
    if (isElectron || config.Scripting.sqlConsoleEnabled) {
        return;
    }
    throw new Error(
        "SQL console is disabled. Set [Scripting] sqlConsoleEnabled=true in config.ini to enable."
    );
}

export function isScriptingEnabled(): boolean {
    return isElectron || config.Scripting.enabled;
}
