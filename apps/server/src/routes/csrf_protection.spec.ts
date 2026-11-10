import cookieParser from "cookie-parser";
import express, { type Application } from "express";
import supertest from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { markAsInternalElectronRequest } from "../services/electron_request.js";
import sqlInit from "../services/sql_init.js";
import { CSRF_COOKIE_NAME, doubleCsrfProtection, generateCsrfToken } from "./csrf_protection.js";

describe("doubleCsrfProtection", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("accepts the token from the header or from a URL-encoded form body", async () => {
        const agent = supertest.agent(buildApp());
        const token = await fetchToken(agent);

        await agent.post("/protected").set("x-csrf-token", token).expect(200, "ok");
        await agent.post("/protected").type("form").send({ "x-csrf-token": token }).expect(200, "ok");
    });

    it("rejects a request whose token is missing, malformed or in a JSON body", async () => {
        const agent = supertest.agent(buildApp());
        const token = await fetchToken(agent);

        await agent.post("/protected").expect(403);
        await agent.post("/protected").set("x-csrf-token", "forged-token").expect(403);
        // A repeated form field parses to an array, which is not accepted as a token.
        await agent.post("/protected").type("form").send(`x-csrf-token=${token}&x-csrf-token=${token}`).expect(403);
        // Only browser form submissions may carry the token in the body.
        await agent.post("/protected").send({ "x-csrf-token": token }).expect(403);
    });

    it("rejects a valid token presented by another session", async () => {
        const token = await fetchToken(supertest.agent(buildApp("session-a")));
        const otherSession = supertest.agent(buildApp("session-b"));
        await fetchToken(otherSession);

        await otherSession.post("/protected").set("x-csrf-token", token).expect(403);
    });

    it("skips the check for the desktop's own renderer requests", async () => {
        await supertest(buildApp("sid", { internalElectron: true })).post("/protected").expect(200, "ok");
    });

    it("skips the check while the database is not initialized", async () => {
        vi.spyOn(sqlInit, "isDbInitialized").mockReturnValue(false);
        await supertest(buildApp()).post("/protected").expect(200, "ok");
    });
});

/** An app with a fixed session id, an endpoint issuing a CSRF token and one protected by it. */
function buildApp(sessionId = "sid", { internalElectron = false } = {}): Application {
    const app = express();
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(cookieParser());
    app.use((req, _res, next) => {
        req.session = { id: sessionId } as typeof req.session;
        if (internalElectron) {
            markAsInternalElectronRequest(req);
        }
        next();
    });
    app.get("/token", (req, res) => {
        res.json({ token: generateCsrfToken(req, res) });
    });
    app.post("/protected", doubleCsrfProtection, (_req, res) => {
        res.send("ok");
    });
    app.use(((err, _req, res, _next) => {
        res.sendStatus(err.status ?? 500);
    }) as express.ErrorRequestHandler);
    return app;
}

async function fetchToken(agent: ReturnType<typeof supertest.agent>) {
    const response = await agent.get("/token").expect(200);
    expect(String(response.headers["set-cookie"])).toContain(`${CSRF_COOKIE_NAME}=`);
    return response.body.token as string;
}
