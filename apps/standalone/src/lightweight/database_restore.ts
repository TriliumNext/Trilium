import type { SAHPoolUtil } from "@sqlite.org/sqlite-wasm";
import {
    FIXED_HEADER_BYTES,
    getInfo,
    isBackupContainerError,
    type ProgressCallback,
    readBackupContainer,
    type SupportedBackupContainer,
    containerSize
} from "@triliumnext/backup-container/web";
import {
    type CandidateDatabase,
    type DatabaseValidation,
    looksLikeSqlite,
    validateDatabase
} from "@triliumnext/core";

/**
 * Puts a backup in place of this instance's database, in the browser.
 *
 * The server exchanges two files on a disk. Here the databases live as entries in the SAH pool,
 * which has no rename, so a restore is done by writing the new database in beside the old one and
 * then changing which name the next start opens. That single small write is the whole of the swap:
 * before it the old database is live, after it the new one is, and there is no moment in between
 * where neither is.
 *
 * Nothing is ever held whole. The backup arrives as a stream and is fed to `importDb` chunk by
 * chunk, and the checks read the imported database page by page through the VFS, so a restore costs
 * the size of the backup on disk and almost nothing in memory. That matters more here than on a
 * server: this database engine is compiled to WebAssembly, whose address space is a fraction of what
 * a native process has.
 *
 * @module
 */

/** Where the pointer to the live database is kept, in the origin's private filesystem. */
const POINTER_FILE = "trilium-current-database";

/**
 * The two names a database is ever kept under.
 *
 * A restore writes the new database in beside the old one and then points at it, so the name it
 * writes to has to be the one that is *not* live. Alternating between two settles that: whichever is
 * live, the other is free, and a restore can never be preparing over the database it is replacing.
 */
const DATABASE_NAMES = [ "/trilium.db", "/trilium.alt.db" ] as const;

/** The database opened when nothing has ever been restored. */
export const DEFAULT_DATABASE_NAME = DATABASE_NAMES[0];

/** Where a backup is written while it is being checked, which is wherever the live one is not. */
function candidateNameFor(live: string): string {
    return DATABASE_NAMES.find((name) => name !== live) ?? DATABASE_NAMES[1];
}

/** What the restore is doing, in the order it does it. Mirrors the server's own steps. */
export type RestoreStage = "staging" | "validating" | "swapping" | "done" | "failed";

export interface RestoreProgress {
    stage: RestoreStage;
    /** How far through the current step, from 0 to 1, for the step that can say. */
    fraction?: number;
    error?: string;
    reason?: string;
}

/** The database the restore acts on, reduced to what it needs and no more. */
export interface RestoreTarget {
    pool: SAHPoolUtil;
    /** Closes whatever is open. */
    close(): void;
    /** Opens the named pool entry as the live database. */
    open(dbName: string): void;
}

/**
 * Reads which pool entry holds the live database.
 *
 * Falls back to the original name, which is what every instance that has never restored anything is
 * still using, and what a browser that has lost the pointer should reach for.
 */
export async function readCurrentDatabaseName(): Promise<string> {
    try {
        const root = await navigator.storage.getDirectory();
        const handle = await root.getFileHandle(POINTER_FILE);
        const name = (await (await handle.getFile()).text()).trim();

        return name || DEFAULT_DATABASE_NAME;
    } catch {
        return DEFAULT_DATABASE_NAME;
    }
}

/**
 * Restores `backup` over the live database, reporting each step through `report`.
 *
 * @param backup the file the user chose, read where it lies rather than copied anywhere first.
 * @throws Error carrying a `reason` the setup screen maps to something the user can act on.
 */
export async function restoreDatabase(
    target: RestoreTarget,
    backup: Blob,
    options: { passphrase?: string; report?: (progress: RestoreProgress) => void } = {}
): Promise<void> {
    const report = options.report ?? (() => {});
    const live = await readCurrentDatabaseName();
    const candidate = candidateNameFor(live);

    try {
        report({ stage: "staging" });
        await keepingHandles(target, live, () =>
            stageCandidate(target.pool, candidate, backup, options.passphrase, (fraction) =>
                report({ stage: "staging", fraction })));

        report({ stage: "validating" });
        const validation = await keepingHandles(target, live, async () => validate(target.pool, candidate));
        if (!validation.valid) {
            throw new RestoreFailure(validation.rejection, validation.message);
        }

        report({ stage: "swapping" });
        await swapIn(target, live, candidate);

        report({ stage: "done" });
    } catch (e) {
        const failure = asFailure(e);
        // The candidate is no use to anyone now, and the pool's slots are finite. Unless a start
        // would open it, which is the one case where it is not a leftover but the database itself:
        // the pointer is only ever put on it once it has passed its checks, and removing what the
        // pointer names would leave nothing to open at all.
        if (await readCurrentDatabaseName() !== candidate) {
            await removeQuietly(target.pool, candidate);
        }
        report({ stage: "failed", error: failure.message, reason: failure.reason });

        throw failure;
    }
}

/** A failure with a reason attached, so the setup screen can tell the cases apart. */
export class RestoreFailure extends Error {
    constructor(readonly reason: string, message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "RestoreFailure";
    }
}

/**
 * Writes the backup into the pool as the candidate, unwrapping it on the way where it is a
 * container.
 *
 * The unwrap writes into one end of a pipe while the import pulls from the other, so the database
 * passes through in chunks and the pipe's own backpressure keeps the two in step. Neither end ever
 * holds more than a chunk.
 */
async function stageCandidate(
    pool: SAHPoolUtil,
    candidate: string,
    backup: Blob,
    passphrase: string | undefined,
    onProgress: ProgressCallback
): Promise<void> {
    await makeRoomFor(pool);
    await removeQuietly(pool, candidate);

    const format = await readBackupFormat(backup);
    if (!format) {
        throw new RestoreFailure("not-a-database", "The backup could not be read.");
    }

    if (!format.container) {
        await pool.importDb(candidate, pullFrom(readInSlices(backup)));
        onProgress(1);
        return;
    }

    // Asked before the file is read rather than after: an encrypted container without a passphrase
    // fails the same way either way, but only one of them takes minutes to get there.
    if (format.encrypted && !passphrase) {
        throw new RestoreFailure("passphrase-required", "The backup is encrypted.");
    }

    const relay = new TransformStream<Uint8Array, Uint8Array>();
    const unwrapped = readBackupContainer(readInSlices(backup), relay.writable, { passphrase, onProgress });
    const imported = pool.importDb(candidate, pullFrom(relay.readable));

    // Awaited together: either failing has to stop the other, which is what a rejected pipe does.
    await Promise.all([ unwrapped, imported ]);
}

/**
 * Opens the candidate and puts it through the checks every platform shares, minus the scan.
 *
 * `PRAGMA quick_check` reads every page, and here every page comes back through the pool's
 * synchronous access handles into a WebAssembly database engine, which is the slowest reader of the
 * three platforms and the one with a user watching a setup screen that cannot say how far along it
 * is. What it would find is largely accounted for already: a container's payload is checked against
 * a SHA-256 recorded when the backup was written, and any file is opened, its schema parsed and its
 * options read before it is accepted. The remaining case, a plain `.db` damaged somewhere no schema
 * read reaches, surfaces the way it would in any other Trilium, which never scans its database
 * either except when asked to from the options screen.
 */
function validate(pool: SAHPoolUtil, candidate: string): DatabaseValidation {
    const db = new pool.OpfsSAHPoolDb(candidate);

    try {
        return validateDatabase(candidateOf(db), { skipIntegrityCheck: true });
    } catch (e) {
        // Not a verdict on the backup. The checks call a database damaged by looking at it and
        // finding it so; this is the looking itself having failed, which says nothing about what
        // was being looked at. Calling it damaged because the device ran out of memory, or because
        // the browser took the pool's handles away, is how a perfectly good backup gets thrown out.
        throw new RestoreFailure("check-failed", messageOf(e), { cause: e });
    } finally {
        db.close();
    }
}

/** The three questions the checks ask, answered by a database opened from the pool. */
function candidateOf(db: InstanceType<SAHPoolUtil["OpfsSAHPoolDb"]>): CandidateDatabase {
    return {
        integrityCheck: () => String(db.selectValue("PRAGMA quick_check")),
        tableNames: () => db.selectValues("SELECT name FROM sqlite_master WHERE type = 'table'") as string[],
        option: (name) => db.selectValue("SELECT value FROM options WHERE name = ?", [ name ]) as string | undefined
    };
}

/**
 * Makes the candidate the live database.
 *
 * The pointer is written last, and is the only thing that decides which database is opened: until it
 * changes, an interrupted restore leaves the old one live with an unused entry beside it, which the
 * next attempt overwrites.
 */
async function swapIn(target: RestoreTarget, previous: string, candidate: string): Promise<void> {
    target.close();

    try {
        // Inside the rollback's reach, because a pointer half-written is the one failure that could
        // leave a start reading neither name.
        await writeCurrentDatabaseName(candidate);
        await openWithHandles(target, candidate);
    } catch (e) {
        // Put back what was live, so a candidate that will not open costs nothing.
        throw await rollBackTo(target, previous, e);
    }

    // Only once the restored database is open: until then the old one is what a restart needs.
    await removeQuietly(target.pool, previous);
}

/**
 * Opens `dbName`, taking the pool's access handles back first where the browser has closed them.
 *
 * Retried once, and only for that: a database that will not open for any other reason will not open
 * the second time either, and the first failure is the one worth reporting.
 */
async function openWithHandles(target: RestoreTarget, dbName: string): Promise<void> {
    try {
        target.open(dbName);
    } catch (e) {
        if (!isClosedAccessHandle(e)) {
            throw e;
        }

        await reacquireAccessHandles(target.pool);
        target.open(dbName);
    }
}

/**
 * Puts the previous database back after a swap that did not take.
 *
 * The pointer is the whole of what decides which database a start opens, so restoring it is what
 * makes a failed swap harmless: whatever happens next, the notes are the ones that were here before.
 * Reopening it is the part that can fail again, since the handles the reopen needs may be the very
 * thing that was taken, and that failure must not replace the one being reported or the screen would
 * explain the wrong problem.
 */
async function rollBackTo(
    target: RestoreTarget,
    previous: string,
    cause: unknown
): Promise<RestoreFailure> {
    try {
        await writeCurrentDatabaseName(previous);
    } catch {
        // The pointer is whatever it was left as, which may be the candidate. That one has passed
        // its checks, so a start finding it is not in danger; it is simply not the database this
        // instance was told to keep, and only a start can settle which it opens.
        return new RestoreFailure("swap-failed-reload", messageOf(cause));
    }

    try {
        await openWithHandles(target, previous);
    } catch {
        // The pointer is back, so a start comes up on the database that was here all along. This
        // instance simply cannot get there without one, which is the one thing the user has to be
        // told rather than left to discover.
        return new RestoreFailure("swap-failed-reload", messageOf(cause));
    }

    return new RestoreFailure("swap-failed", messageOf(cause));
}

/**
 * Runs `work`, and where the browser closed the pool's handles underneath it, takes them back and
 * runs it once more.
 *
 * This is for the part of a restore that happens before the swap, where the database being replaced
 * is still open and serving the screen behind all this. Taking the handles back means letting go of
 * it for a moment, since the pool refuses to be paused while anything is open at all, so it is
 * closed and opened again around the recovery.
 *
 * The retry starts the work over rather than resuming it, which for the import means reading the
 * backup from the beginning. That is worth it against the alternative: without it a restore that
 * was suspended halfway is simply lost, and the suspension is usually the user coming back to the
 * application rather than leaving it.
 *
 * @param live the database to put back, which is the one this restore has not replaced yet.
 */
async function keepingHandles<T>(
    target: RestoreTarget,
    live: string,
    work: () => Promise<T>
): Promise<T> {
    try {
        return await work();
    } catch (e) {
        if (!isClosedAccessHandle(e)) {
            throw e;
        }

        try {
            target.close();
            await reacquireAccessHandles(target.pool);
            target.open(live);
        } catch {
            // The handles could not be had back, so the failure to report is the one that was
            // actually hit rather than whatever went wrong trying to recover from it.
            throw e;
        }

        return await work();
    }
}

/**
 * Whether a failure is the browser having closed the pool's access handles underneath it.
 *
 * WebKit closes them whenever it suspends the page: a file picker, a screen lock, a switch to
 * another application. The pool takes its handles once and holds them for its lifetime, so it never
 * learns they are gone, and the next operation against it fails with this.
 */
function isClosedAccessHandle(e: unknown): boolean {
    if (e instanceof DOMException && e.name === "InvalidStateError") {
        return true;
    }

    // Through whatever wrapped it. A step reports a failure in its own terms, and it has no business
    // deciding on the way whether the browser's error underneath is one that can be recovered from.
    if (e instanceof Error && e.cause !== undefined && isClosedAccessHandle(e.cause)) {
        return true;
    }

    return /access\s*handle.*closed|closed.*access\s*handle/i.test(messageOf(e));
}

/**
 * Takes the pool's access handles back.
 *
 * The pause is the part that matters, and `isPaused` is no help in deciding whether to do it: it
 * reports what the pool did to itself, and a pool whose handles were taken from underneath it still
 * believes it holds them, so `unpauseVfs` on its own returns having done nothing. Pausing is what
 * clears that belief. It is refused while any database is open, which is why this belongs to the
 * moment between closing one and opening the next.
 */
async function reacquireAccessHandles(pool: SAHPoolUtil): Promise<void> {
    pool.pauseVfs();
    await pool.unpauseVfs();
}

/**
 * Erases the live database and leaves an empty one in its place.
 *
 * What the setup wizard does when the user asks for it. The pool has no notion of "no database", and
 * everything after this point in the wizard writes to one — creating a document, converging a sync —
 * so the entry is unlinked and a fresh one opened under the name a first run uses, which is exactly
 * the state a browser that had never run Trilium is in.
 *
 * Beside the restore because it is the same dance: close, exchange, open. The order below is what
 * keeps a failure part-way through from leaving the two halves of "which database is live"
 * disagreeing, and each step says what it costs when it is the one that fails.
 *
 * @throws Error where the pointer could not be moved, having erased nothing.
 */
export async function eraseDatabase(target: RestoreTarget): Promise<void> {
    const live = await readCurrentDatabaseName();
    target.close();

    // Which entry the caller will be holding when this returns. It moves only once the pointer that
    // outlives this worker agrees, so the two can never come out of here naming different databases:
    // the next start reads that pointer, and running on one entry while the pointer names another
    // would silently strand everything written in between.
    let opening = live;

    try {
        // The pointer first, and the unlink second. The other way round, a pointer write that failed
        // would leave it naming an entry that no longer exists while this worker ran on the default
        // one. A pointer that is moved and then not followed through only leaks the old entry.
        await writeCurrentDatabaseName(DEFAULT_DATABASE_NAME);
        opening = DEFAULT_DATABASE_NAME;

        try {
            target.pool.unlink(live);
        } catch {
            // Already gone, which is the state the caller asked for.
        }
    } finally {
        // Whatever happened above, the caller has to come back holding a database: everything after
        // this point writes to one, and a detached service answers every request with "DB not open"
        // for as long as this worker lives. The pool creates the entry where there is none, so this
        // opens either the one just cleared out, or the one nothing got around to clearing.
        target.open(opening);
    }
}

/** Points the next start at `dbName`, which is the whole of what makes a database the live one. */
export async function writeCurrentDatabaseName(dbName: string): Promise<void> {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(POINTER_FILE, { create: true });
    const writable = await handle.createWritable();

    try {
        await writable.write(dbName);
    } finally {
        await writable.close();
    }
}

/**
 * Identifies a backup from its first bytes: a container states what it is in the clear, and anything
 * else has to be a database already.
 */
async function readBackupFormat(backup: Blob): Promise<{ container: boolean; encrypted: boolean } | null> {
    const head = new Uint8Array(await backup.slice(0, FIXED_HEADER_BYTES).arrayBuffer());
    const container = getInfo(head);

    if (container.isValid && container.isSupported) {
        requireWholeContainer(container, backup.size);

        return { container: true, encrypted: container.isEncrypted };
    }

    return looksLikeSqlite(head) ? { container: false, encrypted: false } : null;
}

/**
 * Refuses a container the file is too small to hold, before a minute of work goes into it.
 *
 * Only an uncompressed one can be measured this way: its length follows exactly from the size its
 * header records. Compression breaks the derivation, since the payload is then shorter than the
 * plaintext by a ratio nothing states in advance.
 */
function requireWholeContainer(container: SupportedBackupContainer, size: number): void {
    if (container.isCompressed || container.size <= 0) {
        return;
    }

    const expected = containerSize(container.size, container.isEncrypted);
    if (size < expected) {
        throw incompleteBackup(size, expected);
    }
}

/**
 * Reads a file a slice at a time, rather than as one read that lives for the whole of it.
 *
 * `Blob.stream()` is that one long read, and a browser is free to end it early. A low-memory Android
 * WebView was seen doing exactly that with a complete 4.8 GB backup: the same byte every time, no
 * error, just an end of input that a reader can only take at its word — which surfaced as a container
 * that had run out of frames. Asking for a bounded range at a time is what the chunked upload has
 * always done with files this size on the same hardware, and it is how the header below is read.
 *
 * Reaching the end before the file says it should is a failure here rather than silence, so a file
 * that really is short says so in its own terms instead of through whatever was parsing it.
 */
export function readInSlices(blob: Blob, sliceSize = SLICE_BYTES): ReadableStream<Uint8Array> {
    let offset = 0;

    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            if (offset >= blob.size) {
                controller.close();
                return;
            }

            const end = Math.min(offset + sliceSize, blob.size);
            const slice = new Uint8Array(await blob.slice(offset, end).arrayBuffer());
            if (slice.length === 0) {
                throw incompleteBackup(offset, blob.size);
            }

            offset += slice.length;
            controller.enqueue(slice);
        }
    });
}

/**
 * How much is asked for at once: large enough that the per-read cost is lost against the work done
 * with it, small enough that a device with very little memory never holds much. The container reads
 * in frames a quarter of this size, and the stream keeps one slice queued.
 */
const SLICE_BYTES = 4 * 1024 * 1024;

/** A file that stops before it should have, said in bytes because that is what makes it checkable. */
function incompleteBackup(read: number, expected: number): RestoreFailure {
    return new RestoreFailure(
        "backup-incomplete",
        `The backup file ends after ${read} bytes, short of the ${expected} it should hold. `
            + "It was probably not copied or downloaded in full."
    );
}

/** Turns a stream into the pull `importDb` asks for: a chunk each call, nothing at the end. */
function pullFrom(stream: ReadableStream<Uint8Array>): () => Promise<Uint8Array | undefined> {
    const reader = stream.getReader();

    return async () => {
        const { done, value } = await reader.read();

        return done ? undefined : value;
    };
}

/** Adds a slot if every one the pool has is spoken for, since a restore needs one for the candidate. */
async function makeRoomFor(pool: SAHPoolUtil): Promise<void> {
    if (pool.getFileCount() >= pool.getCapacity()) {
        await pool.addCapacity(1);
    }
}

/** Removes a pool entry, if it is there at all. Never the reason a restore fails. */
async function removeQuietly(pool: SAHPoolUtil, dbName: string): Promise<void> {
    try {
        pool.unlink(dbName);
    } catch {
        // A leftover entry costs a slot, which is not worth losing the answer over.
    }
}

function asFailure(e: unknown): RestoreFailure {
    if (e instanceof RestoreFailure) {
        return e;
    }
    if (isBackupContainerError(e)) {
        return new RestoreFailure(e.reason, e.message);
    }

    // Not "swap-failed": everything that reaches here failed before the swap was reached, and
    // saying otherwise would tell the user their database had been replaced and put back when it
    // was never touched.
    return new RestoreFailure("restore-failed", messageOf(e));
}

function messageOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
