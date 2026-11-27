import type { SessionData } from "express-session";
import { events, initMessaging } from "@triliumnext/core";
import { afterEach, describe, expect, it, vi } from "vitest";

// This spec drives the defensive branches of the session store: the
// "DB not initialized" early returns and the SQL error catch paths. It mocks
// sql/sql_init wholesale, so it lives apart from the happy-path store spec.
const mockState = vi.hoisted(() => ({ initialized: true, throws: false, executed: [] as string[] }));

vi.mock("../services/sql_init.js", () => ({
    default: { isDbInitialized: () => mockState.initialized }
}));

vi.mock("../services/sql.js", () => ({
    default: {
        getValue: () => { if (mockState.throws) throw new Error("sql down"); return undefined; },
        upsert: () => { if (mockState.throws) throw new Error("sql down"); },
        execute: (query: string) => {
            if (mockState.throws) throw new Error("sql down");
            mockState.executed.push(query);
            return { changes: 0 };
        }
    }
}));

import { CLEAN_UP_INTERVAL, SQLiteSessionStore, startSessionCleanup, startSessionRevocationOnPasswordChange } from "./session_parser.js";

const store = new SQLiteSessionStore();
const session = { cookie: {}, loggedIn: true } as unknown as SessionData;

describe("SQLiteSessionStore defensive branches", () => {
    afterEach(() => {
        mockState.initialized = true;
        mockState.throws = false;
        mockState.executed = [];
    });

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

describe("session cleanup and revocation", () => {
    afterEach(() => {
        mockState.initialized = true;
        mockState.executed = [];
        vi.useRealTimers();
    });

    it("purges expired sessions on every interval, but only once the DB is initialized", () => {
        vi.useFakeTimers();
        vi.spyOn(console, "log").mockImplementation(() => {});
        startSessionCleanup();

        mockState.initialized = false;
        vi.advanceTimersByTime(CLEAN_UP_INTERVAL);
        expect(mockState.executed).toEqual([]);

        mockState.initialized = true;
        vi.advanceTimersByTime(CLEAN_UP_INTERVAL);
        expect(mockState.executed).toEqual([ "DELETE FROM sessions WHERE expires < ?" ]);
    });

    it("revokes every session only when the password verification hash changes", () => {
        startSessionRevocationOnPasswordChange();
        const changeLocally = (entityName: string, name: string) =>
            events.emit(events.ENTITY_CHANGED, { entityName, entity: { name } });
        const changeBySync = (entityName: string, name: string) =>
            events.emit(events.ENTITY_CHANGE_SYNCED, { entityName, entityRow: { name } });

        // Unrelated changes leave the sessions alone.
        changeLocally("options", "theme");
        changeLocally("notes", "passwordVerificationHash");
        changeBySync("options", "theme");
        changeBySync("notes", "passwordVerificationHash");
        expect(mockState.executed).toEqual([]);

        // Without a messaging provider there are no clients to disconnect, but the sessions still go.
        changeLocally("options", "passwordVerificationHash");
        expect(mockState.executed).toEqual([ "DELETE FROM sessions" ]);

        // A provider that cannot hold HTTP clients has nothing to disconnect either.
        const disconnectAllClients = vi.fn();
        initMessaging({ disconnectAllClients } as unknown as Parameters<typeof initMessaging>[0]);
        changeBySync("options", "passwordVerificationHash");
        expect(mockState.executed).toHaveLength(2);
        expect(disconnectAllClients).not.toHaveBeenCalled();

        // The WebSocket provider drops every open connection.
        initMessaging({ attachToHttpServer() {}, disconnectAllClients } as unknown as Parameters<typeof initMessaging>[0]);
        changeLocally("options", "passwordVerificationHash");
        expect(mockState.executed).toHaveLength(3);
        expect(disconnectAllClients).toHaveBeenCalledWith("password changed");
    });
});
