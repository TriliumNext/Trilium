/**
 * What the standalone build exposes to the client as `window.standaloneApi`.
 *
 * Standalone runs the whole stack in the browser: the database lives in a worker's private
 * filesystem, and the client talks to it over an intercepted `fetch`. That path serialises every
 * request body twice on its way through, and gives up after thirty seconds, which is fine for the
 * JSON everything else exchanges and impossible for a database.
 *
 * So the few things that carry a file get their own way through, the same way the desktop's
 * `window.electronApi` does. A `File` handed across is a reference to bytes the browser already has;
 * nothing is copied, nothing is uploaded, and the worker reads it as a stream.
 */

/** How far a restore has got, reported as it goes. */
export interface StandaloneRestoreProgress {
    /** Which step is running: preparing the backup, checking it, or putting it in place. */
    stage: "staging" | "validating" | "swapping" | "done" | "failed";
    /** How far through that step, from 0 to 1, for the step that can say. */
    fraction?: number;
}

/** How a restore ended. */
export interface StandaloneRestoreResult {
    status: "restored" | "needs-passphrase" | "error";
    /** Machine-readable cause when `status` is `error`, which the screen turns into a sentence. */
    reason?: string;
    /** The technical detail behind that cause. */
    message?: string;
}

export interface StandaloneRestoreApi {
    /**
     * Restores the database from a backup the user picked, reading it where it lies.
     *
     * Answers `needs-passphrase` for an encrypted backup given none, which is an invitation to ask
     * for one and call again with the same file rather than a failure.
     */
    importBackup(opts: {
        backup: File;
        passphrase?: string;
        onProgress?: (progress: StandaloneRestoreProgress) => void;
    }): Promise<StandaloneRestoreResult>;
}

/** How a database download ended, for the screen that gates its Continue on it. */
export interface StandaloneDownloadResult {
    status: "done" | "cancelled" | "failed";
    /** What stopped it, when `status` is `failed`. */
    message?: string;
}

export interface StandaloneBackupApi {
    /**
     * Streams a copy of the live database straight into a browser download.
     *
     * Straight through: nothing is staged in the origin's own storage, which may not have room
     * for a second copy of a large database, and nothing is ever compressed, which a low-end
     * device cannot afford at these sizes. The bytes go from the database to the disk a page at a
     * time, and the browser's own download UI shows the transfer itself.
     *
     * Given a passphrase, the download is a streamed encrypted container (`.tnbackup`); without
     * one it is the plain database (`.db`). The file name should carry the matching extension.
     *
     * Resolves when the stream has been fully produced, one way or the other, which is as close
     * to "the download finished" as the application can see: the browser's download manager may
     * still be settling the last bytes to disk for a moment after.
     */
    downloadDatabase(fileName: string, passphrase?: string): Promise<StandaloneDownloadResult>;
}

/** The complete surface the standalone build exposes to the client. */
export interface StandaloneApi {
    restore: StandaloneRestoreApi;
    backup: StandaloneBackupApi;
}
