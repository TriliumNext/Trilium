import Database, { type Database as DatabaseType } from "better-sqlite3";
import { describe, expect, it } from "vitest";

import {
    compareDatabases,
    compareRows,
    compareTable,
    type Comparison,
    COMPARISONS,
    findMissing,
    handleBuffer
} from "./comparator.js";

/** Builds an in-memory database with the (legacy v214) schema the comparison queries expect. */
function createDatabase(): DatabaseType {
    const db = new Database(":memory:");

    db.exec(`
        CREATE TABLE branches (branchId TEXT PRIMARY KEY, noteId TEXT, parentNoteId TEXT, notePosition INT, utcDateModified TEXT, isDeleted INT, prefix TEXT);
        CREATE TABLE notes (noteId TEXT PRIMARY KEY, title TEXT, dateCreated TEXT, utcDateCreated TEXT, isProtected INT, isDeleted INT);
        CREATE TABLE note_contents (noteId TEXT PRIMARY KEY, content);
        CREATE TABLE note_revisions (noteRevisionId TEXT PRIMARY KEY, noteId TEXT, title TEXT, dateCreated TEXT, dateLastEdited TEXT, utcDateCreated TEXT, utcDateLastEdited TEXT, isProtected INT);
        CREATE TABLE note_revision_contents (noteRevisionId TEXT PRIMARY KEY, content);
        CREATE TABLE options (name TEXT PRIMARY KEY, value TEXT, utcDateModified TEXT, isSynced INT);
        CREATE TABLE attributes (attributeId TEXT PRIMARY KEY, noteId TEXT, type TEXT, name TEXT, value TEXT);
        CREATE TABLE etapi_tokens (etapiTokenId TEXT PRIMARY KEY, name TEXT, tokenHash TEXT, utcDateCreated TEXT, utcDateModified TEXT, isDeleted INT);
        CREATE TABLE entity_changes (entityName TEXT, entityId TEXT, hash TEXT, isErased INT, isSynced INT, utcDateChanged TEXT);
    `);

    return db;
}

describe("comparison logic", () => {
    it("findMissing returns items of the first list absent from the second", () => {
        expect(findMissing(["a", "b", "c"], ["b"])).toEqual(["a", "c"]);
        expect(findMissing(["a"], ["a"])).toEqual([]);
        expect(findMissing([], ["a"])).toEqual([]);
    });

    it("handleBuffer stringifies Buffer content but leaves strings untouched", () => {
        expect(handleBuffer({ content: Buffer.from("hello") })).toEqual({ content: "hello" });

        const asString = { content: "already a string" };
        expect(handleBuffer(asString)).toBe(asString);
        expect(asString.content).toBe("already a string");
    });

    it("compareRows reports counts, IDs missing on each side, and differing rows", () => {
        const left = { a: { id: "a", v: 1 }, b: { id: "b", v: 2 }, c: { id: "c", v: 3 } };
        const right = { b: { id: "b", v: 2 }, c: { id: "c", v: 999 }, d: { id: "d", v: 4 } };

        const result = compareRows("notes", "id", left, right);

        expect(result).toMatchObject({
            table: "notes",
            column: "id",
            leftCount: 3,
            rightCount: 3,
            missingFromRight: ["a"],
            missingFromLeft: ["d"]
        });
        // "b" is identical on both sides and must not be reported; "c" differs.
        expect(result.differingRows.map(row => row.id)).toEqual(["c"]);
        expect(result.differingRows[0].left).toContain("\"v\": 3");
        expect(result.differingRows[0].right).toContain("\"v\": 999");
    });

    it("compareRows normalizes Buffer content before diffing, so equal content does not differ", () => {
        const left = { n1: { noteId: "n1", content: Buffer.from("same") } };
        const right = { n1: { noteId: "n1", content: "same" } };

        expect(compareRows("note_contents", "noteId", left, right).differingRows).toEqual([]);
    });
});

describe("compareDatabases (better-sqlite3)", () => {
    it("compares rows read from two databases for a given query", () => {
        const left = createDatabase();
        const right = createDatabase();

        const insertNote = (db: DatabaseType, noteId: string, title: string) =>
            db.prepare("INSERT INTO notes (noteId, title, isDeleted) VALUES (?, ?, 0)").run(noteId, title);

        insertNote(left, "n1", "Left title");
        insertNote(left, "n2", "Only on the left");
        insertNote(right, "n1", "Right title");
        insertNote(right, "n3", "Only on the right");

        const queries: Comparison[] = [
            { table: "notes", column: "noteId", query: "SELECT noteId, title FROM notes WHERE isDeleted = 0" }
        ];

        const [notes] = compareDatabases(left, right, queries);

        expect(notes).toMatchObject({
            table: "notes",
            leftCount: 2,
            rightCount: 2,
            missingFromRight: ["n2"],
            missingFromLeft: ["n3"]
        });
        expect(notes.differingRows.map(row => row.id)).toEqual(["n1"]);

        left.close();
        right.close();
    });

    it("compareTable throws when a table is missing (e.g. databases on different schema versions)", () => {
        const left = createDatabase();
        const right = new Database(":memory:"); // right is missing the `notes` table entirely

        const comparison: Comparison = { table: "notes", column: "noteId", query: "SELECT noteId FROM notes" };

        expect(() => compareTable(left, right, comparison)).toThrowError(/no such table: notes/);

        left.close();
        right.close();
    });

    it("runs every default comparison against the real schema", () => {
        const left = createDatabase();
        const right = createDatabase();

        // An option added only on the right (mirrors options introduced by a migration).
        right.prepare("INSERT INTO options (name, value, isSynced) VALUES ('newOption', '42', 1)").run();
        // Options that are not synced must be excluded by the WHERE clause.
        left.prepare("INSERT INTO options (name, value, isSynced) VALUES ('localOnly', 'x', 0)").run();
        right.prepare("INSERT INTO options (name, value, isSynced) VALUES ('localOnly', 'y', 0)").run();
        // A synced entity change whose hash differs between the two databases.
        left.prepare("INSERT INTO entity_changes (entityName, entityId, hash, isErased, isSynced) VALUES ('notes', 'n1', 'h1', 0, 1)").run();
        right.prepare("INSERT INTO entity_changes (entityName, entityId, hash, isErased, isSynced) VALUES ('notes', 'n1', 'h2', 0, 1)").run();

        const results = compareDatabases(left, right);

        // Every configured table produces a result, proving all the default SQL queries execute.
        expect(results.map(result => result.table)).toEqual(COMPARISONS.map(comparison => comparison.table));

        const options = results.find(result => result.table === "options");
        expect(options?.missingFromLeft).toEqual(["newOption"]);
        // "localOnly" is filtered out by `isSynced = 1` on both sides.
        expect(options?.differingRows).toEqual([]);

        const entityChanges = results.find(result => result.table === "entity_changes");
        // The `entityName || '-' || entityId` expression is used as the unique id.
        expect(entityChanges?.differingRows.map(row => row.id)).toEqual(["notes-n1"]);

        left.close();
        right.close();
    });
});
