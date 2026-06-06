import { app_info as appInfo, cls, date_utils as dateUtils, options, options as optionService } from "@triliumnext/core";
import type { Application, Request } from "express";
import supertest from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

import totpService from "../../services/totp.js";
import utils from "../../services/utils.js";
import loginApiRoute from "./login.js";

function syncReq(body: Record<string, unknown>) {
    const session: Record<string, unknown> = {
        // mimic express-session: regenerate clears the session and invokes the callback
        regenerate(cb: (err?: unknown) => void) {
            regenerateCalled = true;
            for (const key of Object.keys(session)) {
                if (key !== "regenerate") {
                    delete session[key];
                }
            }
            cb();
        }
    };
    return { body, session } as unknown as Request;
}

let regenerateCalled = false;

describe("Login (sync) API", () => {
    it("rejects a timestamp that is out of sync", async () => {
        const stale = dateUtils.utcDateTimeStr(new Date(Date.now() - 10 * 60 * 1000));
        const result = await loginApiRoute.loginSync(syncReq({ timestamp: stale, syncVersion: appInfo.syncVersion }));
        expect(result[0]).toBe(401);
    });

    it("rejects a non-matching sync version", async () => {
        const now = dateUtils.utcNowDateTime();
        const result = await loginApiRoute.loginSync(syncReq({ timestamp: now, syncVersion: appInfo.syncVersion + 1 }));
        expect(result[0]).toBe(400);
        expect((result[1] as { message: string }).message).toContain("Non-matching sync versions");
    });

    it("rejects an incorrect hash", async () => {
        const now = dateUtils.utcNowDateTime();
        const result = await loginApiRoute.loginSync(syncReq({ timestamp: now, syncVersion: appInfo.syncVersion, hash: "wrong" }));
        expect(result[0]).toBe(400);
        expect((result[1] as { message: string }).message).toContain("Sync login credentials are incorrect");
    });

    it("logs in with a correct HMAC of the document secret and regenerates the session", async () => {
        const now = dateUtils.utcNowDateTime();
        const documentSecret = options.getOption("documentSecret");
        const hash = utils.hmac(documentSecret, now);
        const req = syncReq({ timestamp: now, syncVersion: appInfo.syncVersion, hash });
        regenerateCalled = false;
        const result = await loginApiRoute.loginSync(req) as { instanceId: string; maxEntityChangeId: number };
        expect(result.instanceId).toBeTruthy();
        // session must be regenerated (fixation protection) before being marked as logged in
        expect(regenerateCalled).toBe(true);
        expect(req.session.loggedIn).toBe(true);
    });
});

// Integration test that drives the request through the real route registration
// (app.js -> routes.ts). loginSync is async, so it MUST be registered with
// `asyncRoute`; the synchronous `route()` wraps the handler in better-sqlite3's
// `db.transaction()`, which throws "Transaction function cannot return a promise"
// for an async handler. A direct unit call (above) cannot catch that regression.
describe("Login (sync) API (integration)", () => {
    let agent: ReturnType<typeof supertest.agent>;

    beforeAll(async () => {
        const buildApp = (await import("../../app.js")).default;
        const app: Application = await buildApp();
        agent = supertest.agent(app);
    });

    it("logs in over HTTP through the transactional route wrapper", async () => {
        const now = dateUtils.utcNowDateTime();
        const documentSecret = options.getOption("documentSecret");
        const hash = utils.hmac(documentSecret, now);

        const res = await agent
            .post("/api/login/sync")
            .send({ timestamp: now, syncVersion: appInfo.syncVersion, hash })
            .expect(200);

        expect(res.body.instanceId).toBeTruthy();
    });
});

describe("Login (token) API", () => {
    it("rejects an incorrect password", async () => {
        const req = { body: { password: "wrongpassword" } } as unknown as Request;
        expect(await loginApiRoute.token(req)).toEqual([401, "Incorrect credential"]);
    });

    it("issues an ETAPI token for the correct password", async () => {
        const req = { body: { password: "demo1234", tokenName: "spec-sender" } } as unknown as Request;
        const result = await cls.init(() => loginApiRoute.token(req)) as { token: string };
        expect(result.token).toBeTruthy();
    });

    it("rejects login when TOTP is enabled and the submitted token is wrong", async () => {
        cls.init(() => {
            optionService.setOption("mfaEnabled", "true");
            totpService.createSecret(); // stores a secret so TOTP counts as enabled
        });

        const req = { body: { password: "demo1234", totpToken: "000000" } } as unknown as Request;
        expect(await cls.init(() => loginApiRoute.token(req))).toEqual([401, "Incorrect credential"]);
    });
});
