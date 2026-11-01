import appInfo from "./app_info.js";

/**
 * Decides whether a database can become this instance's, before anything depends on the answer.
 *
 * A restore replaces the document the whole application is about, and the file it replaces it with
 * arrived from outside: an upload, a directory listing, a file the user picked. "It has a .db
 * extension" says nothing, and finding out later is not an option, because the code that would find
 * out is the migration, and a migration that cannot proceed calls `crash()`.
 *
 * The checks live here, apart from the opening: what makes a database ours is the same everywhere,
 * while opening one is not. A platform supplies a {@link CandidateDatabase}, which is the whole of
 * what these checks need and is deliberately small enough that any driver can offer it — a second
 * connection on the server, an entry read out of the browser's own storage, page by page in both
 * cases rather than in memory.
 *
 * @module
 */

/** The oldest database the migrations still reach back to; below this one, there is no upgrade path. */
export const OLDEST_SUPPORTED_DB_VERSION = 214;

/** What every SQLite database begins with, in the encoding the bytes are read as. */
const SQLITE_MAGIC = "SQLite format 3\0";

const REQUIRED_TABLES = [ "options", "notes", "branches", "blobs" ];

export type DatabaseRejection =
    /** Not a SQLite database at all. */
    | "not-a-database"
    /** SQLite, but corrupt. */
    | "damaged-database"
    /** A SQLite database, but not one of ours. */
    | "not-a-trilium-database"
    /** Ours, but from a setup that never finished, so there is nothing to restore. */
    | "database-not-initialized"
    /** From a version so old the migrations no longer reach back to it. */
    | "database-too-old"
    /** From a newer version, which this one cannot read. */
    | "database-too-new";

export type DatabaseValidation =
    | { valid: true; dbVersion: number; needsMigration: boolean }
    | { valid: false; rejection: DatabaseRejection; message: string };

/**
 * A candidate database, open and readable, reduced to the three questions validation asks of it.
 *
 * Each is a plain read: nothing here writes, and nothing needs the whole database at once.
 */
export interface CandidateDatabase {
    /**
     * What `PRAGMA quick_check` answers, which is `"ok"` and nothing else when all is well. Not
     * asked at all when {@link ValidationOptions.skipIntegrityCheck} is set.
     */
    integrityCheck(): string;
    /** The names of the tables it has. */
    tableNames(): string[];
    /** A value from the `options` table, or `undefined` where there is no such row. */
    option(name: string): string | undefined;
}

/**
 * Reports whether `head` starts the way a SQLite database does.
 *
 * Sixteen bytes, asked before a database engine is involved at all, so that a photograph gets an
 * answer about what it is rather than one about a malformed database.
 *
 * @param head the first bytes of the file; anything shorter than the magic is not one.
 */
export function looksLikeSqlite(head: Uint8Array): boolean {
    if (head.length < SQLITE_MAGIC.length) {
        return false;
    }

    for (let i = 0; i < SQLITE_MAGIC.length; i++) {
        if (head[i] !== SQLITE_MAGIC.charCodeAt(i)) {
            return false;
        }
    }

    return true;
}

/** What a platform may leave out of the checks, and why it is allowed to. */
export interface ValidationOptions {
    /**
     * Leaves out `PRAGMA quick_check`, which is the only check whose cost grows with the database.
     *
     * For a platform where that scan is prohibitive, and where the bytes have already been accounted
     * for by other means. Everything else here is a handful of small reads and is always done.
     */
    skipIntegrityCheck?: boolean;
}

/**
 * Puts an open candidate through every check, in the order that answers most cheaply first.
 *
 * `PRAGMA quick_check` reads the whole database, which for a large one is not instant. It is worth
 * it: a restore that succeeds and leaves the user with a corrupt document is worse than one that
 * takes another minute to say no. Where it is not worth it, see
 * {@link ValidationOptions.skipIntegrityCheck}.
 *
 * @throws whatever the driver throws on a database too damaged to query; the caller knows its own
 *         driver's failures and turns them into {@link DatabaseRejection}.
 */
export function validateDatabase(db: CandidateDatabase, options: ValidationOptions = {}): DatabaseValidation {
    const integrity = options.skipIntegrityCheck ? "ok" : db.integrityCheck();
    if (integrity !== "ok") {
        return reject("damaged-database", `The database failed its integrity check: ${integrity}`);
    }

    const tables = new Set(db.tableNames());
    const missing = REQUIRED_TABLES.filter((table) => !tables.has(table));
    if (missing.length > 0) {
        return reject(
            "not-a-trilium-database",
            `The database is missing the ${missing.join(", ")} table${missing.length > 1 ? "s" : ""}.`
        );
    }

    if (db.option("initialized") !== "true") {
        return reject(
            "database-not-initialized",
            "The database is from a setup that never finished, so it holds nothing to restore."
        );
    }

    const dbVersion = Number(db.option("dbVersion"));
    if (!Number.isInteger(dbVersion)) {
        return reject("not-a-trilium-database", "The database does not state which version it is from.");
    }
    if (dbVersion < OLDEST_SUPPORTED_DB_VERSION) {
        return reject(
            "database-too-old",
            `The database is version ${dbVersion}; the oldest that can still be migrated is ${OLDEST_SUPPORTED_DB_VERSION}.`
        );
    }
    if (dbVersion > appInfo.dbVersion) {
        return reject(
            "database-too-new",
            `The database is version ${dbVersion}, which is newer than this application's ${appInfo.dbVersion}.`
        );
    }

    return { valid: true, dbVersion, needsMigration: dbVersion < appInfo.dbVersion };
}

function reject(rejection: DatabaseRejection, message: string): DatabaseValidation {
    return { valid: false, rejection, message };
}
