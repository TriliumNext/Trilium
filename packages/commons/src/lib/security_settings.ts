/**
 * The settings every build keeps outside its database, and the one reader of them.
 *
 * Backend scripting, the SQL console and the desktop's LAN access are deliberately not options: a
 * script that reaches the SQL console can `UPDATE` any table, so a flag stored in the database
 * would let one of them grant another. Each build keeps them somewhere its own scripts cannot
 * write instead — `config.ini` on a server, `security.json` in the desktop's data directory, a
 * locked OPFS file in the browser — and they all read that file through {@link parseSecuritySettings}.
 *
 * @module
 */

/** What a build with no `config.ini` can offer a toggle for, since it can write the file itself. */
export type SecurityToggleName = "backendScriptingEnabled" | "sqlConsoleEnabled";

/** Everything the file can carry. LAN access is the desktop's, which is where the listener is. */
export type SecuritySettingName = SecurityToggleName | "allowLanAccess";

/**
 * What the file says.
 *
 * A setting is present only when the file named it with a literal boolean. Absent means the file
 * has no answer, which leaves whatever the build would otherwise run with — the `config.ini` value
 * on a server, `false` where there is no config file to read.
 */
export type SecuritySettings = Partial<Record<SecuritySettingName, boolean>>;

const SECURITY_SETTING_NAMES: readonly SecuritySettingName[] = [
    "backendScriptingEnabled",
    "sqlConsoleEnabled",
    "allowLanAccess"
];

/**
 * Reads the file, granting nothing it does not say exactly.
 *
 * Only a literal boolean counts. A `"false"` is a string and every non-empty string is truthy, so
 * a file carrying one would otherwise enable the setting it appears to disable; a `1`, an object
 * or a null is what a half-written file looks like, and none of them is a decision the user made.
 *
 * Never throws. A file that cannot be read is one the instance is better off without, which is the
 * safe direction: the settings it holds are the ones worth withholding when in doubt.
 */
export function parseSecuritySettings(raw: string): SecuritySettings {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return {};
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return {};
    }

    const record = parsed as Record<string, unknown>;
    const settings: SecuritySettings = {};
    for (const name of SECURITY_SETTING_NAMES) {
        if (typeof record[name] === "boolean") {
            settings[name] = record[name];
        }
    }

    return settings;
}

/**
 * Asks to change a security setting, which the platform's own confirmation gates.
 *
 * Both methods resolve `true` only when the user agreed and the change was written; applying it
 * takes a restart. The confirmation belongs to the platform rather than to the page, because a
 * note script can reach every dialog the application draws for itself: the desktop asks the
 * operating system, and the browser build asks the browser.
 */
export interface SecurityToggleApi {
    /** Requests backend script execution be turned on or off. */
    setBackendScriptingEnabled(enabled: boolean): Promise<boolean>;

    /** Requests the SQL console be turned on or off. */
    setSqlConsoleEnabled(enabled: boolean): Promise<boolean>;
}
