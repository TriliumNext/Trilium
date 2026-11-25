import { cls, getLog } from "@triliumnext/core";
import { createHmac } from "crypto";
import express from "express";
import type { SessionData } from "express-session";
import supertest from "supertest";
import { describe, expect, it, vi } from "vitest";

import sessionSecret from "../services/session_secret.js";
import sql from "../services/sql.js";
import sessionParser, { SQLiteSessionStore } from "./session_parser.js";

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

describe("sessionParser with several session cookies", () => {
    const app = express();
    app.use(sessionParser);
    app.get("/", (req, res) => {
        res.json({ sessionID: req.sessionID, loggedIn: req.session.loggedIn ?? false });
    });

    function signed(sid: string) {
        const signature = createHmac("sha256", sessionSecret).update(sid).digest("base64").replace(/=+$/, "");
        return encodeURIComponent(`s:${sid}.${signature}`);
    }

    function request(cookie: string) {
        return supertest(app).get("/").set("Cookie", cookie);
    }

    it("uses the logged-in session when a stale cookie comes first", async () => {
        await set("live-session", baseSession());
        const warn = vi.spyOn(getLog(), "warn");

        const res = await request(`trilium.sid=${signed("stale-session")}; other=1; trilium.sid=${signed("live-session")}`);
        expect(res.body).toEqual({ sessionID: "live-session", loggedIn: true });
        expect(warn).toHaveBeenCalledOnce();
        expect(String(warn.mock.calls[0][0])).toContain(`2 "trilium.sid" cookies`);

        await request(`trilium.sid=${signed("stale-session")}; trilium.sid=${signed("live-session")}`);
        expect(warn).toHaveBeenCalledOnce();
        warn.mockRestore();
    });

    it("never picks a session whose cookie signature does not verify", async () => {
        await set("forged-session", baseSession());
        const forged = encodeURIComponent("s:forged-session.invalid-signature");

        const res = await request(`trilium.sid=${signed("stale-session")}; trilium.sid=${forged}`);
        expect(res.body.loggedIn).toBe(false);
        expect(res.body.sessionID).not.toBe("forged-session");
    });

    it("passes over undecodable, unsigned and unreadable session cookies", async () => {
        await set("corrupt-session", baseSession());
        cls.init(() => sql.execute(
            /*sql*/`UPDATE sessions SET data = 'not json' WHERE id = ?`, [ "corrupt-session" ]
        ));
        await set("kept-session", baseSession());

        const res = await request([
            "trilium.sid=%E0%A4%A",
            "trilium.sid=unsigned-session",
            `trilium.sid=${signed("corrupt-session")}`,
            `trilium.sid=${signed("kept-session")}`
        ].join("; "));
        expect(res.body).toEqual({ sessionID: "kept-session", loggedIn: true });
    });
});
