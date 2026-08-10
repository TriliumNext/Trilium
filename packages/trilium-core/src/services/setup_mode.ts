import { type SetupMarker, type SetupTargetScreen } from "@triliumnext/commons";

/**
 * Setup asked for by an instance that already has a database.
 *
 * An instance normally reaches the setup screen because there is nothing to open. Some things the
 * user can ask for, restoring a backup among them, need the same screen and the same closed
 * database, so a running instance writes a `setup.json` marker and restarts. The start that follows
 * reads it, hands it to this module, and from then on the instance answers "not initialized" to
 * everything that asks: the database is never migrated, becca is never loaded, the desktop opens its
 * setup window, and every guard that exists to protect an uninitialized instance keeps working
 * unchanged.
 *
 * The state lives for the process, not for the file, which is read once and deleted. A page reloaded
 * halfway through the wizard therefore comes back to the same screen, while a genuine restart comes
 * back to the app.
 *
 * @module
 */

/** The screens a marker is allowed to name, which is not every screen the wizard has. */
const TARGET_SCREENS: readonly SetupTargetScreen[] = [ "restore-backup", "backup-database" ];

let requested: SetupMarker | null = null;

/**
 * Puts the instance into setup for the rest of this process.
 *
 * Called by the platform at start, before the database is opened, with whatever its marker file
 * held. A `null` marker is the ordinary case and leaves everything alone.
 */
export function enterSetupMode(marker: SetupMarker | null): void {
    requested = marker;
}

/**
 * Takes the instance back out, which is what bringing a database up means.
 *
 * Called by every path that opens one: finishing a restore, creating a document, converging a sync.
 * Until it is called, {@link isSetupRequested} keeps the instance answering as uninitialized, and
 * the database that was just opened would go unnoticed.
 */
export function leaveSetupMode(): void {
    requested = null;
}

/** Whether this instance was asked to be in setup rather than being there for want of a database. */
export function isSetupRequested(): boolean {
    return requested !== null;
}

/**
 * Whether the setup screen is the instance's first run.
 *
 * `false` says there is a database behind the wizard, which is what lets a screen offer to leave
 * without doing anything: the instance has somewhere to go back to.
 */
export function isInitialSetup(): boolean {
    return requested === null;
}

/** The screen the marker asked for, if it asked for one. */
export function getSetupTargetScreen(): SetupTargetScreen | undefined {
    return requested?.targetScreen;
}

/** The language the marker carried, which is the instance's own, from before the database closed. */
export function getSetupLanguage(): string | undefined {
    return requested?.lang;
}

/**
 * Reads a marker's contents, or answers `null` for anything that is not one.
 *
 * The file is written by this application and read by the next start of it, but it is also a plain
 * file in the data directory that anything could have left behind, and it is read at the one moment
 * when a bad answer sends the instance somewhere the user did not ask to go. So it is parsed
 * defensively: unknown screens are dropped rather than carried, and a marker without a language is
 * not a marker.
 */
export function parseSetupMarker(raw: string): SetupMarker | null {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }

    if (typeof parsed !== "object" || parsed === null) {
        return null;
    }

    const { lang, targetScreen } = parsed as Record<string, unknown>;
    if (typeof lang !== "string" || !lang) {
        return null;
    }

    const screen = asSetupTargetScreen(targetScreen);

    return {
        lang,
        ...(screen ? { targetScreen: screen } : {})
    };
}

/**
 * Narrows a value to a screen the wizard may be sent to, or to nothing.
 *
 * The list is deliberately not every state the wizard has: two of them create a document the moment
 * they are shown, and nothing outside the wizard should be able to name those.
 */
export function asSetupTargetScreen(value: unknown): SetupTargetScreen | undefined {
    return TARGET_SCREENS.find((screen) => screen === value);
}

/**
 * What setup needs of the platform it is running on.
 *
 * The marker and the database both live somewhere only the platform knows: a data directory on a
 * disk, or the origin's private filesystem in a browser. Reading the marker is the platform's own
 * business and happens before any of this exists, so only what a shared route has to reach is here.
 */
export interface SetupPlatform {
    /** Leaves the marker that makes the next start the wizard. */
    writeMarker(marker: SetupMarker): Promise<void>;
    /** Takes it back, for a request that was made and then abandoned. */
    removeMarker(): Promise<void>;
    /**
     * Erases the database this instance was booted away from, and only that: backups, configuration
     * and the stored passphrase are what a user who deletes by mistake has left, and they stay.
     */
    removeDatabase(): Promise<void>;
}

let platform: SetupPlatform | null = null;

export function initSetupPlatform(instance: SetupPlatform): void {
    platform = instance;
}

export function getSetupPlatform(): SetupPlatform {
    if (!platform) {
        throw new Error("Setup platform not initialized.");
    }

    return platform;
}
