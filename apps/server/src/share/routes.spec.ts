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

    // The public search endpoint must apply the same per-note authorization as the
    // direct content routes: it must not leak notes protected by `shareCredentials`
    // or hidden with `shareHiddenFromTree`. The fixture's "Shared notes" root
    // (y0AFOwgOgkWO) contains "Password protected share" (shareCredentials
    // root:password) and "Shared Note Template" (shareHiddenFromTree).
    const SHARE_ROOT_ID = "y0AFOwgOgkWO";

    async function searchTitles(query: string, auth?: string) {
        let request = supertest(app).get(`/share/api/notes?ancestorNoteId=${SHARE_ROOT_ID}&search=${encodeURIComponent(query)}`);
        if (auth) {
            request = request.set("Authorization", `Basic ${Buffer.from(auth).toString("base64")}`);
        }
        const response = await request.expect(200);
        return (response.body.results as Array<{ title: string }>).map((r) => r.title);
    }

    it("does not leak shareHiddenFromTree notes via public search", async () => {
        const titles = await searchTitles("Shared Note Template");
        expect(titles).not.toContain("Shared Note Template");
        expect(cannotSetHeadersCount).toBe(0);
    });

    it("does not leak shareCredentials-protected notes via anonymous search, but returns them with credentials", async () => {
        const anonymousTitles = await searchTitles("Password protected share");
        expect(anonymousTitles).not.toContain("Password protected share");

        const authenticatedTitles = await searchTitles("Password protected share", "root:password");
        expect(authenticatedTitles).toContain("Password protected share");

        const wrongPasswordTitles = await searchTitles("Password protected share", "root:wrong");
        expect(wrongPasswordTitles).not.toContain("Password protected share");

        expect(cannotSetHeadersCount).toBe(0);
    });

    it("rejects search results whose note path bypasses the share ancestor (clones)", async () => {
        // A note cloned both under the share tree and elsewhere can surface with a
        // best note path that never passes through the requested ancestor — such a
        // result must be treated as not visible.
        const { isVisibleInShareTree } = await import("./routes.js");
        expect(isVisibleInShareTree(SHARE_ROOT_ID, ["root", "someUnsharedNote"])).toBe(false);
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
