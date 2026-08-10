import {
    type CandidateDatabase,
    type DatabaseValidation,
    looksLikeSqlite,
    validateDatabase
} from "@triliumnext/core";
import Database from "better-sqlite3";
import fs from "fs";

/**
 * Opens a candidate database on this platform and puts it through the shared checks.
 *
 * Only the opening is here. What makes a database ours is decided in core, so that a platform which
 * keeps its databases somewhere other than a filesystem answers the same questions the same way.
 *
 * @module
 */

/**
 * Reads `filePath` and reports whether it can become this instance's database.
 *
 * The file is opened read-only through its own connection, so nothing here touches the database the
 * application is currently attached to, and pages are read as they are needed rather than the whole
 * file at once.
 */
export function validateDatabaseFile(filePath: string): DatabaseValidation {
    if (!hasSqliteHeader(filePath)) {
        return { valid: false, rejection: "not-a-database", message: "The file is not a SQLite database." };
    }

    let db: Database.Database;
    try {
        db = new Database(filePath, {
            readonly: true,
            fileMustExist: true,
            nativeBinding: process.env.BETTERSQLITE3_NATIVE_PATH || undefined
        });
    } catch (e) {
        return {
            valid: false,
            rejection: "not-a-database",
            message: `The database could not be opened: ${messageOf(e)}`
        };
    }

    try {
        return validateDatabase(candidateOf(db));
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

/** The three questions the checks ask, answered by a better-sqlite3 connection. */
function candidateOf(db: Database.Database): CandidateDatabase {
    return {
        integrityCheck: () => String(db.pragma("quick_check", { simple: true })),
        tableNames: () => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all() as string[],
        option: (name: string) =>
            db.prepare("SELECT value FROM options WHERE name = ?").pluck().get(name) as string | undefined
    };
}

/**
 * Checks the file starts the way a SQLite database does, which costs sixteen bytes and spares the
 * user an error about a malformed database when what they picked was a photograph.
 */
function hasSqliteHeader(filePath: string): boolean {
    const head = Buffer.alloc(16);
    let descriptor: number | undefined;

    try {
        descriptor = fs.openSync(filePath, "r");
        const read = fs.readSync(descriptor, head, 0, head.length, 0);

        return looksLikeSqlite(head.subarray(0, read));
    } catch {
        return false;
    } finally {
        if (descriptor !== undefined) {
            fs.closeSync(descriptor);
        }
    }
}

function messageOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
