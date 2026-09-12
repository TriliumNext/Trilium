/**
 * Streams the database out of the browser without ever holding it whole, or copying it first.
 *
 * The SAH pool has no streaming read, and staging a copy of the database beside itself needs
 * storage a browser quota may simply not have. What the pool does have is SQLite, and SQLite can
 * serve its own file a page at a time through the `sqlite_dbpage` table, the same mechanism the
 * official `sqlite3_rsync` utility is built on. The pages come straight off the live database,
 * and consistency is watched rather than arranged: the database's write counters are checked as
 * the stream goes, and a write landing mid-stream errors it so the caller can start over.
 *
 * Deliberately a dumb pipe: {@link streamLiveDatabasePages} turns the live database into a
 * `ReadableStream` of page batches, and where they flow is the caller's story — today that is the
 * backup download, which relays them through the service worker to the browser's disk.
 *
 * @module
 */

/**
 * How many pages are fetched, and travel, per stream chunk.
 *
 * One statement covers the whole batch, so this is the number of rows a single query steps through
 * rather than the number of queries. Larger batches therefore cost almost nothing extra in
 * round trips and only buy fewer of them, while the memory held is one batch: 4 MiB at an 8 KiB
 * page, 2 MiB at 4 KiB, which the container immediately re-cuts into its own 1 MiB frames.
 */
const BATCH_PAGES = 512;

/** Reads the live database through the core SQL layer, which fronts the one connection there is. */
export interface LiveDatabaseReader {
    getValue(sql: string, params?: unknown[]): unknown;
    /** One column of every row, which is how a whole batch of pages arrives in one statement. */
    getColumn(sql: string, params?: unknown[]): unknown[];
}

/** What the read cost, for a caller that wants to say where a slow backup spent its time. */
export interface StreamTiming {
    /** Milliseconds spent inside the page reads, as against waiting on whatever consumes them. */
    readMs: number;
    /** Pages handed over so far. */
    pages: number;
}

/** Thrown by {@link streamLiveDatabasePages} when a write lands mid-stream. The caller retries. */
export class DatabaseChangedError extends Error {
    constructor() {
        super("The database changed while it was being backed up.");
        this.name = "DatabaseChangedError";
    }
}

export interface DatabaseStream {
    /** Exact size of the streamed database, known before the first byte flows. */
    byteSize: number;
    stream: ReadableStream<Uint8Array>;
    /** Updated as the stream runs, so a caller can report where the time went. */
    timing: StreamTiming;
}

/**
 * Streams the live database as its exact logical bytes, without any copy of it anywhere.
 *
 * The database is in use while it is being read, and there is only the one connection, so nothing
 * can hold the content in place across the stream's yields. Consistency comes from detection
 * instead: the write counters are fingerprinted at the start and checked before every batch and
 * once more before the stream closes, and any write anywhere in between errors the stream with
 * {@link DatabaseChangedError} rather than sealing a backup that is part before and part after.
 * Every write in this process goes through the one connection the counters watch, so nothing can
 * slip past them.
 *
 * @throws Error before any stream exists when the engine lacks `sqlite_dbpage`, so a caller fails
 *   before it has created a destination to clean up.
 */
export function streamLiveDatabasePages(db: LiveDatabaseReader): DatabaseStream {
    const pageSize = countOf(db.getValue("PRAGMA page_size"), "page_size");
    const pageCount = countOf(db.getValue("PRAGMA page_count"), "page_count");
    const fingerprint = fingerprintOf(db);

    const timing: StreamTiming = { readMs: 0, pages: 0 };
    let nextPage = 1;

    return {
        byteSize: pageSize * pageCount,
        timing,
        stream: new ReadableStream<Uint8Array>({
            pull(controller) {
                const startedAt = Date.now();
                try {
                    if (fingerprintOf(db) !== fingerprint) {
                        throw new DatabaseChangedError();
                    }
                    if (nextPage > pageCount) {
                        controller.close();
                        return;
                    }

                    const pages = Math.min(BATCH_PAGES, pageCount - nextPage + 1);
                    const batch = readLivePages(db, nextPage, pages, pageSize);
                    nextPage += pages;
                    timing.pages += pages;

                    controller.enqueue(batch);
                } catch (e) {
                    controller.error(e);
                } finally {
                    timing.readMs += Date.now() - startedAt;
                }
            }
        })
    };
}

/**
 * A run of pages, in one statement rather than one per page.
 *
 * This is the whole of what a backup costs to read, and the difference between the two shapes is
 * not small: a page at a time means preparing, binding, stepping and finalising a query against a
 * virtual table for every page in the database, which for a multi-gigabyte one is over a million
 * round trips into WebAssembly. Stepping one statement across the range does the same work once.
 */
function readLivePages(
    db: LiveDatabaseReader,
    firstPage: number,
    pages: number,
    pageSize: number
): Uint8Array {
    const rows = db.getColumn(
        "SELECT data FROM sqlite_dbpage WHERE pgno BETWEEN ? AND ? ORDER BY pgno",
        [ firstPage, firstPage + pages - 1 ]
    );

    if (rows.length !== pages) {
        throw new Error(`Pages ${firstPage} to ${firstPage + pages - 1}: got ${rows.length} of ${pages}.`);
    }

    const batch = new Uint8Array(pages * pageSize);
    for (let index = 0; index < pages; index++) {
        const data = rows[index];
        if (!(data instanceof Uint8Array) || data.byteLength !== pageSize) {
            throw new Error(`Page ${firstPage + index} came back malformed.`);
        }
        batch.set(data, index * pageSize);
    }

    return batch;
}

/**
 * What must not have moved between two looks for the pages to belong to one database: rows changed
 * on this connection, the schema's own version, and the file's page count.
 */
function fingerprintOf(db: LiveDatabaseReader): string {
    return [
        db.getValue("SELECT total_changes()"),
        db.getValue("PRAGMA schema_version"),
        db.getValue("PRAGMA page_count")
    ].join("/");
}

/** A pragma answer as the positive integer it must be, or the reason it is not a database. */
function countOf(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`The database reports no usable ${name} (got ${String(value)}).`);
    }
    return value;
}

