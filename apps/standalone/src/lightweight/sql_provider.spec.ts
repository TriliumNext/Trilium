import { getSql } from "@triliumnext/core";
import type { Statement } from "@triliumnext/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import BrowserSqlProvider from "./sql_provider.js";

// The sqlite-wasm module can only be initialized once per worker (test_setup.ts
// already does it for core). Reuse that initialized module rather than calling
// initWasm() again, which would fail to re-locate the .wasm file.
type WithSqlite3 = { sqlite3: unknown };

/** The runtime statement exposes finalize(), which the core interface omits. */
type FinalizableStatement = Statement & { finalize(): void };

/** The runtime transaction is callable and exposes better-sqlite3-style variants. */
type FullTransaction = (() => unknown) & {
    deferred: () => unknown;
    immediate: () => unknown;
    exclusive: () => unknown;
    default: () => unknown;
};

function coreProvider(): BrowserSqlProvider {
    return (getSql() as unknown as { dbConnection: BrowserSqlProvider }).dbConnection;
}

function newProviderWithModule(): BrowserSqlProvider {
    const p = new BrowserSqlProvider();
    (p as unknown as WithSqlite3).sqlite3 = (coreProvider() as unknown as WithSqlite3).sqlite3;
    return p;
}

let provider: BrowserSqlProvider;

/** Pluck a single scalar from a parameterless query. */
function scalar(query: string): unknown {
    return provider.prepare(query).pluck().get([]);
}

function makeTx(fn: () => unknown): FullTransaction {
    return provider.transaction(fn) as unknown as FullTransaction;
}

beforeAll(() => {
    provider = newProviderWithModule();
    provider.loadFromMemory();
    provider.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, val INTEGER)");
});

afterAll(() => {
    provider.close();
});

describe("BrowserSqlProvider initialization", () => {
    it("reports initialization state and version", () => {
        expect(provider.isInitialized).toBe(true);
        expect(provider.version?.libVersion).toMatch(/^\d/);
    });

    it("initWasm() resolves immediately when already initialized", async () => {
        // Hits the early `if (this.initPromise) return this.initPromise` path
        // without re-running the (one-shot) WASM module loader.
        await expect(coreProvider().initWasm()).resolves.toBeUndefined();
    });

    it("re-throws a previous initialization error", async () => {
        const failed = new BrowserSqlProvider();
        (failed as unknown as { initError: Error }).initError = new Error("prior init failure");
        await expect(failed.initWasm()).rejects.toThrow("prior init failure");
    });

    it("throws from ensureSqlite3 before initialization", () => {
        const fresh = new BrowserSqlProvider();
        expect(fresh.isInitialized).toBe(false);
        expect(fresh.version).toBeUndefined();
        expect(() => fresh.loadFromMemory()).toThrow("SQLite WASM module not initialized");
    });

    it("throws from ensureDb when initialized but no database is open", () => {
        const noDb = newProviderWithModule();
        expect(noDb.isOpen()).toBe(false);
        expect(() => noDb.exec("SELECT 1")).toThrow("Database not opened");
    });
});

describe("BrowserSqlProvider unsupported operations", () => {
    it("loadFromFile and backup are not supported in the browser", () => {
        expect(() => provider.loadFromFile("/x", false)).toThrow("loadFromFile is not supported");
        expect(() => provider.backup("/x")).toThrow("backup to file is not supported");
    });
});

// Statements are cached by SQL string and raw()/pluck() flags are sticky on the
// cached instance, so each mode-sensitive assertion uses a distinct query string.
describe("WasmStatement reads and writes", () => {
    beforeAll(() => {
        provider.exec("DELETE FROM t");
        provider.prepare("INSERT INTO t (name, val) VALUES (?, ?)").run("alice", 1);
        provider.prepare("INSERT INTO t (name, val) VALUES (?, ?)").run("bob", 2);
    });

    it("run() reports changes and lastInsertRowid", () => {
        const result = provider.prepare("INSERT INTO t (name, val) VALUES (?, ?)").run("carol", 3);
        expect(result.changes).toBe(1);
        expect(typeof result.lastInsertRowid).toBe("number");
        expect(result.lastInsertRowid).toBeGreaterThan(0);
        provider.prepare("DELETE FROM t WHERE name = ?").run("carol");
    });

    it("get() returns a single row as an object, or undefined when missing", () => {
        const row = provider.prepare("SELECT name, val FROM t WHERE name = ? /* obj */").get("alice");
        expect(row).toEqual({ name: "alice", val: 1 });
        expect(provider.prepare("SELECT id FROM t WHERE name = ? /* miss */").get("nobody")).toBeUndefined();
    });

    it("get() with raw mode returns an array row", () => {
        const row = provider.prepare("SELECT name, val FROM t WHERE name = ? /* raw */").raw().get("alice");
        expect(row).toEqual(["alice", 1]);
    });

    it("get() with pluck mode returns the first column", () => {
        const value = provider.prepare("SELECT name FROM t WHERE name = ? /* pluck */").pluck().get("bob");
        expect(value).toBe("bob");
    });

    it("all() returns every row, honoring raw and pluck modes", () => {
        expect(provider.prepare("SELECT name FROM t ORDER BY name /* all-obj */").all()).toEqual([{ name: "alice" }, { name: "bob" }]);
        expect(provider.prepare("SELECT name FROM t ORDER BY name /* all-pluck */").pluck().all()).toEqual(["alice", "bob"]);
        expect(provider.prepare("SELECT name FROM t ORDER BY name /* all-raw */").raw().all()).toEqual([["alice"], ["bob"]]);
    });

    it("iterate() yields rows in object, raw and pluck modes", () => {
        expect([...provider.prepare("SELECT name FROM t ORDER BY name /* it-obj */").iterate()])
            .toEqual([{ name: "alice" }, { name: "bob" }]);
        expect([...provider.prepare("SELECT name FROM t ORDER BY name /* it-raw */").raw().iterate()])
            .toEqual([["alice"], ["bob"]]);
        expect([...provider.prepare("SELECT name FROM t ORDER BY name /* it-pluck */").pluck().iterate()])
            .toEqual(["alice", "bob"]);
    });

    it("toggling raw/pluck off restores object rows", () => {
        const stmt = provider.prepare("SELECT name FROM t WHERE name = ? /* toggle */").raw().pluck();
        stmt.raw(false).pluck(false);
        expect(stmt.get("alice")).toEqual({ name: "alice" });
    });

    it("caches prepared statements per query string", () => {
        const a = provider.prepare("SELECT 1 AS one");
        const b = provider.prepare("SELECT 1 AS one");
        expect(a).toBe(b);
    });
});

describe("WasmStatement parameter binding", () => {
    beforeAll(() => {
        provider.exec("DELETE FROM t");
        provider.prepare("INSERT INTO t (name, val) VALUES (?, ?)").run("alice", 1);
    });

    it("binds named parameters with :, @ and $ prefixes", () => {
        expect(provider.prepare("SELECT val FROM t WHERE name = :name").pluck().get({ name: "alice" })).toBe(1);
        expect(provider.prepare("SELECT val FROM t WHERE name = @name").pluck().get({ name: "alice" })).toBe(1);
        expect(provider.prepare("SELECT val FROM t WHERE name = $name").pluck().get({ name: "alice" })).toBe(1);
    });

    it("accepts already-prefixed parameter keys", () => {
        expect(provider.prepare("SELECT val FROM t WHERE name = :name /* prefixed */").pluck().get({ ":name": "alice" })).toBe(1);
    });

    it("binds positional parameters, including nested arrays", () => {
        const rows = provider.prepare("SELECT name FROM t WHERE name IN (?, ?)").pluck().all(["alice", "missing"]);
        expect(rows).toEqual(["alice"]);
    });

    it("runs a statement with no parameters", () => {
        expect(scalar("SELECT COUNT(*) AS c FROM t")).toBe(1);
    });
});

describe("WasmStatement finalization", () => {
    it("rejects all operations after finalize()", () => {
        const stmt = provider.prepare("SELECT 1 AS one WHERE 1 = ?") as FinalizableStatement;
        stmt.finalize();
        stmt.finalize(); // idempotent
        expect(() => stmt.run(1)).toThrow("finalized");
        expect(() => stmt.get(1)).toThrow("finalized");
        expect(() => stmt.all(1)).toThrow("finalized");
        expect(() => stmt.iterate(1)).toThrow("finalized");
    });
});

describe("BrowserSqlProvider transactions", () => {
    beforeAll(() => {
        provider.exec("DELETE FROM t");
    });

    it("commits a successful transaction and tracks inTransaction", () => {
        expect(provider.inTransaction).toBe(false);
        const result = makeTx(() => {
            expect(provider.inTransaction).toBe(true);
            provider.prepare("INSERT INTO t (name, val) VALUES (?, ?)").run("tx1", 1);
            return "ok";
        })();
        expect(result).toBe("ok");
        expect(provider.inTransaction).toBe(false);
        expect(scalar("SELECT COUNT(*) AS c FROM t")).toBe(1);
    });

    it("rolls back when the transaction throws", () => {
        expect(() => makeTx(() => {
            provider.prepare("INSERT INTO t (name, val) VALUES (?, ?)").run("doomed", 9);
            throw new Error("rollback me");
        })()).toThrow("rollback me");
        expect(provider.prepare("SELECT COUNT(*) AS c FROM t WHERE name = ?").pluck().get("doomed")).toBe(0);
    });

    it("supports deferred, immediate, exclusive and default variants", () => {
        provider.exec("DELETE FROM t");
        makeTx(() => provider.prepare("INSERT INTO t (name) VALUES (?)").run("d")).deferred();
        makeTx(() => provider.prepare("INSERT INTO t (name) VALUES (?)").run("i")).immediate();
        makeTx(() => provider.prepare("INSERT INTO t (name) VALUES (?)").run("e")).exclusive();
        makeTx(() => provider.prepare("INSERT INTO t (name) VALUES (?)").run("x")).default();
        expect(scalar("SELECT COUNT(*) AS c FROM t")).toBe(4);
    });

    it("nests via SAVEPOINT and releases / rolls back independently", () => {
        provider.exec("DELETE FROM t");
        makeTx(() => {
            provider.prepare("INSERT INTO t (name) VALUES (?)").run("outer");
            makeTx(() => provider.prepare("INSERT INTO t (name) VALUES (?)").run("inner-ok"))();
            expect(() => makeTx(() => {
                provider.prepare("INSERT INTO t (name) VALUES (?)").run("inner-bad");
                throw new Error("inner boom");
            })()).toThrow("inner boom");
            return undefined;
        })();

        expect(provider.prepare("SELECT name FROM t ORDER BY name /* names */").pluck().all()).toEqual(["inner-ok", "outer"]);
    });

    it("uses SAVEPOINT when a manual BEGIN is already active", () => {
        provider.exec("DELETE FROM t");
        provider.exec("BEGIN");
        try {
            expect(provider.inTransaction).toBe(false); // not started via transaction()
            makeTx(() => provider.prepare("INSERT INTO t (name) VALUES (?)").run("manual"))();
            provider.exec("COMMIT");
        } catch (e) {
            provider.exec("ROLLBACK");
            throw e;
        }
        expect(scalar("SELECT COUNT(*) AS c FROM t")).toBe(1);
    });
});

describe("BrowserSqlProvider serialize / load / lifecycle", () => {
    it("serializes and reloads the database from a buffer", () => {
        const local = newProviderWithModule();
        local.loadFromMemory();
        local.exec("CREATE TABLE notes (noteId TEXT)");
        local.exec("INSERT INTO notes VALUES ('hello')");
        expect(local.isDbInitialized()).toBe(true);

        const bytes = local.serialize();
        expect(bytes).toBeInstanceOf(Uint8Array);

        const reloaded = newProviderWithModule();
        reloaded.loadFromBuffer(bytes);
        expect(reloaded.prepare("SELECT noteId FROM notes").pluck().get([])).toBe("hello");
        reloaded.close();
        local.close();
    });

    it("isDbInitialized() is false for a database without the notes table", () => {
        const empty = newProviderWithModule();
        empty.loadFromMemory();
        expect(empty.isDbInitialized()).toBe(false);
        empty.close();
    });

    it("normalizes a Node Buffer passed to loadFromBuffer", () => {
        const seed = newProviderWithModule();
        seed.loadFromMemory();
        seed.exec("CREATE TABLE notes (noteId TEXT)");
        const bytes = seed.serialize();
        seed.close();

        const reloaded = newProviderWithModule();
        reloaded.loadFromBuffer(Buffer.from(bytes));
        expect(reloaded.isDbInitialized()).toBe(true);
        reloaded.close();
    });

    it("close() drops the connection and is idempotent", () => {
        const local = newProviderWithModule();
        local.loadFromMemory();
        expect(local.isOpen()).toBe(true);
        local.close();
        expect(local.isOpen()).toBe(false);
        local.close();
    });

    it("changes() reflects the last write", () => {
        const local = newProviderWithModule();
        local.loadFromMemory();
        local.exec("CREATE TABLE c (id INTEGER)");
        local.prepare("INSERT INTO c VALUES (1)").run([]);
        expect(local.changes()).toBe(1);
        local.close();
    });
});

describe("BrowserSqlProvider SAHPool VFS", () => {
    interface FakeUtil {
        reserveMinimumCapacity: (n: number) => Promise<void>;
        getCapacity: () => number;
        getFileCount: () => number;
        OpfsSAHPoolDb: new (name: string) => { exec: (sql: string) => void; close: () => void };
    }

    function fakeUtil(dbThrows = false): FakeUtil {
        return {
            reserveMinimumCapacity: vi.fn(async () => {}),
            getCapacity: () => 6,
            getFileCount: () => 0,
            OpfsSAHPoolDb: class {
                constructor(_name: string) {
                    if (dbThrows) {
                        throw new Error("cannot open SAHPool db");
                    }
                }
                exec() {}
                close() {}
            }
        };
    }

    function providerWith(installImpl: () => Promise<FakeUtil>): BrowserSqlProvider {
        const p = new BrowserSqlProvider();
        (p as unknown as WithSqlite3).sqlite3 = { installOpfsSAHPoolVfs: installImpl };
        return p;
    }

    it("reports SAHPool getters as inactive before installation", () => {
        const p = newProviderWithModule();
        expect(p.isSahPoolInstalled).toBe(false);
        expect(p.sahPool).toBeUndefined();
        expect(p.isUsingSahPool).toBe(false);
        expect(p.isUsingOpfs).toBe(false);
        expect(p.currentOpfsPath).toBeUndefined();
    });

    it("installs the SAHPool VFS and loads a database from it", async () => {
        const util = fakeUtil();
        vi.spyOn(console, "log").mockImplementation(() => {});
        const p = providerWith(async () => util);

        await p.installSahPool({ directory: "/pool", initialCapacity: 8 });
        expect(p.isSahPoolInstalled).toBe(true);
        expect(p.sahPool).toBe(util);

        p.loadFromSahPool("/trilium.db");
        expect(p.isUsingSahPool).toBe(true);
        expect(p.isUsingOpfs).toBe(true);
        expect(p.currentOpfsPath).toBe("/trilium.db");
        vi.restoreAllMocks();
    });

    it("installs with default options", async () => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        const p = providerWith(async () => fakeUtil());
        await p.installSahPool();
        expect(p.isSahPoolInstalled).toBe(true);
        vi.restoreAllMocks();
    });

    it("throws from loadFromSahPool when the VFS is not installed", () => {
        const p = newProviderWithModule();
        expect(() => p.loadFromSahPool("/trilium.db")).toThrow("SAHPool VFS not installed");
    });

    it("re-throws (and logs) when opening the SAHPool database fails", async () => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
        const p = providerWith(async () => fakeUtil(true));
        await p.installSahPool();
        expect(() => p.loadFromSahPool("/trilium.db")).toThrow("cannot open SAHPool db");
        vi.restoreAllMocks();
    });

    it("propagates errors thrown while installing the VFS", async () => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        const p = providerWith(async () => { throw new Error("no OPFS here"); });
        await expect(p.installSahPool()).rejects.toThrow("no OPFS here");
        vi.restoreAllMocks();
    });

    it("wraps a non-Error thrown while opening the SAHPool database", async () => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
        const p = providerWith(async () => ({
            reserveMinimumCapacity: vi.fn(async () => {}),
            getCapacity: () => 6,
            getFileCount: () => 0,
            OpfsSAHPoolDb: class {
                constructor() { throw "string failure"; }
                exec() {}
                close() {}
            }
        }));
        await p.installSahPool();
        expect(() => p.loadFromSahPool("/x.db")).toThrow("string failure");
        vi.restoreAllMocks();
    });
});

describe("BrowserSqlProvider error and defensive paths", () => {
    it("resets the statement and rethrows when run() fails", () => {
        provider.exec("DELETE FROM t");
        const insert = provider.prepare("INSERT INTO t (id, name) VALUES (?, ?)");
        insert.run(1, "first");
        // Re-inserting the same primary key violates the UNIQUE constraint inside step().
        expect(() => insert.run(1, "dup")).toThrow();
        // The statement is reusable afterwards (it was reset in the catch block).
        expect(insert.run(2, "second").changes).toBe(1);
    });

    it("falls back to the ':' parameter prefix for names absent from the SQL", () => {
        // detectParamPrefix() returns ':' for a name with no prefixed match in the
        // SQL; binding an unknown parameter then fails inside sqlite-wasm.
        expect(() => provider.prepare("SELECT 1 AS x /* ghost */").get({ ghost: 1 })).toThrow();
    });

    it("treats an explicit undefined parameter as no bindings", () => {
        expect(provider.prepare("SELECT 1 AS one /* undef */").pluck().get(undefined as unknown as [])).toBe(1);
    });

    it("warns but does not throw when the underlying statement fails to finalize", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const stmt = provider.prepare("SELECT 42 AS answer /* bad-finalize */") as unknown as { stmt: { finalize(): void }; finalize(): void };
        stmt.stmt = { finalize() { throw new Error("cannot finalize"); } };
        expect(() => stmt.finalize()).not.toThrow();
        expect(warn).toHaveBeenCalled();
    });

    it("swallows errors from cached statements during clearStatementCache()", () => {
        const local = newProviderWithModule();
        local.loadFromMemory();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const cache = (local as unknown as { statementCache: Map<string, { finalize(): void }> }).statementCache;
        cache.set("boom", { finalize() { throw new Error("cleanup failure"); } });
        expect(() => local.close()).not.toThrow();
        expect(warn).toHaveBeenCalled();
        vi.restoreAllMocks();
    });

    it("deallocates and rethrows when deserialization fails", () => {
        const dealloc = vi.fn();
        const fakeSqlite3 = {
            wasm: { allocFromTypedArray: () => 999, dealloc },
            oo1: { DB: class { pointer = 1; close() {} } },
            capi: {
                sqlite3_deserialize: () => 1,
                SQLITE_DESERIALIZE_FREEONCLOSE: 1,
                SQLITE_DESERIALIZE_RESIZEABLE: 2
            }
        };
        const p = new BrowserSqlProvider();
        (p as unknown as WithSqlite3).sqlite3 = fakeSqlite3;
        expect(() => p.loadFromBuffer(new Uint8Array([1, 2, 3]))).toThrow("Failed to deserialize database: 1");
        expect(dealloc).toHaveBeenCalledWith(999);
    });

    it("run() tolerates a missing db pointer and converts bigint rowids", () => {
        const ws = provider.prepare("INSERT INTO t (name) VALUES (?) /* rowid-defensive */") as unknown as {
            stmt: unknown; db: unknown; sqlite3: unknown;
            run(...p: unknown[]): { lastInsertRowid: number };
        };
        const original = { stmt: ws.stmt, db: ws.db, sqlite3: ws.sqlite3 };
        const fakeStmt = { clearBindings() {}, bind() {}, step() { return false; }, reset() {} };
        ws.stmt = fakeStmt;

        // db.pointer falsy → rowid defaults to 0
        ws.db = { pointer: 0, changes: () => 1 };
        ws.sqlite3 = { capi: { sqlite3_last_insert_rowid: () => 0 } };
        expect(ws.run("a").lastInsertRowid).toBe(0);

        // bigint rowid → coerced to a number
        ws.db = { pointer: 1, changes: () => 1 };
        ws.sqlite3 = { capi: { sqlite3_last_insert_rowid: () => 7n } };
        expect(ws.run("b").lastInsertRowid).toBe(7);

        Object.assign(ws, original);
    });

    it("pluck mode yields undefined / skips rows that have no columns", () => {
        const fakeStmt = (rowsLeft: number) => {
            let remaining = rowsLeft;
            return {
                clearBindings() {}, bind() {},
                step() { return remaining-- > 0; },
                get() { return []; },
                reset() {}
            };
        };

        const getStmt = provider.prepare("SELECT 1 /* pluck-empty-get */").pluck() as unknown as { stmt: unknown; get(p: unknown): unknown };
        getStmt.stmt = fakeStmt(1);
        expect(getStmt.get([])).toBeUndefined();

        const allStmt = provider.prepare("SELECT 1 /* pluck-empty-all */").pluck() as unknown as { stmt: unknown; all(...p: unknown[]): unknown[] };
        allStmt.stmt = fakeStmt(1);
        expect(allStmt.all()).toEqual([]);

        const iterStmt = provider.prepare("SELECT 1 /* pluck-empty-iter */").pluck() as unknown as { stmt: unknown; iterate(...p: unknown[]): IterableIterator<unknown> };
        iterStmt.stmt = fakeStmt(1);
        expect([...iterStmt.iterate()]).toEqual([undefined]);
    });
});
