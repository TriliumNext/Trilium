import type { SecurityToggleApi } from "./security_settings.js";

/**
 * What the standalone build exposes to the client as `window.standaloneApi`.
 *
 * Standalone runs the whole stack in the browser: the database lives in a worker's private
 * filesystem, and a tab that does not own that worker reaches it over an intercepted `fetch`. That
 * path serialises every request body twice on its way through, and gives up after thirty seconds,
 * which is fine for the JSON everything else exchanges and impossible for a database.
 *
 * So the few things that carry a file get their own way through, the same way the desktop's
 * `window.electronApi` does. A `File` handed across is a reference to bytes the browser already has;
 * nothing is copied, nothing is uploaded, and the worker reads it as a stream.
 *
 * `localFetch` sits here for a different reason: it carries no file, and offers the tab that owns
 * the worker the ordinary request path without the trip through the service worker.
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
    /**
     * Where the file was written, when it went somewhere nameable. A browser download lands
     * wherever the browser puts it and reports nothing back; a save onto a device has a path,
     * which the screen shows because the user otherwise has no way to find it again.
     */
    location?: string;
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
    downloadDatabase(
        fileName: string,
        passphrase?: string,
        onProgress?: (sentBytes: number, totalBytes: number) => void
    ): Promise<StandaloneDownloadResult>;

    /**
     * Writes the same backup onto the device instead, for the mobile shell, whose WebView has no
     * download manager to hand it to.
     *
     * The bytes take the same pull-driven path off the database, so the container, the passphrase
     * and the progress mean exactly what they do above; only the far end differs. The file lands
     * in the app's documents directory and the share sheet then offers to put it somewhere that
     * outlives the device — but the file is already written by then, so a dismissed sheet is still
     * a backup, and the result carries where it went.
     */
    saveDatabase?(
        fileName: string,
        passphrase?: string,
        onProgress?: (sentBytes: number, totalBytes: number) => void
    ): Promise<StandaloneDownloadResult>;
}

/** How saving a download onto the device ended. */
export interface StandaloneSaveResult {
    status: "saved" | "cancelled" | "failed";
    /** The name the file was written under, which the message to the user names. */
    fileName?: string;
    /** What stopped it, when `status` is `failed`. */
    message?: string;
    /** Where the file was written, present once it is on disk whatever the share sheet then did. */
    location?: string;
}

export interface StandaloneSaveApi {
    /**
     * Fetches a download URL and puts the file on the device through the system share sheet.
     *
     * The Capacitor WebView has no download manager: a navigation that resolves to an
     * `attachment` response is dropped, silently. So the bytes are fetched by the page instead —
     * where the service worker (Android) or the iOS interceptors still route them to the local
     * worker — written to the app's cache directory, and handed to the share sheet, which is
     * where the user picks what the file becomes: a file in Downloads, a Drive upload, a mail
     * attachment.
     *
     * `cancelled` means the user dismissed that sheet, which is not a failure to report as one.
     */
    saveUrl(url: string): Promise<StandaloneSaveResult>;
}

/**
 * The same two toggles the desktop offers, defended in a place where it is harder: a frontend
 * script here runs in the page, so it can call these methods itself. What it cannot do is answer
 * the dialog, which the browser draws, and it has no other way to the setting, which lives in an
 * OPFS file the SQLite worker holds an exclusive lock on.
 *
 * A reload applies what is written. Present only on the tab that owns the database.
 */
export type StandaloneSecurityApi = SecurityToggleApi;

/** The complete surface the standalone build exposes to the client. */
export interface StandaloneApi {
    restore: StandaloneRestoreApi;
    backup: StandaloneBackupApi;
    /** Present only inside the Capacitor shell, where the browser saves no downloads itself. */
    save?: StandaloneSaveApi;
    /** Present only on the tab that owns the database, which is the one whose worker can write the file. */
    security?: StandaloneSecurityApi;
    /**
     * Answers an internal API request from the SQLite worker this page owns. The tab that wins the
     * database lock sets it, and the client's `server.ts` prefers it over its XHR transport, which
     * would pay the XHR → service worker → page round trip to end up in the same worker.
     */
    localFetch?(request: Request): Promise<Response>;
}
