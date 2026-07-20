import type { Application, Request, Response } from "express";
import supertest from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

import config from "../services/config.js";
import { markAsInternalElectronRequest } from "../services/electron_request.js";

let app: Application;
// Imported dynamically after the app is built: the route module pulls in the
// CSRF/session machinery, which needs the core (crypto) to be initialized.
let bootstrap: typeof import("./index.js")["bootstrap"];

describe("bootstrap", () => {
    beforeAll(async () => {
        config.General.noAuthentication = false;
        const { refreshAuth } = await import("../services/auth.js");
        refreshAuth();
        const buildApp = (await import("../app.js")).default;
        app = await buildApp();
        bootstrap = (await import("./index.js")).bootstrap;
    });

    // Regression test for #10589: a browser connecting to the desktop's TCP
    // listener must be treated as a web client (login screen, no Electron
    // fields), even though the process-wide isElectron flag may be true.
    it("serves the login payload without Electron fields to an unauthenticated browser", async () => {
        const response = await supertest(app).get("/bootstrap").expect(200);

        expect(response.body.loggedIn).toBe(false);
        expect(response.body.login).toBeTruthy();
        expect(response.body.isElectron).toBe(false);
        expect(response.body.wsBaseUrl).toBeUndefined();
        expect(response.body.httpBaseUrl).toBeUndefined();
        expect(response.body.hasNativeTitleBar).toBe(false);
    });

    it("serves the full Electron payload to a request marked as internal", () => {
        const req = {
            session: { id: "test-session" },
            query: {},
            cookies: {},
            headers: {}
        };
        markAsInternalElectronRequest(req);

        let payload: Record<string, unknown> | undefined;
        const res = {
            cookie() {
                return this;
            },
            send(body: Record<string, unknown>) {
                payload = body;
            }
        };

        bootstrap(req as unknown as Request, res as unknown as Response);

        expect(payload).toBeTruthy();
        expect(payload?.loggedIn).toBe(true);
        expect(payload?.isElectron).toBe(true);
        expect(payload?.device).toBe("desktop");
        expect(payload?.wsBaseUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/$/);
        expect(payload?.httpBaseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    });
});
