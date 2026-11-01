import { describe, expect, it } from "vitest";

import appInfo from "./app_info.js";
import {
    type CandidateDatabase,
    looksLikeSqlite,
    OLDEST_SUPPORTED_DB_VERSION,
    validateDatabase
} from "./database_validation.js";

const TRILIUM_TABLES = [ "options", "notes", "branches", "blobs" ];

/** A candidate that answers whatever the test says it does, without a database engine involved. */
function candidate(answers: {
    integrity?: string;
    tables?: string[];
    options?: Record<string, string>;
} = {}): CandidateDatabase {
    const options = answers.options ?? { initialized: "true", dbVersion: String(appInfo.dbVersion) };

    return {
        integrityCheck: () => answers.integrity ?? "ok",
        tableNames: () => answers.tables ?? TRILIUM_TABLES,
        option: (name) => options[name]
    };
}

function bytesOf(text: string): Uint8Array {
    return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

describe("recognising a SQLite database by its first bytes", () => {
    it("accepts the header every SQLite database begins with", () => {
        expect(looksLikeSqlite(bytesOf("SQLite format 3\0"))).toBe(true);
        // Whatever follows it is the database's business, not this check's.
        expect(looksLikeSqlite(bytesOf("SQLite format 3\0and then some"))).toBe(true);
    });

    it("refuses anything else, including too little to tell", () => {
        expect(looksLikeSqlite(bytesOf("this is a text file"))).toBe(false);
        expect(looksLikeSqlite(bytesOf("SQLite"))).toBe(false);
        expect(looksLikeSqlite(new Uint8Array())).toBe(false);
        // Right length, one byte wrong.
        expect(looksLikeSqlite(bytesOf("SQLite format 4\0"))).toBe(false);
    });
});

describe("validating a candidate database", () => {
    it("accepts one from this version, and one that only needs migrating", () => {
        expect(validateDatabase(candidate())).toEqual({
            valid: true, dbVersion: appInfo.dbVersion, needsMigration: false
        });

        const older = candidate({
            options: { initialized: "true", dbVersion: String(OLDEST_SUPPORTED_DB_VERSION) }
        });
        expect(validateDatabase(older)).toEqual({
            valid: true, dbVersion: OLDEST_SUPPORTED_DB_VERSION, needsMigration: true
        });
    });

    it("refuses one that does not pass its own integrity check", () => {
        expect(validateDatabase(candidate({ integrity: "row 3 missing from index sqlite_autoindex_notes_1" })))
            .toMatchObject({ valid: false, rejection: "damaged-database" });
    });

    it("refuses a database that is not one of ours, naming what is missing", () => {
        expect(validateDatabase(candidate({ tables: [ "recipes" ] }))).toMatchObject({
            valid: false,
            rejection: "not-a-trilium-database",
            message: expect.stringContaining("options, notes, branches, blobs")
        });

        expect(validateDatabase(candidate({ tables: [ "options", "notes" ] }))).toMatchObject({
            valid: false, rejection: "not-a-trilium-database", message: expect.stringContaining("branches, blobs")
        });
    });

    it("refuses one left behind by a setup that never finished", () => {
        const unfinished = candidate({ options: { dbVersion: String(appInfo.dbVersion) } });

        expect(validateDatabase(unfinished)).toMatchObject({
            valid: false, rejection: "database-not-initialized"
        });
    });

    it("refuses one from a version this cannot migrate, in either direction", () => {
        const tooOld = candidate({
            options: { initialized: "true", dbVersion: String(OLDEST_SUPPORTED_DB_VERSION - 1) }
        });
        expect(validateDatabase(tooOld)).toMatchObject({ valid: false, rejection: "database-too-old" });

        const tooNew = candidate({
            options: { initialized: "true", dbVersion: String(appInfo.dbVersion + 1) }
        });
        expect(validateDatabase(tooNew)).toMatchObject({
            valid: false, rejection: "database-too-new", message: expect.stringContaining(String(appInfo.dbVersion))
        });
    });

    it("refuses one that does not say which version it is from", () => {
        expect(validateDatabase(candidate({ options: { initialized: "true" } }))).toMatchObject({
            valid: false, rejection: "not-a-trilium-database"
        });

        expect(validateDatabase(candidate({ options: { initialized: "true", dbVersion: "recent" } })))
            .toMatchObject({ valid: false, rejection: "not-a-trilium-database" });
    });

    it("leaves the scan out when asked to, and keeps every other check", () => {
        const asked: string[] = [];
        const watched: CandidateDatabase = {
            integrityCheck: () => { asked.push("integrity"); return "malformed database schema"; },
            tableNames: () => { asked.push("tables"); return TRILIUM_TABLES; },
            option: (name) => {
                asked.push(`option:${name}`);
                return name === "initialized" ? "true" : String(appInfo.dbVersion);
            }
        };

        // Accepted despite an integrity check that would have failed, because it is never put.
        expect(validateDatabase(watched, { skipIntegrityCheck: true }))
            .toMatchObject({ valid: true, dbVersion: appInfo.dbVersion });
        expect(asked).toEqual([ "tables", "option:initialized", "option:dbVersion" ]);

        // Nothing else is waived: a database that is not ours is still refused.
        expect(validateDatabase(candidate({ tables: [ "recipes" ] }), { skipIntegrityCheck: true }))
            .toMatchObject({ valid: false, rejection: "not-a-trilium-database" });
    });

    it("asks the cheapest questions first, so a damaged database is not read for its options", () => {
        const asked: string[] = [];
        const damaged: CandidateDatabase = {
            integrityCheck: () => { asked.push("integrity"); return "malformed database schema"; },
            tableNames: () => { asked.push("tables"); return TRILIUM_TABLES; },
            option: (name) => { asked.push(`option:${name}`); return undefined; }
        };

        expect(validateDatabase(damaged)).toMatchObject({ rejection: "damaged-database" });
        expect(asked).toEqual([ "integrity" ]);
    });
});
