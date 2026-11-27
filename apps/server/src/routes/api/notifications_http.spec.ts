import { NOTIFICATION_SOUND_MAX_BYTES } from "@triliumnext/commons";
import {
    app_info as appInfo,
    date_utils as dateUtils,
    options,
    sql_init as coreSqlInit
} from "@triliumnext/core";
import type { Application } from "express";
import supertest from "supertest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
    MULTIPART_CONTENT_TYPE, multipartFile, postChunked
} from "../../../spec/support/chunked_request.js";
import { refreshAuth } from "../../services/auth.js";
import config from "../../services/config.js";
import sql from "../../services/sql.js";
import serverSqlInit from "../../services/sql_init.js";
import utils from "../../services/utils.js";

/** The authentication and the CSRF check of the notification routes, through the real app. */
let app: Application;

/** The header of an MPEG-1 Layer III frame, and silence. */
const MP3_FRAME = Buffer.from([ 0xff, 0xfb, 0x90, 0x64, ...new Array<number>(60).fill(0) ]);

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

    it("refuse an upload of the sound past 1 MiB, also without a declared length", async () => {
        const { cookie, csrfToken } = await logIn();
        const filler = Array.from({ length: 17 }, () => Buffer.alloc(64 * 1024));
        const answer = await postChunked(app, "/api/notifications/sound", {
            cookie, "x-csrf-token": csrfToken, "content-type": MULTIPART_CONTENT_TYPE
        }, multipartFile({ fileName: "long.mp3", type: "audio/mpeg" }, MP3_FRAME, ...filler));

        expect(filler.length * filler[0].length).toBeGreaterThan(NOTIFICATION_SOUND_MAX_BYTES);
        expect(answer.status).toBe(400);
        expect(JSON.parse(answer.body)).toEqual({ code: "too-large" });
        expect((await supertest(app).get("/api/notifications/sound").set("Cookie", cookie))
            .status).toBe(404);
    });

    it("check the token of an upload of the sound and serve it with nosniff", async () => {
        const { cookie, csrfToken } = await logIn();
        const body = Buffer.concat(multipartFile({ fileName: "page.html", type: "text/html" },
            MP3_FRAME));
        const upload = (token?: string) => {
            const request = supertest(app).post("/api/notifications/sound").set("Cookie", cookie)
                .set("content-type", MULTIPART_CONTENT_TYPE);
            return (token ? request.set("x-csrf-token", token) : request).send(body);
        };

        expect((await upload()).status).toBe(403);
        expect((await upload(csrfToken)).status).toBe(204);
        // A response type makes supertest keep the body as bytes, which it leaves unread for audio.
        const sound = await supertest(app).get("/api/notifications/sound").set("Cookie", cookie)
            .responseType("blob");
        expect(sound.status).toBe(200);
        expect(sound.headers).toMatchObject({
            "content-type": "audio/mpeg", "x-content-type-options": "nosniff"
        });
        expect(Buffer.compare(sound.body as Buffer, MP3_FRAME)).toBe(0);
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

/** Logs in by password and returns the cookies and the CSRF token of the interactive session. */
async function logIn() {
    const login = await supertest(app).post("/login").send({ password: "demo1234" }).expect(302);
    const [ session ] = cookiesOf(login);
    const bootstrap = await supertest(app).get("/bootstrap").set("Cookie", session).expect(200);
    const csrfCookies = cookiesOf(bootstrap).filter((cookie) => cookie.startsWith("trilium-csrf="));
    return {
        cookie: [ session, ...csrfCookies ].join("; "),
        csrfToken: bootstrap.body.csrfToken as string
    };
}

/** The `name=value` parts of the cookies that a response sets. */
function cookiesOf(response: supertest.Response) {
    const cookies = (response.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
    return cookies.map((cookie) => cookie.split(";")[0]);
}

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
