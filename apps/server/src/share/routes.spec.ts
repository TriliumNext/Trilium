import { cls, options } from "@triliumnext/core";
import type { Application, NextFunction,Request, Response } from "express";
import supertest from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { safeExtractMessageAndStackFromError } from "../services/utils.js";
import config from "../services/config.js";

let app: Application;

describe("Share API test", () => {
    let cannotSetHeadersCount = 0;

    beforeAll(async () => {
        vi.useFakeTimers();
        const buildApp = (await import("../app.js")).default;
        app = await buildApp();
        app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
            const [ errMessage ] = safeExtractMessageAndStackFromError(err);
            if (errMessage.includes("Cannot set headers after they are sent to the client")) {
                cannotSetHeadersCount++;
            }

            next();
        });
    });

    afterAll(() => {
        vi.useRealTimers();
    });

    beforeEach(() => {
        cannotSetHeadersCount = 0;
    });

    it("requests password for password-protected share", async () => {
        await supertest(app)
            .get("/share/YjlPRj2E9fOV")
            .expect(401)
            .expect("WWW-Authenticate", 'Basic realm="User Visible Realm", charset="UTF-8"');
        expect(cannotSetHeadersCount).toBe(0);
    });

    it("shows the login link in the share theme only when showLoginInShareTheme is enabled", async () => {
        // Regression test for #8323: the login link was lost when the share theme was
        // rewritten. It must render on the share root landing page (the redirectBareDomain
        // target) when the option is enabled, and stay hidden otherwise.
        const disabled = await supertest(app).get("/share/").expect(200);
        expect(disabled.text).not.toContain("login-link");

        cls.init(() => options.setOption("showLoginInShareTheme", "true"));
        try {
            const enabled = await supertest(app).get("/share/").expect(200);
            expect(enabled.text).toContain(`class="login-link"`);
            expect(enabled.text).toContain(`href="../login"`);
        } finally {
            cls.init(() => options.setOption("showLoginInShareTheme", "false"));
        }
        expect(cannotSetHeadersCount).toBe(0);
    });

    // A protected note cannot be shared (GHSA-xmv9-3v98-7gq8). The integration
    // fixture contains "Protected shared note" — a protected note placed under
    // the "Shared Notes" subtree that owns a protected file attachment.
    const PROTECTED_SHARED_NOTE_ID = "uOCKdcqOhDF5";
    const PROTECTED_SHARED_ATTACHMENT_ID = "vC6a1DskeJNh";

    it("does not serve a protected note's content over the public share routes (GHSA-xmv9-3v98-7gq8)", async () => {
        // Every route that streams raw note content must refuse a protected note.
        for (const path of [
            `/share/api/notes/${PROTECTED_SHARED_NOTE_ID}/download`,
            `/share/api/notes/${PROTECTED_SHARED_NOTE_ID}/view`,
            `/share/api/images/${PROTECTED_SHARED_NOTE_ID}/image.png`
        ]) {
            await supertest(app).get(path).expect(404);
        }

        expect(cannotSetHeadersCount).toBe(0);
    });

    it("does not serve a protected note's attachments over the public share routes (GHSA-xmv9-3v98-7gq8)", async () => {
        await supertest(app)
            .get(`/share/api/attachments/${PROTECTED_SHARED_ATTACHMENT_ID}/download`)
            .expect(404);

        await supertest(app)
            .get(`/share/api/attachments/${PROTECTED_SHARED_ATTACHMENT_ID}/image/secret`)
            .expect(404);

        expect(cannotSetHeadersCount).toBe(0);
    });

    it("renders custom share template", async () => {
        // Custom EJS templates require scripting to be enabled
        const originalEnabled = config.Security.backendScriptingEnabled;
        config.Security.backendScriptingEnabled = true;
        try {
            const response = await supertest(app)
                .get("/share/pQvNLLoHcMwH")
                .expect(200);
            expect(cannotSetHeadersCount).toBe(0);
            expect(response.text).toContain("Content Start");
            expect(response.text).toContain("Content End");
        } finally {
            config.Security.backendScriptingEnabled = originalEnabled;
        }
    });

});
