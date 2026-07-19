/**
 * End-to-end test of the sync protocol as the desktop client drives it, with the
 * built-in OIDC (OAuth) sign-in method enabled on the server — regression test for
 * https://github.com/TriliumNext/Trilium/issues/10548.
 *
 * The desktop sync client authenticates via an HMAC handshake (`POST /api/login/sync`)
 * and then replays the raw `Set-Cookie` value (attributes included) as its `Cookie`
 * header for the follow-up `/api/sync/*` requests (see the cookie jar in
 * `apps/server/src/services/request.ts`). This suite drives that exact exchange through
 * the real Express app — session parser, reactive OIDC middleware and route registration
 * included — to pin down that:
 *
 *   1. the express-openid-connect middleware passes `/api/*` requests through untouched
 *      even when OAuth is configured and active, and
 *   2. sync responses carry exactly ONE cookie (`trilium.sid`). This is what keeps the
 *      desktop jar working: Electron's `net` module serializes an array-valued `Cookie`
 *      header by `Array.prototype.toString()` — a bare-comma join — so a second
 *      Set-Cookie in any response (e.g. a reverse-proxy affinity cookie) merges into the
 *      previous cookie's attributes on replay and destroys the session cookie.
 */
import { app_info as appInfo, cls, date_utils as dateUtils, options } from "@triliumnext/core";
import type { Application } from "express";
import supertest from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

import { refreshAuth } from "../../src/services/auth.js";
import config from "../../src/services/config.js";
import utils from "../../src/services/utils.js";

let app: Application;

describe("sync protocol with built-in OIDC enabled (#10548)", () => {
    beforeAll(async () => {
        // The spec config.ini runs with noAuthentication=true; sync auth is only exercised
        // with real authentication on. refreshAuth() re-reads the flag into auth.ts's cache.
        config.General.noAuthentication = false;
        refreshAuth();

        // Configure OAuth as a real OIDC deployment would (config.ini / env vars) and select
        // it as the sign-in method. The issuer is deliberately unreachable: plain API requests
        // never trigger provider discovery, mirroring an unattended desktop syncing against an
        // OIDC-protected server, and the RP-Initiated-Logout probe degrades gracefully.
        config.MultiFactorAuthentication.oauthBaseUrl = "http://localhost:4200";
        config.MultiFactorAuthentication.oauthClientId = "spec-client";
        config.MultiFactorAuthentication.oauthClientSecret = "a-very-long-spec-only-oauth-secret-0123456789";
        config.MultiFactorAuthentication.oauthIssuerBaseUrl = "http://127.0.0.1:1";
        cls.init(() => options.setOption("mfaMethod", "oauth"));

        const buildApp = (await import("../../src/app.js")).default;
        app = await buildApp();
    });

    it("engages the OIDC middleware (sanity check that this suite tests what it claims)", async () => {
        // /authenticate only exists inside the express-openid-connect router. When the
        // reactive middleware is active it handles the route (and errors with 500 because
        // the issuer above is unreachable); were OAuth unconfigured, the request would fall
        // through to the 404 handler and this suite would silently test nothing.
        const res = await supertest(app).get("/authenticate");
        expect(res.status).toBe(500);
    });

    it("performs the full desktop sync round-trip: login, push, pull, finished", async () => {
        const sessionCookie = await syncLogin();

        // The login response must set exactly one cookie: the session. A second Set-Cookie
        // on any sync response breaks the desktop client (see file header) — this is the
        // server-side guarantee that keeps the Electron cookie jar functional.
        expect(sessionCookie).toMatch(/^trilium\.sid=/);

        // push — the request that 401s in #10548
        await supertest(app)
            .put("/api/sync/update?logMarkerId=spec")
            .set("Cookie", sessionCookie)
            .set("pageCount", "1")
            .set("pageIndex", "0")
            .send({ entities: [], instanceId: "spec-desktop" })
            .expect(204);

        // pull
        const changed = await supertest(app)
            .get("/api/sync/changed?instanceId=spec-desktop&lastEntityChangeId=0&logMarkerId=spec")
            .set("Cookie", sessionCookie)
            .expect(200);
        expect(changed.body.entityChanges).toBeDefined();

        await supertest(app)
            .post("/api/sync/finished")
            .set("Cookie", sessionCookie)
            .expect(204);
    });

    it("rejects sync requests without the session cookie", async () => {
        const res = await supertest(app)
            .put("/api/sync/update?logMarkerId=spec")
            .set("pageCount", "1")
            .set("pageIndex", "0")
            .send({ entities: [], instanceId: "spec-desktop" });
        expect(res.status).toBe(401);
        expect(res.text).toBe("Logged in session not found");
    });

    it("allows the setup wizard to trigger sync/now without a CSRF token while the DB is uninitialized", async () => {
        // Pre-initialization, SQLiteSessionStore no-ops, so every request gets a fresh
        // session id — and csrf-csrf binds tokens to the session id, meaning CSRF
        // validation can NEVER pass during setup. The wizard's resume/retry sync/now
        // call used to die on 403 "Invalid CSRF token" (silently — the client swallowed
        // it), leaving a failed initial sync stuck forever. CSRF also protects nothing
        // here: before initialization there is no authenticated session to ride.
        const sql = (await import("../../src/services/sql.js")).default;
        sql.execute("UPDATE options SET value = 'false' WHERE name = 'initialized'");
        try {
            const res = await supertest(app).post("/api/sync/now");
            expect(res.status).toBe(200);
            // No sync options configured on the fixture — the request must reach the
            // handler (proving CSRF was bypassed) and report not-configured.
            expect(res.body.errorCode).toBe("NOT_CONFIGURED");
        } finally {
            sql.execute("UPDATE options SET value = 'true' WHERE name = 'initialized'");
        }
    });

    it("loses the session when a foreign cookie precedes trilium.sid in a comma-joined Cookie header (#10548 mechanism)", async () => {
        const sessionCookie = await syncLogin();

        // This is byte-for-byte what the server receives from the desktop when a response
        // carried two Set-Cookie headers (proxy affinity cookie first): the jar stores the
        // array and Electron's net joins it with a bare comma, so trilium.sid gets swallowed
        // into the preceding cookie's attributes ("HttpOnly,trilium.sid" is not a valid key).
        // The 401 is correct server behavior — the fix for #10548 belongs in the client jar —
        // but this documents the exact failure reported in the issue.
        const mangled = `INGRESSCOOKIE=abc123; Path=/; Secure; HttpOnly,${sessionCookie}`;
        const res = await supertest(app)
            .put("/api/sync/update?logMarkerId=spec")
            .set("Cookie", mangled)
            .set("pageCount", "1")
            .set("pageIndex", "0")
            .send({ entities: [], instanceId: "spec-desktop" });
        expect(res.status).toBe(401);
        expect(res.text).toBe("Logged in session not found");
    });
});

/**
 * Performs the HMAC sync login and returns the raw Set-Cookie value — attributes and all —
 * exactly as the desktop cookie jar stores and replays it.
 */
async function syncLogin(): Promise<string> {
    const timestamp = dateUtils.utcNowDateTime();
    const documentSecret = options.getOption("documentSecret");
    const hash = utils.hmac(documentSecret, timestamp);

    const res = await supertest(app)
        .post("/api/login/sync")
        .send({ timestamp, syncVersion: appInfo.syncVersion, hash })
        .expect(200);
    expect(res.body.instanceId).toBeTruthy();

    const setCookie: string[] = res.headers["set-cookie"] ?? [];
    expect(setCookie).toHaveLength(1);
    return setCookie[0];
}
