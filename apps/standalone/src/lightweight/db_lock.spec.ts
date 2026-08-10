import { describe, expect, it } from "vitest";

import { DbLock } from "./db_lock.js";

/** A promise plus the handle to settle it, so tests control interleaving exactly. */
function deferred<T = void>() {
    let resolve: (value: T) => void = () => {};
    let reject: (reason?: unknown) => void = () => {};
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe("DbLock exclusive access", () => {
    it("runs exclusive sections one at a time", async () => {
        const lock = new DbLock();
        const order: string[] = [];
        const first = deferred();

        const a = lock.runExclusive(async () => {
            order.push("a:start");
            await first.promise;
            order.push("a:end");
            return "a";
        });

        // b must not begin until a has committed, or its BEGIN IMMEDIATE would
        // land inside a's still-open transaction.
        const b = lock.runExclusive(async () => {
            order.push("b:start");
            return "b";
        });

        await Promise.resolve();
        expect(order).toEqual(["a:start"]);

        first.resolve();
        expect(await Promise.all([a, b])).toEqual(["a", "b"]);
        expect(order).toEqual(["a:start", "a:end", "b:start"]);
    });

    it("releases the lock when an exclusive section throws", async () => {
        const lock = new DbLock();

        await expect(lock.runExclusive(async () => {
            throw new Error("import failed");
        })).rejects.toThrow("import failed");

        // A failed import must not wedge the worker for every later request.
        expect(lock.isLocked).toBe(false);
        await expect(lock.runExclusive(async () => "recovered")).resolves.toBe("recovered");
    });

    it("reports isLocked only while a holder is active", async () => {
        const lock = new DbLock();
        expect(lock.isLocked).toBe(false);

        const gate = deferred();
        const running = lock.runExclusive(async () => { await gate.promise; });
        await Promise.resolve();
        expect(lock.isLocked).toBe(true);

        gate.resolve();
        await running;
        expect(lock.isLocked).toBe(false);
    });
});

describe("DbLock shared access", () => {
    it("runs synchronously and returns the value directly when unlocked", () => {
        const lock = new DbLock();

        // The common path must stay synchronous — a promise here would make
        // every ordinary route asynchronous for no reason.
        const result = lock.runShared(() => "immediate");
        expect(result).toBe("immediate");
    });

    it("defers shared work until an exclusive holder finishes", async () => {
        const lock = new DbLock();
        const order: string[] = [];
        const gate = deferred();

        const exclusive = lock.runExclusive(async () => {
            order.push("exclusive:start");
            await gate.promise;
            order.push("exclusive:end");
        });

        await Promise.resolve();
        const shared = lock.runShared(() => {
            order.push("shared");
            return "shared-result";
        });

        // While an import holds the connection, a plain request must wait rather
        // than being folded into the import's transaction as a SAVEPOINT.
        expect(shared).toBeInstanceOf(Promise);
        expect(order).toEqual(["exclusive:start"]);

        gate.resolve();
        await exclusive;
        await expect(shared).resolves.toBe("shared-result");
        expect(order).toEqual(["exclusive:start", "exclusive:end", "shared"]);
    });

    it("lets shared work proceed after a failed exclusive section", async () => {
        const lock = new DbLock();
        const gate = deferred();

        const exclusive = lock.runExclusive(async () => {
            await gate.promise;
            throw new Error("rolled back");
        });

        await Promise.resolve();
        const shared = lock.runShared(() => "after-failure");

        gate.resolve();
        await expect(exclusive).rejects.toThrow("rolled back");
        await expect(shared).resolves.toBe("after-failure");
    });
});
