import { dayjs } from "@triliumnext/commons";
import type { Application } from "express";
import { SessionData } from "express-session";
import supertest, { type Response } from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

import cls from "../services/cls.js";
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

    it("should return the login page, when using a GET request", async () => {

        // RegExp for login page specific string in HTML
        const res = await supertest(app)
            .get("/login")
            .expect(200);

        expect(res.text).toMatch(/assets\/v[0-9.a-z]+\/src\/login\.js/);

    });

    it("returns a 401 status, when login fails with wrong password", async () => {

        await supertest(app)
            .post("/login")
            .send({ password: "fakePassword" })
            .expect(401);

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
