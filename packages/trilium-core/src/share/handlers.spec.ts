import { beforeEach, describe, expect, it, vi } from "vitest";

import { encodeBase64 } from "../services/utils/binary.js";
import { buildShareNote } from "../test/shaca_mocking.js";
import { getShareRoute, handleShareRequest, type ShareRequest } from "./handlers.js";
import { SHARE_ROUTE_PATHS, type ShareRoutePath } from "./route_paths.js";
import shareRoot from "./share_root.js";
import shaca from "./shaca/shaca.js";

vi.mock("../becca/becca_loader.js", () => ({
    default: {
        load: vi.fn(),
        loaded: Promise.resolve()
    }
}));

describe("share handlers", () => {
    beforeEach(() => {
        shaca.reset();
        // Marked loaded so shacaLoader.ensureLoad() leaves the tree each test builds by hand alone,
        // rather than replacing it with whatever the database holds.
        shaca.loaded = true;
    });

    it("addresses the share root by trailing slash and redirects the bare path to it", () => {
        expect(request("/share/", { path: "/share" })).toMatchObject({ status: 302, redirect: "../share/" });
        expect(request("/share/", { path: "/share/" })).toMatchObject({ status: 404 });

        buildShareTree([ {
            id: "landingNote",
            title: "Landing",
            content: "<p>Landing</p>",
            "#shareRoot": "",
            children: [ { id: "child", title: "Child", content: "<p>Child</p>" } ]
        } ]);
        expect(shaca.shareRootNote?.noteId).toBe("landingNote");

        const reply = request("/share/", { path: "/share/" });
        expect(reply.status).toBe(200);
        expect(String(reply.body)).toContain("Landing");
    });

    it("renders a shared note as HTML and serves its raw content when asked", () => {
        buildShareTree([ { id: "plainNote", title: "Plain", content: "<p>Hello</p>", "#shareAlias": "my-alias" } ]);
        shaca.aliasToNote["my-alias"] = shaca.getNote("plainNote");

        const rendered = request("/share/:shareId", { params: { shareId: "my-alias" } });
        expect(rendered.status).toBe(200);
        expect(rendered.headers["Content-Type"]).toBe("text/html; charset=utf-8");
        expect(String(rendered.body)).toContain("Hello");

        const raw = request("/share/:shareId", { params: { shareId: "plainNote" }, query: { raw: "" } });
        expect(raw.status).toBe(200);
        expect(raw.headers["Content-Type"]).toBe("text/html");
        expect(raw.body).toBe("<p>Hello</p>");
    });

    it("refuses a protected note's bytes on every route that streams them (GHSA-xmv9-3v98-7gq8)", () => {
        buildShareTree([
            { id: "lockedUp", content: "<p>classified body</p>", isProtected: true },
            { id: "openNote", content: "<p>public body</p>" }
        ]);

        for (const path of [
            "/share/api/notes/:noteId/download",
            "/share/api/notes/:noteId/view",
            "/share/api/images/:noteId/:filename"
        ] as const) {
            const refused = request(path, { params: { noteId: "lockedUp", filename: "x.png" } });
            expect(refused.status, path).toBe(404);
            expect(String(refused.body), path).not.toContain("classified");

            // The same route on an unprotected sibling does serve the bytes, so the 404 above is
            // the protection refusing it rather than the route being unreachable. The image route
            // is the exception: a text note is not an image, which it answers 400 to.
            const served = request(path, { params: { noteId: "openNote", filename: "x.png" } });
            expect(served.status, path).toBe(path.includes("/images/") ? 400 : 200);
            if (served.status === 200) {
                expect(String(served.body), path).toContain("public body");
            }
        }

        // `?raw` would otherwise stream the same bytes the routes above refuse.
        const raw = request("/share/:shareId", { params: { shareId: "lockedUp" }, query: { raw: "" } });
        expect(raw.status).toBe(404);
        expect(String(raw.body)).not.toContain("classified");

        expect(request("/share/:shareId", { params: { shareId: "openNote" }, query: { raw: "" } }).body).toBe("<p>public body</p>");
    });

    it("asks for credentials until matching HTTP Basic ones arrive", () => {
        buildShareTree([ { id: "lockedNote", content: "<p>classified</p>", "#shareCredentials": "root:hunter2" } ]);

        const anonymous = request("/share/api/notes/:noteId", { params: { noteId: "lockedNote" } });
        expect(anonymous.status).toBe(401);
        expect(anonymous.headers["WWW-Authenticate"]).toContain("Basic realm=");
        expect(anonymous.body).toBeUndefined();

        const wrong = request("/share/api/notes/:noteId", {
            params: { noteId: "lockedNote" },
            headers: { authorization: `Basic ${encodeBase64("root:nope")}` }
        });
        expect(wrong.status).toBe(401);

        const right = request("/share/api/notes/:noteId", {
            params: { noteId: "lockedNote" },
            headers: { authorization: `Basic ${encodeBase64("root:hunter2")}` }
        });
        expect(right.status).toBe(200);
        expect(JSON.parse(String(right.body)).noteId).toBe("lockedNote");
    });

    it("sanitizes an SVG note and locks it down with a content security policy", () => {
        buildShareTree([ {
            id: "svgNote",
            type: "image",
            mime: "image/svg+xml",
            content: `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`
        } ]);

        const reply = request("/share/api/images/:noteId/:filename", { params: { noteId: "svgNote", filename: "x.svg" } });
        expect(reply.status).toBe(200);
        expect(reply.headers["Content-Type"]).toBe("image/svg+xml");
        expect(reply.headers["Content-Security-Policy"]).toContain("default-src 'none'");
        expect(String(reply.body)).not.toContain("<script>");
    });

    it("marks a note that opts out of robot indexing, and only that note", () => {
        buildShareTree([
            { id: "indexedNote", content: "<p>a</p>" },
            { id: "unindexedNote", content: "<p>b</p>", "#shareDisallowRobotIndexing": "true" }
        ]);

        expect(request("/share/:shareId", { params: { shareId: "unindexedNote" } }).headers["X-Robots-Tag"]).toBe("noindex");
        expect(request("/share/:shareId", { params: { shareId: "indexedNote" } }).headers).not.toHaveProperty("X-Robots-Tag");
    });

    it("answers 404 for an unknown note and refuses the share index while it is disabled", () => {
        const missing = request("/share/:shareId", { params: { shareId: "nothingHere" } });
        expect(missing.status).toBe(404);
        expect(String(missing.body)).toContain("<html");

        buildShareTree([]);
        shaca.shareIndexEnabled = false;
        expect(request("/share/api/notes/:noteId", { params: { noteId: shareRoot.SHARE_ROOT_NOTE_ID } }).status).toBe(403);
    });

    it("declares one handler per published route path", () => {
        for (const path of SHARE_ROUTE_PATHS) {
            expect(typeof getShareRoute(path).handle, path).toBe("function");
        }
    });
});

/** Builds the `_share` subtree the renderer walks up to, and returns its root. */
function buildShareTree(children: Parameters<typeof buildShareNote>[0][]) {
    return buildShareNote({ id: shareRoot.SHARE_ROOT_NOTE_ID, title: "Shared Notes", content: "", children });
}

function request(path: ShareRoutePath, overrides: Partial<ShareRequest> & { headers?: Record<string, string> } = {}) {
    const { headers = {}, ...rest } = overrides;

    return handleShareRequest(getShareRoute(path), {
        path: `/share/${path}`,
        params: {},
        query: {},
        getHeader: (name: string) => headers[name.toLowerCase()],
        ...rest
    });
}
