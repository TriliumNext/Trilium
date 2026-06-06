import type { SessionData } from "express-session";
import { afterEach, describe, expect, it, vi } from "vitest";

// This spec drives the defensive branches of the session store: the
// "DB not initialized" early returns and the SQL error catch paths. It mocks
// sql/sql_init wholesale, so it lives apart from the happy-path store spec.
const mockState = vi.hoisted(() => ({ initialized: true, throws: false }));

vi.mock("../services/sql_init.js", () => ({
    default: { isDbInitialized: () => mockState.initialized }
}));

vi.mock("../services/sql.js", () => ({
    default: {
        getValue: () => { if (mockState.throws) throw new Error("sql down"); return undefined; },
        upsert: () => { if (mockState.throws) throw new Error("sql down"); },
        execute: () => { if (mockState.throws) throw new Error("sql down"); return { changes: 0 }; }
    }
}));

import { SQLiteSessionStore } from "./session_parser.js";

const store = new SQLiteSessionStore();
const session = { cookie: {}, loggedIn: true } as unknown as SessionData;

describe("SQLiteSessionStore defensive branches", () => {
    afterEach(() => { mockState.initialized = true; mockState.throws = false; });

    it("short-circuits every operation when the DB is not initialized", () => {
        mockState.initialized = false;
        const cbs = { get: vi.fn(), set: vi.fn(), destroy: vi.fn(), touch: vi.fn() };
        store.get("x", cbs.get);
        store.set("x", session, cbs.set);
        store.destroy("x", cbs.destroy);
        store.touch("x", session, cbs.touch);
        expect(cbs.get).toHaveBeenCalledWith(null, null);
        expect(cbs.set).toHaveBeenCalled();
        expect(cbs.destroy).toHaveBeenCalled();
        expect(cbs.touch).toHaveBeenCalled();
    });

    it("propagates SQL errors through callbacks and returns null expiry", () => {
        mockState.throws = true;
        const getCb = vi.fn();
        store.get("x", getCb);
        expect(getCb.mock.calls[0][0]).toBeInstanceOf(Error);

        const setCb = vi.fn();
        store.set("x", session, setCb);
        expect(setCb.mock.calls[0][0]).toBeInstanceOf(Error);

        const destroyCb = vi.fn();
        store.destroy("x", destroyCb);
        expect(destroyCb.mock.calls[0][0]).toBeInstanceOf(Error);

        const touchCb = vi.fn();
        store.touch("x", session, touchCb);
        expect(touchCb.mock.calls[0][0]).toBeInstanceOf(Error);

        expect(store.getSessionExpiry("x")).toBeNull();
    });
});
