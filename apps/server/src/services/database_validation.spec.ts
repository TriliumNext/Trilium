import { app_info as appInfo, OLDEST_SUPPORTED_DB_VERSION } from "@triliumnext/core";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";

import { validateDatabaseFile } from "./database_validation.js";

/*
 * What the checks decide is covered against a stand-in candidate in core, where it belongs and where
 * no file is needed. These cover the opening: that a real database on disk answers those checks
 * correctly through this platform's driver, and that files which are not one are turned away.
 */

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trilium-db-validation-spec-"));
let counter = 0;

afterAll(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

/** A database with the tables and options a Trilium document has, and nothing else. */
function triliumDatabase(options: Record<string, string>, tables = [ "options", "notes", "branches", "blobs" ]) {
    return databaseWith((db) => {
        for (const table of tables) {
            db.exec(`CREATE TABLE ${table} (name TEXT, value TEXT)`);
        }
        if (tables.includes("options")) {
            const insert = db.prepare("INSERT INTO options (name, value) VALUES (?, ?)");
            for (const [ name, value ] of Object.entries(options)) {
                insert.run(name, value);
            }
        }
    });
}

function databaseWith(build: (db: Database.Database) => void) {
    const filePath = path.join(tempRoot, `case-${counter++}.db`);
    const db = new Database(filePath);
    try {
        build(db);
    } finally {
        db.close();
    }

    return filePath;
}

function fileWith(content: Buffer | string) {
    const filePath = path.join(tempRoot, `case-${counter++}.bin`);
    fs.writeFileSync(filePath, content);

    return filePath;
}

const CURRENT = { initialized: "true", dbVersion: String(appInfo.dbVersion) };

describe("opening a candidate database on this platform", () => {
    it("reads a real database's integrity, tables and options, and accepts it", () => {
        expect(validateDatabaseFile(triliumDatabase(CURRENT))).toEqual({
            valid: true, dbVersion: appInfo.dbVersion, needsMigration: false
        });

        const older = triliumDatabase({ initialized: "true", dbVersion: String(OLDEST_SUPPORTED_DB_VERSION) });
        expect(validateDatabaseFile(older)).toEqual({
            valid: true, dbVersion: OLDEST_SUPPORTED_DB_VERSION, needsMigration: true
        });
    });

    it("carries a rejection back from the checks, with the driver's own answers behind it", () => {
        const notOurs = databaseWith((db) => db.exec("CREATE TABLE recipes (name TEXT)"));

        expect(validateDatabaseFile(notOurs)).toMatchObject({
            valid: false,
            rejection: "not-a-trilium-database",
            message: expect.stringContaining("options, notes, branches, blobs")
        });
    });

    it("refuses a file that is not a SQLite database, whatever it is called", () => {
        expect(validateDatabaseFile(fileWith("this is a text file, not a database"))).toMatchObject({
            valid: false, rejection: "not-a-database"
        });
        // Shorter than the header it would have to start with.
        expect(validateDatabaseFile(fileWith("SQLite"))).toMatchObject({ valid: false, rejection: "not-a-database" });
        expect(validateDatabaseFile(path.join(tempRoot, "nothing-here.db"))).toMatchObject({
            valid: false, rejection: "not-a-database"
        });
    });

    it("refuses a database whose pages have been damaged", () => {
        const filePath = databaseWith((db) => {
            db.exec("CREATE TABLE notes (noteId TEXT, title TEXT)");
            const insert = db.prepare("INSERT INTO notes VALUES (?, ?)");
            for (let i = 0; i < 500; i++) {
                insert.run(`note${i}`, `title ${i}`.repeat(20));
            }
        });

        // Somewhere past the first page, so the file still opens and the damage is found by reading it.
        const damaged = fs.readFileSync(filePath);
        damaged.fill(0xff, 4096 + 24, 4096 + 200);
        fs.writeFileSync(filePath, damaged);

        expect(validateDatabaseFile(filePath)).toMatchObject({ valid: false, rejection: "damaged-database" });
    });
});
