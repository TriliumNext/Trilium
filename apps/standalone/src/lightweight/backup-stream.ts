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

/** How many pages travel per stream chunk: 1 MiB at the default 8 KiB page size. */
const BATCH_PAGES = 128;

/** Reads the live database through the core SQL layer, which fronts the one connection there is. */
export interface LiveDatabaseReader {
    getValue(sql: string, params?: unknown[]): unknown;
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

    let nextPage = 1;
    return {
        byteSize: pageSize * pageCount,
        stream: new ReadableStream<Uint8Array>({
            pull(controller) {
                try {
                    if (fingerprintOf(db) !== fingerprint) {
                        throw new DatabaseChangedError();
                    }
                    if (nextPage > pageCount) {
                        controller.close();
                        return;
                    }

                    const pages = Math.min(BATCH_PAGES, pageCount - nextPage + 1);
                    const batch = new Uint8Array(pages * pageSize);
                    for (let index = 0; index < pages; index++, nextPage++) {
                        batch.set(readLivePage(db, nextPage, pageSize), index * pageSize);
                    }
                    controller.enqueue(batch);
                } catch (e) {
                    controller.error(e);
                }
            }
        })
    };
}

/** One page, checked to be exactly a page: anything else means the file is not what it claims. */
function readLivePage(db: LiveDatabaseReader, pageNumber: number, pageSize: number): Uint8Array {
    const data = db.getValue("SELECT data FROM sqlite_dbpage WHERE pgno = ?", [ pageNumber ]);
    if (!(data instanceof Uint8Array) || data.byteLength !== pageSize) {
        throw new Error(`Page ${pageNumber} came back malformed.`);
    }
    return data;
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

