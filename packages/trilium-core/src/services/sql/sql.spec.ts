import { beforeAll, describe, expect, it } from "vitest";

import { getContext } from "../context.js";
import { getSql } from "./index.js";

// happy-dom (standalone/WASM) exposes `window`; the Node server suite does not.
const isBrowserRuntime = typeof window !== "undefined";

let tableCounter = 0;

/**
 * Creates a fresh isolated temp table for write tests. Each test gets its own
 * table name so that the shared in-memory fixture DB (one copy per spec file)
 * doesn't leak rows between `it()`s.
 */
function createTempTable(columns = "id INTEGER PRIMARY KEY, name TEXT, val INTEGER"): string {
    tableCounter++;
    const name = `sql_spec_tbl_${tableCounter}`;
    getSql().executeScript(`CREATE TEMP TABLE "${name}" (${columns})`);
    return name;
}

describe("SqlService (real DB)", () => {
    beforeAll(() => {
        // Touching getSql() throws if core wasn't initialised; assert the
        // suite-level fixture really booted the service.
        expect(getSql()).toBeDefined();
    });

    describe("insert / replace / upsert", () => {
        it("inserts a row and returns the last insert rowid, joining columns and values", () => {
            const table = createTempTable();
            const rowid = getSql().insert(table, { name: "alpha", val: 10 });

            expect(typeof rowid).toBe("number");

            const row = getSql().getRow<{ name: string; val: number }>(
                `SELECT name, val FROM "${table}" WHERE rowid = ?`,
                [rowid]
            );
            expect(row).toEqual({ name: "alpha", val: 10 });
        });

        it("returns undefined and does not insert when the record is empty", () => {
            const table = createTempTable();
            const result = getSql().insert(table, {});

            expect(result).toBeUndefined();
            expect(getSql().getValue<number>(`SELECT COUNT(*) FROM "${table}"`)).toBe(0);
        });

        it("replace overwrites a conflicting primary key via INSERT OR REPLACE", () => {
            const table = createTempTable();
            getSql().insert(table, { id: 1, name: "first", val: 1 });
            const rowid = getSql().replace(table, { id: 1, name: "second", val: 2 });

            expect(typeof rowid).toBe("number");
            const rows = getSql().getRows<{ name: string }>(`SELECT name FROM "${table}"`);
            expect(rows).toEqual([{ name: "second" }]);
        });

        it("upsert inserts then updates on conflict and coerces booleans to 0/1", () => {
            const table = createTempTable("id INTEGER PRIMARY KEY, name TEXT, flag INTEGER");

            getSql().upsert(table, "id", { id: 5, name: "orig", flag: true });
            expect(getSql().getValue<number>(`SELECT flag FROM "${table}" WHERE id = 5`)).toBe(1);

            getSql().upsert(table, "id", { id: 5, name: "updated", flag: false });
            const row = getSql().getRow<{ name: string; flag: number }>(
                `SELECT name, flag FROM "${table}" WHERE id = 5`
            );
            // Conflict path updated the existing row in place; boolean false -> 0.
            expect(row).toEqual({ name: "updated", flag: 0 });
            expect(getSql().getValue<number>(`SELECT COUNT(*) FROM "${table}"`)).toBe(1);
        });

        it("upsert is a no-op for an empty record", () => {
            const table = createTempTable();
            getSql().upsert(table, "id", {});
            expect(getSql().getValue<number>(`SELECT COUNT(*) FROM "${table}"`)).toBe(0);
        });
    });

    describe("row readers", () => {
        it("getRow / getRowOrNull / getValue / getColumn / getRows read a seeded table", () => {
            const table = createTempTable();
            getSql().insert(table, { name: "a", val: 1 });
            getSql().insert(table, { name: "b", val: 2 });

            expect(getSql().getValue<number>(`SELECT COUNT(*) FROM "${table}"`)).toBe(2);
            // Distinct query strings: getColumn pluck-mode and getRows row-mode
            // share the statement cache by query text, so reusing the exact same
            // string would leave the cached statement stuck in pluck mode.
            expect(
                getSql().getColumn<string>(`SELECT name FROM "${table}" /*col*/ ORDER BY val`)
            ).toEqual(["a", "b"]);

            const all = getSql().getRows<{ name: string }>(
                `SELECT name FROM "${table}" /*rows*/ ORDER BY val`
            );
            expect(all.map((r) => r.name)).toEqual(["a", "b"]);

            const first = getSql().getRowOrNull<{ name: string }>(
                `SELECT name FROM "${table}" ORDER BY val LIMIT 1`
            );
            expect(first).toEqual({ name: "a" });

            const single = getSql().getRow<{ name: string }>(
                `SELECT name FROM "${table}" WHERE val = ?`,
                [2]
            );
            expect(single).toEqual({ name: "b" });
        });

        it("getRowOrNull returns null when no rows match", () => {
            const table = createTempTable();
            expect(getSql().getRowOrNull(`SELECT name FROM "${table}" WHERE val = ?`, [999])).toBeNull();
        });

        it("getMap maps the first column to the second column", () => {
            const table = createTempTable();
            getSql().insert(table, { name: "k1", val: 100 });
            getSql().insert(table, { name: "k2", val: 200 });

            const map = getSql().getMap<string, number>(`SELECT name, val FROM "${table}"`);
            expect(map).toEqual({ k1: 100, k2: 200 });
        });

        it("getRawRows returns positional arrays (raw mode) rather than keyed objects", () => {
            const table = createTempTable();
            getSql().insert(table, { name: "x", val: 7 });

            const raw = getSql().getRawRows<[string, number]>(`SELECT name, val FROM "${table}"`);
            expect(raw).toEqual([["x", 7]]);
        });

        it("iterateRows yields rows lazily", () => {
            const table = createTempTable();
            getSql().insert(table, { name: "i1", val: 1 });
            getSql().insert(table, { name: "i2", val: 2 });

            const names: string[] = [];
            for (const row of getSql().iterateRows<{ name: string }>(
                `SELECT name FROM "${table}" ORDER BY val`
            )) {
                names.push(row.name);
            }
            expect(names).toEqual(["i1", "i2"]);
        });
    });

    describe("statement cache (stmt)", () => {
        it("returns the same cached statement for an identical query string", () => {
            const sql = getSql();
            const a = sql.stmt("SELECT 1");
            const b = sql.stmt("SELECT 1");
            expect(a).toBe(b);
        });

        // Node's better-sqlite3 provider prepares a fresh statement object per
        // cache key, so raw vs non-raw yield distinct instances. The WASM
        // (sql.js) provider may hand back the same object for identical SQL, so
        // this distinctness is a Node-provider impl detail, not a portable contract.
        it.skipIf(isBrowserRuntime)("keeps raw and non-raw statements as distinct cache entries", () => {
            const sql = getSql();
            const plain = sql.stmt("SELECT 2");
            const raw = sql.stmt("SELECT 2", true);
            expect(plain).not.toBe(raw);
        });
    });

    describe("getManyRows / executeMany (??? placeholder expansion)", () => {
        it("getManyRows expands ??? into named params and chunks beyond the 100-param limit", () => {
            const table = createTempTable();
            const total = 250;
            for (let i = 0; i < total; i++) {
                getSql().insert(table, { name: `n${i}`, val: i });
            }

            const ids = Array.from({ length: total }, (_, i) => i);
            const rows = getSql().getManyRows<{ val: number }>(
                `SELECT val FROM "${table}" WHERE val IN (???)`,
                ids
            );

            // All chunks (100 + 100 + 50) are concatenated into one result set.
            expect(rows.length).toBe(total);
            expect(new Set(rows.map((r) => r.val)).size).toBe(total);
        });

        it("getManyRows returns an empty array for an empty param list", () => {
            const table = createTempTable();
            expect(getSql().getManyRows(`SELECT val FROM "${table}" WHERE val IN (???)`, [])).toEqual([]);
        });

        it("executeMany runs the query for each chunk of params", () => {
            const table = createTempTable("id INTEGER PRIMARY KEY, val INTEGER");
            for (let i = 0; i < 150; i++) {
                getSql().insert(table, { id: i, val: i });
            }

            const ids = Array.from({ length: 150 }, (_, i) => i);
            getSql().executeMany(`DELETE FROM "${table}" WHERE val IN (???)`, ids);

            expect(getSql().getValue<number>(`SELECT COUNT(*) FROM "${table}"`)).toBe(0);
        });
    });

    describe("fillParamList", () => {
        it("truncates and fills the param_list temp table with a de-duplicated set", () => {
            getSql().fillParamList(["p1", "p2", "p2", "p3"]);

            const ids = getSql()
                .getColumn<string>("SELECT paramId FROM param_list ORDER BY paramId");
            expect(ids).toEqual(["p1", "p2", "p3"]);
        });

        it("does nothing for an empty array (leaving any prior contents intact)", () => {
            getSql().fillParamList(["only"]);
            getSql().fillParamList([]);
            // The early-return for an empty list skips the DELETE, so the
            // previous single entry is still present.
            expect(getSql().getColumn<string>("SELECT paramId FROM param_list")).toEqual(["only"]);
        });

        it("accepts a Set as input", () => {
            getSql().fillParamList(new Set(["s1", "s2"]));
            expect(
                getSql().getColumn<string>("SELECT paramId FROM param_list ORDER BY paramId")
            ).toEqual(["s1", "s2"]);
        });
    });

    describe("execute", () => {
        it("runs a write and reports the number of changed rows", () => {
            const table = createTempTable();
            getSql().insert(table, { name: "a", val: 1 });
            getSql().insert(table, { name: "b", val: 1 });

            const res = getSql().execute(`UPDATE "${table}" SET val = 99 WHERE val = ?`, [1]);
            expect(res.changes).toBe(2);
            expect(getSql().getValue<number>(`SELECT COUNT(*) FROM "${table}" WHERE val = 99`)).toBe(2);
        });
    });

    describe("wrap (error handling)", () => {
        it("rethrows real SQL errors", () => {
            expect(() => getSql().getRow("SELECT * FROM table_that_does_not_exist_xyz")).toThrow();
        });

        it("returns null instead of throwing when the connection is reported closed", () => {
            const sql = getSql();
            const result = sql.wrap("SELECT 1", () => {
                throw new Error("The database connection is not open");
            });
            expect(result).toBeNull();
        });
    });

    describe("transactional", () => {
        it("commits the changes made inside the callback and returns its value", () => {
            const table = createTempTable();
            const ret = getContext().init(() =>
                getSql().transactional(() => {
                    getSql().insert(table, { name: "committed", val: 1 });
                    return "done";
                })
            );

            expect(ret).toBe("done");
            expect(getSql().getValue<number>(`SELECT COUNT(*) FROM "${table}"`)).toBe(1);
        });

        it("rolls back all changes and rethrows when the callback throws", () => {
            const table = createTempTable();
            getSql().insert(table, { name: "before", val: 1 });

            expect(() =>
                getContext().init(() =>
                    getSql().transactional(() => {
                        getSql().insert(table, { name: "doomed", val: 2 });
                        throw new Error("boom");
                    })
                )
            ).toThrow("boom");

            // The pre-existing row survives, the in-transaction insert is rolled back.
            const rows = getSql().getColumn<string>(`SELECT name FROM "${table}" ORDER BY name`);
            expect(rows).toEqual(["before"]);
        });
    });

    describe("transactionalAsync", () => {
        it("commits an async callback and returns its resolved value", async () => {
            const table = createTempTable();
            const ret = await getContext().init(() =>
                getSql().transactionalAsync(async () => {
                    getSql().insert(table, { name: "async", val: 1 });
                    return 42;
                })
            );

            expect(ret).toBe(42);
            expect(getSql().getValue<number>(`SELECT COUNT(*) FROM "${table}"`)).toBe(1);
        });

        it("rolls back and rethrows when the async callback rejects", async () => {
            const table = createTempTable();
            getSql().insert(table, { name: "keep", val: 1 });

            await expect(
                getContext().init(() =>
                    getSql().transactionalAsync(async () => {
                        getSql().insert(table, { name: "discard", val: 2 });
                        throw new Error("async-boom");
                    })
                )
            ).rejects.toThrow("async-boom");

            const rows = getSql().getColumn<string>(`SELECT name FROM "${table}" ORDER BY name`);
            expect(rows).toEqual(["keep"]);
        });
    });

    describe("disableSlowQueryLogging", () => {
        it("sets the flag for the duration of the callback and restores the prior value", () => {
            getContext().init(() => {
                const ctx = getContext();
                expect(ctx.get("disableSlowQueryLogging")).toBeFalsy();

                const inner = getSql().disableSlowQueryLogging(() => {
                    return getContext().get("disableSlowQueryLogging");
                });
                expect(inner).toBe(true);

                // Restored back to the original (undefined/false) value afterwards.
                expect(ctx.get("disableSlowQueryLogging")).toBeFalsy();
            });
        });

        it("restores the flag even if the callback throws", () => {
            getContext().init(() => {
                expect(() =>
                    getSql().disableSlowQueryLogging(() => {
                        throw new Error("inner-fail");
                    })
                ).toThrow("inner-fail");
                expect(getContext().get("disableSlowQueryLogging")).toBeFalsy();
            });
        });
    });

    describe("serialize", () => {
        it("either throws (provider unsupported) or returns the serialized bytes", () => {
            // Capability-aware: the server's better-sqlite3 provider has no
            // serialize() and throws, while the WASM (sql.js) provider supports
            // it and returns the database as a Uint8Array.
            if (isBrowserRuntime) {
                const bytes = getSql().serialize();
                expect(bytes).toBeInstanceOf(Uint8Array);
            } else {
                expect(() => getSql().serialize()).toThrow("does not support serialization");
            }
        });
    });
});
