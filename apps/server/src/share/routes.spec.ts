import { becca, cls, options, password_encryption, protected_session, task_states } from "@triliumnext/core";
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

    interface ShareSearchResult {
        id: string;
        title: string;
        snippet?: string;
        highlightedSnippet?: string;
    }

    async function searchShare(query: string, auth?: string): Promise<ShareSearchResult[]> {
        let request = supertest(app).get(`/share/api/notes?ancestorNoteId=${SHARE_ROOT_ID}&search=${encodeURIComponent(query)}`);
        if (auth) {
            request = request.set("Authorization", `Basic ${Buffer.from(auth).toString("base64")}`);
        }
        const response = await request.expect(200);
        return response.body.results;
    }

    async function searchTitles(query: string, auth?: string) {
        return (await searchShare(query, auth)).map((r) => r.title);
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

    it("returns plain and highlighted content snippets for authorized search results", async () => {
        // "Shared that uses template" has the content "<p>Hello world.</p>".
        const results = await searchShare("world");
        const match = results.find((r) => r.title === "Shared that uses template");

        expect(match?.snippet).toBe("Hello world.");
        expect(match?.highlightedSnippet).toBe("Hello <b>world</b>.");
        expect(cannotSetHeadersCount).toBe(0);
    });

    it("does not build snippets for notes the caller cannot see", async () => {
        // Snippets are extracted only after the authorization filter, so an anonymous response
        // contains neither the hidden template's content ("Content Start") nor the
        // credential-protected note in any field.
        const hiddenContent = await searchShare("Content Start");
        expect(JSON.stringify(hiddenContent)).not.toContain("Content Start");

        const anonymous = await searchShare("Password protected share");
        expect(JSON.stringify(anonymous)).not.toContain("Password protected");

        const authenticated = await searchShare("Password protected share", "root:password");
        expect(authenticated.map((r) => r.title)).toContain("Password protected share");
        expect(cannotSetHeadersCount).toBe(0);
    });

    it("drops protected notes from search results while a protected session is open", async () => {
        // Protected notes cannot be shared (GHSA-xmv9-3v98-7gq8). With the owner's protected
        // session open, becca decrypts on read, so the route must drop these notes before
        // snippet extraction instead of relying on the content being unreadable.
        const dataKey = await password_encryption.getDataKey("demo1234");
        if (!(dataKey instanceof Uint8Array)) {
            throw new Error("Expected a data key from the fixture password.");
        }
        protected_session.default.setDataKey(dataKey);
        try {
            becca.decryptProtectedNotes();
            const protectedNote = becca.getNoteOrThrow(PROTECTED_SHARED_NOTE_ID);
            expect(protectedNote.isDecrypted).toBe(true);

            const results = await searchShare(protectedNote.title);
            const leaked = results.filter((r) => r.id === PROTECTED_SHARED_NOTE_ID
                || r.title === "[protected]"
                || r.title === protectedNote.title);
            expect(leaked).toEqual([]);
        } finally {
            protected_session.resetDataKey();
        }
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

    it("keeps the generated icon-pack stylesheet inside its style element", async () => {
        // The share page embeds the icon-pack and task-state CSS inline, so a value carried
        // into it from a note must not be able to close `<style>` and have the rest of the
        // response parsed as markup. A task state's color is one such value.
        cls.init(() => task_states.createTaskStateNote({
            name: "sharecssbreakout",
            title: "Share CSS breakout",
            markdownSymbol: "%",
            isCompleted: false,
            color: `red; } </style><script>window.xss=1</script><style> .x {`,
            icon: "bx bx-loader"
        }));

        const response = await supertest(app).get("/share/").expect(200);
        const styleEl = response.text.match(/<style id="trilium-icon-packs">([\s\S]*?)<\/style>/);

        expect(styleEl).toBeTruthy();
        expect(styleEl?.[1]).not.toContain("<script>");
        expect(response.text).not.toContain("window.xss=1");
        expect(cannotSetHeadersCount).toBe(0);
    });

});
