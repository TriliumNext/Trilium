import {
    app_info as appInfo,
    date_utils as dateUtils,
    options,
    sql_init as coreSqlInit
} from "@triliumnext/core";
import type { Application } from "express";
import supertest from "supertest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { refreshAuth } from "../../services/auth.js";
import config from "../../services/config.js";
import sql from "../../services/sql.js";
import serverSqlInit from "../../services/sql_init.js";
import utils from "../../services/utils.js";

/** The authentication and the CSRF check of the notification routes, through the real app. */
let app: Application;

describe("notification routes over HTTP", () => {
    beforeAll(async () => {
        // The spec configuration turns authentication off.
        config.General.noAuthentication = false;
        refreshAuth();
        app = await (await import("../../app.js")).default();
    });

    afterEach(() => vi.restoreAllMocks());

    it("refuse an anonymous request, also on a database in its first sync", async () => {
        expect((await supertest(app).get("/api/notifications")).status).toBe(401);
        expect((await supertest(app).post("/api/notifications").send({ title: "Anonymous" }))
            .status).toBeGreaterThanOrEqual(400);

        vi.spyOn(serverSqlInit, "isDbInitialized").mockReturnValue(false);
        vi.spyOn(coreSqlInit, "isDbInitialized").mockReturnValue(false);
        const firstSync = await supertest(app).get("/api/notifications");
        expect(firstSync.status).toBe(409);
        expect(firstSync.body).toEqual({ code: "not-initialized" });
    });

    it("ask a mutation of an interactive session for the CSRF token", async () => {
        const agent = supertest.agent(app);
        await agent.post("/login").send({ password: "demo1234" }).expect(302);
        const { csrfToken } = (await agent.get("/bootstrap").expect(200)).body;

        expect((await agent.get("/api/notifications")).status).toBe(200);
        for (const request of [
            agent.post("/api/notifications").send({ title: "Without a token" }),
            agent.post("/api/notifications/state").send({ refs: [], state: "seen" }),
            agent.post("/api/notifications/dismiss").send({ refs: [], reason: "user" }),
            agent.patch("/api/notifications/spec:x").send({ patch: {} })
        ]) {
            expect((await request).status).toBe(403);
        }

        const created = await agent.post("/api/notifications").set("x-csrf-token", csrfToken)
            .send({ id: "spec:http", title: "With a token" });
        expect(created.status).toBe(200);
        expect(created.body.notification).toMatchObject({ id: "spec:http", producer: "client" });
    });

    it("refuse a sync session and a logged-in session without a kind", async () => {
        const syncCookie = await syncLogin();
        expect((await supertest(app).get("/api/notifications").set("Cookie", syncCookie))
            .status).toBe(401);

        const login = await supertest(app).post("/login").send({ password: "demo1234" })
            .expect(302);
        const cookie = (login.headers["set-cookie"] as unknown as string[])[0];
        await supertest(app).get("/api/notifications").set("Cookie", cookie).expect(200);
        sql.execute("UPDATE sessions SET data = json_remove(data, '$.sessionKind')");
        await supertest(app).get("/api/notifications").set("Cookie", cookie).expect(401);
    });
});

/** Logs in by HMAC as a sync client does, and returns the cookie of the sync session. */
async function syncLogin(): Promise<string> {
    const timestamp = dateUtils.utcNowDateTime();
    const hash = utils.hmac(options.getOption("documentSecret"), timestamp);
    const res = await supertest(app)
        .post("/api/login/sync")
        .send({ timestamp, syncVersion: appInfo.syncVersion, hash })
        .expect(200);
    return (res.headers["set-cookie"] as unknown as string[])[0];
}
