import { cls } from "@triliumnext/core";
import type { SessionData } from "express-session";
import { describe, expect, it } from "vitest";

import { SQLiteSessionStore } from "./session_parser.js";

const store = new SQLiteSessionStore();

function get(sid: string) {
    return new Promise<SessionData | null | undefined>((resolve, reject) =>
        store.get(sid, (err, session) => (err ? reject(err) : resolve(session))));
}

function set(sid: string, session: SessionData) {
    return new Promise<void>((resolve, reject) =>
        cls.init(() => store.set(sid, session, err => (err ? reject(err) : resolve()))));
}

function destroy(sid: string) {
    return new Promise<void>((resolve, reject) =>
        cls.init(() => store.destroy(sid, err => (err ? reject(err) : resolve()))));
}

function touch(sid: string, session: SessionData) {
    return new Promise<void>((resolve, reject) =>
        cls.init(() => store.touch(sid, session, err => (err ? reject(err) : resolve()))));
}

const baseSession = (expires?: Date) => ({ cookie: expires ? { expires } : {}, loggedIn: true }) as unknown as SessionData;

describe("SQLiteSessionStore", () => {
    it("stores, reads and removes a session", async () => {
        await set("sess-1", baseSession());
        expect((await get("sess-1"))?.loggedIn).toBe(true);
        expect(store.getSessionExpiry("sess-1")).toBeInstanceOf(Date);

        await destroy("sess-1");
        expect(await get("sess-1")).toBeNull();
    });

    it("returns null for an unknown session and its expiry", async () => {
        expect(await get("does-not-exist")).toBeNull();
        expect(store.getSessionExpiry("does-not-exist")).toBeNull();
    });

    it("uses the cookie expiry when one is provided", async () => {
        const expires = new Date(Date.now() + 5 * 60 * 1000);
        await set("sess-2", baseSession(expires));
        expect(store.getSessionExpiry("sess-2")?.getTime()).toBe(expires.getTime());
    });

    it("touch renews a non-persistent session but leaves a persistent one untouched", async () => {
        await set("sess-3", baseSession());
        const before = store.getSessionExpiry("sess-3")?.getTime() ?? 0;
        expect(before).toBeGreaterThan(0);
        // No cookie.expires → touch pushes the expiry forward.
        await touch("sess-3", baseSession());
        expect(store.getSessionExpiry("sess-3")?.getTime() ?? 0).toBeGreaterThanOrEqual(before);

        // cookie.expires present → touch is a no-op (early return).
        await touch("sess-3", baseSession(new Date(Date.now() + 60_000)));
        expect(store.getSessionExpiry("sess-3")).toBeInstanceOf(Date);
    });
});
