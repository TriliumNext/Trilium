import { dayjs } from "@triliumnext/commons";
import type { Application } from "express";
import { SessionData } from "express-session";
import supertest, { type Response } from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { cls, options } from "@triliumnext/core";
import { refreshAuth } from "../services/auth.js";
import config from "../services/config.js";
import { type SQLiteSessionStore } from "./session_parser.js";

let app: Application;
let sessionStore: SQLiteSessionStore;
let CLEAN_UP_INTERVAL: number;

describe("Login Route test", () => {

    beforeAll(async () => {
        vi.useFakeTimers();
        const buildApp = (await import("../app.js")).default;
        app = await buildApp();
        ({ sessionStore, CLEAN_UP_INTERVAL } = (await import("./session_parser.js")));
    });

    afterAll(() => {
        vi.useRealTimers();
    });

    it("redirects GET /login to the SPA root with the login marker, since login is served client-side", async () => {
        const res = await supertest(app)
            .get("/login")
            .expect(302);

        expect(res.headers.location).toBe("./?login");
    });

    it("returns a 401 status, when login fails with wrong password", async () => {

        await supertest(app)
            .post("/login")
            .send({ password: "fakePassword" })
            .expect(401);

    });

    describe("login stays reachable with redirectBareDomain enabled (#10552)", () => {
        // The fixture DB contains a #shareRoot note (y0AFOwgOgkWO), so enabling
        // redirectBareDomain arms the bare-domain → share redirect in checkAuth.
        // The login screen is served by the SPA at the root, so an explicit login
        // request must still be able to reach it — otherwise the share redirect
        // locks the owner out of their own instance.
        let originalNoAuthentication: boolean;

        beforeAll(() => {
            // The spec data dir's config.ini enables noAuthentication, which makes
            // checkAuth wave every request through and would mask the redirect
            // behavior under test.
            originalNoAuthentication = config.General.noAuthentication;
            config.General.noAuthentication = false;
            refreshAuth();
            cls.init(() => options.setOption("redirectBareDomain", "true"));
        });

        afterAll(() => {
            config.General.noAuthentication = originalNoAuthentication;
            refreshAuth();
            cls.init(() => options.setOption("redirectBareDomain", "false"));
        });

        it("still redirects the bare domain itself to the share page", async () => {
            const res = await supertest(app).get("/").expect(302);
            expect(res.headers.location).toBe("share");
        });

        it("GET /login ends on the login screen, not the share page", async () => {
            const { res, path } = await followRedirects(app, "/login");

            expect(path).not.toMatch(/^\/share/);
            expect(res.status).toBe(200);
        });

        it("GET /login/ (trailing slash) ends on the login screen, not a redirect loop", async () => {
            const { res, path } = await followRedirects(app, "/login/");

            expect(path).not.toMatch(/^\/share/);
            expect(res.status).toBe(200);
        });

        it("serves the bootstrap payload to a logged-out client instead of redirecting it to share", async () => {
            // The SPA's login screen is driven by the bootstrap `loggedIn: false`
            // payload; if /bootstrap gets bounced to the share page, the login
            // screen can never render even when the SPA itself is served.
            const res = await supertest(app).get("/bootstrap").expect(200);
            expect(res.body.loggedIn).toBe(false);
        });
    });

    describe("Login when 'Remember Me' is ticked", async () => {
        // TriliumNextTODO: make setting cookieMaxAge via env variable work
        // => process.env.TRILIUM_SESSION_COOKIEMAXAGE
        // the custom cookieMaxAge is currently hardocded in the test data dir's config.ini

        let res: Response;
        let setCookieHeader: string;
        let expectedExpiresDate: string;

        beforeAll(async () => {
            const CUSTOM_MAX_AGE_SECONDS = 86400;

            expectedExpiresDate = dayjs().utc().add(CUSTOM_MAX_AGE_SECONDS, "seconds").toDate().toUTCString();
            res = await supertest(app)
                .post("/login")
                .send({ password: "demo1234", rememberMe: 1 })
                .expect(302);
            setCookieHeader = res.headers["set-cookie"][0];
        });

        it("sets correct Expires for the cookie", async () => {
            // match for e.g. "Expires=Wed, 07 May 2025 07:02:59 GMT;"
            const expiresCookieRegExp = /Expires=(?<date>[\w\s,:]+)/;
            const expiresCookieMatch = setCookieHeader.match(expiresCookieRegExp);
            const actualExpiresDate = new Date(expiresCookieMatch?.groups?.date || "").toUTCString();

            expect(actualExpiresDate).to.not.eql("Invalid Date");

            // ignore the seconds in the comparison, just to avoid flakiness in tests,
            // if for some reason execution is slow between calculation of expected and actual
            expect(actualExpiresDate.slice(0,23)).toBe(expectedExpiresDate.slice(0,23));
        });

        it("sets the correct sesssion data", async () => {
            // Check the session is stored in the database.
            const { session, expiry } = await getSessionFromCookie(setCookieHeader);
            expect(session!).toBeTruthy();
            expect(session!.cookie.expires).toBeTruthy();
            expect(new Date(session!.cookie.expires!).toUTCString().substring(0, 23))
                .toBe(expectedExpiresDate.substring(0, 23));
            expect(session!.loggedIn).toBe(true);
            expect(expiry).toStrictEqual(new Date(session!.cookie.expires!));
        });

        it("doesn't renew the session on subsequent requests", async () => {
            const { expiry: originalExpiry } = await getSessionFromCookie(setCookieHeader);

            // Simulate user waiting half the period before the session expires.
            vi.setSystemTime(originalExpiry!.getTime() - (originalExpiry!.getTime() - Date.now()) / 2);

            // Make a request to renew the session.
            await supertest(app)
                .get("/")
                .set("Cookie", setCookieHeader)
                .expect(200);

            // Check the session is still valid and has not been renewed.
            const { session, expiry } = await getSessionFromCookie(setCookieHeader);
            expect(session).toBeTruthy();
            expect(expiry!.getTime()).toStrictEqual(originalExpiry!.getTime());
        });

        it("cleans up expired sessions", async () => {
            let { session, expiry } = await getSessionFromCookie(setCookieHeader);
            expect(session).toBeTruthy();
            expect(expiry).toBeTruthy();

            vi.setSystemTime(expiry!);
            cls.init(() => vi.advanceTimersByTime(CLEAN_UP_INTERVAL));
            ({ session } = await getSessionFromCookie(setCookieHeader));
            expect(session).toBeFalsy();
        });
    });

    describe("Login when 'Remember Me' is not ticked", async () => {
        let res: Response;
        let setCookieHeader: string;

        beforeAll(async () => {
            res = await supertest(app)
                .post("/login")
                .send({ password: "demo1234" })
                .expect(302);

            setCookieHeader = res.headers["set-cookie"][0];
        });

        it("does not set Expires", async () => {
            // match for e.g. "Expires=Wed, 07 May 2025 07:02:59 GMT;"
            expect(setCookieHeader).not.toMatch(/Expires=(?<date>[\w\s,:]+)/);
        });

        it("stores the session in the database", async () => {
            const { session, expiry } = await getSessionFromCookie(setCookieHeader);
            expect(session!).toBeTruthy();
            expect(session!.cookie.expires).toBeUndefined();
            expect(session!.loggedIn).toBe(true);

            const expectedExpirationDate = dayjs().utc().add(1, "day").toDate();
            expect(expiry?.getTime()).toBeGreaterThan(new Date().getTime());
            expect(expiry?.getTime()).toBeLessThanOrEqual(expectedExpirationDate.getTime());
        });

        it("renews the session on subsequent requests", async () => {
            const { expiry: originalExpiry } = await getSessionFromCookie(setCookieHeader);

            // Simulate user waiting half the period before the session expires.
            vi.setSystemTime(originalExpiry!.getTime() - (originalExpiry!.getTime() - Date.now()) / 2);

            // Make a request to renew the session.
            await supertest(app)
                .get("/")
                .set("Cookie", setCookieHeader)
                .expect(200);

            // Check the session is still valid and has been renewed.
            const { session, expiry } = await getSessionFromCookie(setCookieHeader);
            expect(session).toBeTruthy();
            expect(expiry!.getTime()).toBeGreaterThan(originalExpiry!.getTime());
        });

        it("keeps session up to 24 hours", async () => {
            // Simulate user waiting 23 hours.
            vi.setSystemTime(dayjs().add(23, "hours").toDate());
            vi.advanceTimersByTime(CLEAN_UP_INTERVAL);

            // Check the session is still valid.
            const { session } = await getSessionFromCookie(setCookieHeader);
            expect(session).toBeTruthy();
        });

        it("cleans up expired sessions", async () => {
            let { session, expiry } = await getSessionFromCookie(setCookieHeader);
            expect(session).toBeTruthy();
            expect(expiry).toBeTruthy();

            vi.setSystemTime(expiry!);
            vi.advanceTimersByTime(CLEAN_UP_INTERVAL);
            ({ session } = await getSessionFromCookie(setCookieHeader));
            expect(session).toBeFalsy();
        });
    });
}, 100_000);

const MAX_REDIRECT_HOPS = 5;

/**
 * Follows 3xx redirects the way a browser would, resolving relative `Location`
 * headers (".", "share", …) against the current URL. Stops after
 * {@link MAX_REDIRECT_HOPS} hops so redirect loops surface as a final 3xx
 * response instead of hanging the test.
 */
async function followRedirects(app: Application, startPath: string) {
    let url = new URL(startPath, "http://localhost");
    let res = await supertest(app).get(url.pathname + url.search);

    for (let hop = 0; hop < MAX_REDIRECT_HOPS && res.status >= 300 && res.status < 400; hop++) {
        const location = res.headers.location;
        if (!location) {
            break;
        }

        url = new URL(location, url);
        res = await supertest(app).get(url.pathname + url.search);
    }

    return { res, path: url.pathname };
}

async function getSessionFromCookie(setCookieHeader: string) {
    // Extract the session ID from the cookie.
    const sessionIdMatch = setCookieHeader.match(/trilium.sid=(?<sessionId>[^;]+)/)?.[1];
    expect(sessionIdMatch).toBeTruthy();

    // Check the session is stored in the database.
    const sessionId = decodeURIComponent(sessionIdMatch!).slice(2).split(".")[0];
    return {
        session: await getSessionFromStore(sessionId),
        expiry: sessionStore.getSessionExpiry(sessionId)
    };
}

function getSessionFromStore(sessionId: string) {
    return new Promise<SessionData | null | undefined>((resolve, reject) => {
        sessionStore.get(sessionId, (err, session) => {
            if (err) {
                reject(err);
            } else {
                resolve(session);
            }
        });
    });
}
