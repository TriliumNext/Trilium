/**
 * The file a running instance leaves behind to ask the next start to come up in setup.
 *
 * Setup is normally where an instance goes because it has no database. This is the other way in: an
 * instance that has one, and wants to be somewhere in the wizard anyway, writes this file and
 * restarts. The start that follows reads it, deliberately leaves the database closed, and opens the
 * screen it names.
 *
 * Everything the wizard needs from the database has to be in here, because by then the database is
 * not open. That is what {@link SetupMarker.lang} is for: without it the wizard would come up in
 * English and ask a user who has already answered that question.
 *
 * @module
 */

/** Where the marker is kept: the data directory, beside the database it is asking to bypass. */
export const SETUP_MARKER_FILE_NAME = "setup.json";

/**
 * The screen the wizard should open on.
 *
 * Named for what the user asked for rather than for the wizard's own state, so the file format does
 * not follow the client's internals around. Screens are listed here as they gain a way in.
 */
export type SetupTargetScreen = "restore-backup" | "backup-database";

/**
 * What the user settled on before a backup taken from the setup screen was written.
 *
 * Everything here is a question the screen asked, so that a backup taken by hand is not silently
 * governed by settings meant for the unattended ones: this is the moment a user is deciding what
 * happens to their data, and it is the one moment worth asking in.
 */
export interface SetupBackupSettings {
    /** What to call it, before the extension the format decides on. */
    name: string;
    /**
     * The password to lock it with. Empty leaves it unlocked, unless {@link useStoredPassphrase}.
     */
    passphrase: string;
    /**
     * Lock it with the passphrase the instance already keeps, rather than with {@link passphrase}.
     *
     * That passphrase lives in the OS keyring and is deliberately never readable from the interface
     * — only the backend ever sees it again. So a user asking for the password they already
     * configured can only ask for it, not type it back, which is what this is.
     */
    useStoredPassphrase: boolean;
    /** Whether to compress it. */
    compress: boolean;
}

/**
 * What the instance is already configured for, which is what the screen offers as its answers.
 *
 * Read from the options of the database the wizard was booted away from, so a user who has set all
 * of this up once is not asked to decide it again from scratch.
 */
export interface SetupBackupDefaults {
    /**
     * Whether there is a stored passphrase to lock the backup with, and so whether the screen has a
     * "use the one I configured" to offer at all.
     */
    storedPassphrase: boolean;
    /** Whether the instance encrypts its backups, which decides whether that is offered ticked. */
    encrypt: boolean;
    /** Whether the instance compresses its backups. */
    compress: boolean;
}

/** A backup the setup screen took of the database it is about to replace. */
export interface SetupExistingBackup {
    fileName: string;
    /** The whole path, for downloading it and for anything that needs to name the file itself. */
    filePath: string;
    /**
     * The directory holding it, shown on its own.
     *
     * Shown because the user may lose sight of a custom backup location afterwards: the option
     * naming it lives in the database that is about to be replaced.
     */
    directoryPath: string;
    fileSize: number;
}

/**
 * Where the setup backup stands, polled by the screen waiting on it.
 *
 * The backup is started with one request and watched through this one, rather than answered on a
 * request held open for however long the write takes: on the standalone platform a request rides
 * the service worker, and the browser does not let a fetch stay open for the minutes a large
 * database needs.
 */
export interface SetupExistingBackupStatus {
    /** `idle` before any backup this boot; what became of the latest one after that. */
    state: "idle" | "running" | "done" | "failed";
    /** How far through the write, from 0 to 1, while running and once the writer can say. */
    fraction: number | null;
    /** What was written, once `done`. */
    result?: SetupExistingBackup;
    /** What stopped it, once `failed`. */
    error?: string;
}

/** What a start reads out of {@link SETUP_MARKER_FILE_NAME}. */
export interface SetupMarker {
    /** The language the instance was using, so the wizard is in it rather than asking again. */
    lang: string;
    /** Where to go. Absent leaves the wizard where a first run starts, at the language step. */
    targetScreen?: SetupTargetScreen;
}
