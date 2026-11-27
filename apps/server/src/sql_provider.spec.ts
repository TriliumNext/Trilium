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

        expect(provider.isAttached()).toBe(true);
        provider.detach();
        expect(provider.isAttached()).toBe(false);
        expect(() => provider.prepare("SELECT 1")).toThrow("DB not open");
        provider.detach();
        expect(provider.isAttached()).toBe(false);
    });

    it("loads from a file (WAL mode) and backs up to a destination", async () => {
        const dbPath = tmpDbPath();
        const provider = new BetterSqlite3Provider();
        provider.loadFromFile(dbPath, false);
        provider.exec("CREATE TABLE x (id INTEGER)");
        expect(fs.existsSync(dbPath)).toBe(true);

        // Fresh destination → the pre-delete unlinkSync throws (missing) and is swallowed.
        const backupA = tmpDbPath();
        provider.backup(backupA);
        await vi.waitFor(() => expect(fs.existsSync(backupA)).toBe(true), { timeout: 2000 });

        // Pre-existing destination → unlinkSync removes it before the fresh backup.
        const backupB = tmpDbPath();
        fs.writeFileSync(backupB, "stale");
        provider.backup(backupB);
        await vi.waitFor(() => expect(fs.statSync(backupB).size).toBeGreaterThan(5), { timeout: 2000 });

        provider.close();
    });

    it("opens file databases in WAL mode, or DELETE mode for the integration fixture", () => {
        const journalModeOf = (dbPath: string) => {
            const provider = new BetterSqlite3Provider();
            provider.loadFromFile(dbPath, false);
            const mode = (provider.prepare("PRAGMA journal_mode") as any).get();
            provider.close();
            return mode;
        };

        try {
            vi.stubEnv("TRILIUM_INTEGRATION_TEST", "");
            expect(journalModeOf(tmpDbPath())).toEqual({ journal_mode: "wal" });

            vi.stubEnv("TRILIUM_INTEGRATION_TEST", "edit");
            expect(journalModeOf(tmpDbPath())).toEqual({ journal_mode: "delete" });
        } finally {
            vi.unstubAllEnvs();
        }
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
