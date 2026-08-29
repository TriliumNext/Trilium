import { readAnkiCollectionMetadata } from "@triliumnext/core/src/services/import/anki.js";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import BetterSqlite3Provider from "./sql_provider.js";

let counter = 0;
const tmpFiles: string[] = [];
function tmpDbPath() {
    const f = path.join(os.tmpdir(), `tsqlprov-${process.pid}-${counter++}.db`);
    tmpFiles.push(f);
    return f;
}

afterEach(() => {
    vi.restoreAllMocks();
    for (const f of tmpFiles.splice(0)) {
        for (const suffix of ["", "-wal", "-shm"]) {
            try {
                fs.unlinkSync(f + suffix);
            } catch { /* file may not exist */ }
        }
    }
});

describe("BetterSqlite3Provider", () => {
    it("runs queries, transactions and exec against an in-memory database", () => {
        const provider = new BetterSqlite3Provider();
        provider.loadFromMemory();

        provider.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
        (provider.prepare("INSERT INTO t (id, v) VALUES (?, ?)") as any).run(1, "a");
        expect((provider.prepare("SELECT v FROM t WHERE id = ?") as any).get(1)).toEqual({ v: "a" });

        expect(provider.inTransaction).toBe(false);
        const tx = provider.transaction(() => {
            (provider.prepare("INSERT INTO t (id, v) VALUES (2, 'b')") as any).run();
        }) as unknown as () => void;
        tx();
        expect((provider.prepare("SELECT COUNT(*) AS c FROM t") as any).get()).toEqual({ c: 2 });

        provider.close();
    });

    it("opens imported SQLite bytes without replacing the live database", () => {
        const source = new Database(":memory:");
        source.exec(/*sql*/`
            CREATE TABLE imported (value TEXT);
            INSERT INTO imported VALUES ('anki');
            CREATE TABLE col (ver INTEGER, decks TEXT, models TEXT);
            INSERT INTO col VALUES (18, '', '');
            CREATE TABLE decks (id INTEGER, name TEXT);
            INSERT INTO decks VALUES (10, 'Languages::French');
            CREATE TABLE notetypes (id INTEGER, config TEXT);
            INSERT INTO notetypes VALUES (20, '{}');
            CREATE TABLE fields (ntid INTEGER, ord INTEGER, name TEXT);
            INSERT INTO fields VALUES (20, 0, 'Text');
            CREATE TABLE templates (ntid INTEGER, ord INTEGER, name TEXT, config TEXT);
            INSERT INTO templates VALUES (20, 0, 'Card 1', '{}');
        `);
        const bytes = source.serialize();
        source.close();

        const provider = new BetterSqlite3Provider();
        provider.loadFromMemory();
        provider.exec("CREATE TABLE live (value TEXT); INSERT INTO live VALUES ('trilium')");

        const imported = provider.openReadOnlyDatabase(bytes);
        expect(imported.getRows("SELECT value FROM imported")).toEqual([{ value: "anki" }]);
        expect(JSON.parse(readAnkiCollectionMetadata(imported).decks)).toEqual({
            "10": { id: 10, name: "Languages::French" }
        });
        expect((provider.prepare("SELECT value FROM live") as any).all()).toEqual([
            { value: "trilium" }
        ]);

        imported.close();
        provider.close();
    });

    it("loads from a file (WAL mode) and backs up flashcard tables to a destination", async () => {
        const dbPath = tmpDbPath();
        const provider = new BetterSqlite3Provider();
        provider.loadFromFile(dbPath, false);
        provider.exec(/*sql*/`
            CREATE TABLE x (id INTEGER);
            CREATE TABLE flashcards (cardId TEXT PRIMARY KEY, noteId TEXT, due TEXT, queue TEXT);
            CREATE TABLE flashcard_reviews (reviewId TEXT PRIMARY KEY, cardId TEXT, rating INTEGER);
            INSERT INTO flashcards VALUES ('card-backup', 'note-backup', '2026-01-02T12:00:00.000Z', 'review');
            INSERT INTO flashcard_reviews VALUES ('review-backup', 'card-backup', 3);
        `);
        expect(fs.existsSync(dbPath)).toBe(true);

        // Fresh destination → the pre-delete unlinkSync throws (missing) and is swallowed.
        const backupA = tmpDbPath();
        await provider.backup(backupA);
        await vi.waitFor(() => expect(fs.existsSync(backupA)).toBe(true), { timeout: 2000 });

        const backedUp = provider.openReadOnlyDatabase(fs.readFileSync(backupA));
        expect(backedUp.getRows("SELECT cardId, due, queue FROM flashcards")).toEqual([
            { cardId: "card-backup", due: "2026-01-02T12:00:00.000Z", queue: "review" }
        ]);
        expect(backedUp.getRows("SELECT reviewId, cardId, rating FROM flashcard_reviews")).toEqual([
            { reviewId: "review-backup", cardId: "card-backup", rating: 3 }
        ]);
        backedUp.close();

        // Pre-existing destination → unlinkSync removes it before the fresh backup.
        const backupB = tmpDbPath();
        fs.writeFileSync(backupB, "stale");
        await provider.backup(backupB);
        await vi.waitFor(() => expect(fs.statSync(backupB).size).toBeGreaterThan(5), { timeout: 2000 });

        provider.close();
    });

    it("throws 'DB not open' for prepare/transaction/inTransaction before a DB is loaded", () => {
        const provider = new BetterSqlite3Provider();
        expect(() => provider.prepare("SELECT 1")).toThrow("DB not open");
        expect(() => provider.transaction(() => undefined)).toThrow("DB not open");
        expect(() => provider.inTransaction).toThrow("DB not open");
        // exec/close are no-ops when no connection is open.
        expect(() => provider.exec("SELECT 1")).not.toThrow();
        expect(() => provider.close()).not.toThrow();
    });

    it("registers a process-signal handler that closes the connection", () => {
        const onSpy = vi.spyOn(process, "on");
        const provider = new BetterSqlite3Provider();
        const closeSpy = vi.spyOn(provider, "close");

        const exitCall = onSpy.mock.calls.find(([event]) => event === "exit");
        expect(exitCall).toBeDefined();
        (exitCall![1] as () => void)();
        expect(closeSpy).toHaveBeenCalled();
    });
});
