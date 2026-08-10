import type { SAHPoolUtil } from "@sqlite.org/sqlite-wasm";
import {
    FIXED_HEADER_BYTES,
    isBackupContainerError,
    peekBackupContainer,
    type ProgressCallback,
    readBackupContainer
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
        await stageCandidate(target.pool, candidate, backup, options.passphrase, (fraction) =>
            report({ stage: "staging", fraction }));

        report({ stage: "validating" });
        const validation = validate(target.pool, candidate);
        if (!validation.valid) {
            throw new RestoreFailure(validation.rejection, validation.message);
        }

        report({ stage: "swapping" });
        await swapIn(target, live, candidate);

        report({ stage: "done" });
    } catch (e) {
        const failure = asFailure(e);
        // The candidate is no use to anyone now, and the pool's slots are finite.
        await removeQuietly(target.pool, candidate);
        report({ stage: "failed", error: failure.message, reason: failure.reason });

        throw failure;
    }
}

/** A failure with a reason attached, so the setup screen can tell the cases apart. */
export class RestoreFailure extends Error {
    constructor(readonly reason: string, message: string) {
        super(message);
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
        await pool.importDb(candidate, pullFrom(backup.stream()));
        onProgress(1);
        return;
    }

    // Asked before the file is read rather than after: an encrypted container without a passphrase
    // fails the same way either way, but only one of them takes minutes to get there.
    if (format.encrypted && !passphrase) {
        throw new RestoreFailure("passphrase-required", "The backup is encrypted.");
    }

    const relay = new TransformStream<Uint8Array, Uint8Array>();
    const unwrapped = readBackupContainer(backup.stream(), relay.writable, { passphrase, onProgress });
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
        // What a database too damaged to query throws is this driver's business, not the checks'.
        return {
            valid: false,
            rejection: "damaged-database",
            message: `The database could not be read: ${messageOf(e)}`
        };
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
    await writeCurrentDatabaseName(candidate);

    try {
        target.open(candidate);
    } catch (e) {
        // Put back what was live, so a candidate that will not open costs nothing.
        await writeCurrentDatabaseName(previous);
        target.open(previous);

        throw new RestoreFailure("swap-failed", messageOf(e));
    }

    // Only once the restored database is open: until then the old one is what a restart needs.
    await removeQuietly(target.pool, previous);
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
    const container = peekBackupContainer(head);

    if (container) {
        return { container: true, encrypted: container.encrypted };
    }

    return looksLikeSqlite(head) ? { container: false, encrypted: false } : null;
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

    return new RestoreFailure("swap-failed", messageOf(e));
}

function messageOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
