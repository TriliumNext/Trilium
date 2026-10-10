import { NOTE_TYPE_IMAGE_ATTACHMENTS } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCrypto } from "../services/encryption/crypto.js";
import SearchResult from "../services/search/search_result.js";
import searchService from "../services/search/services/search.js";
import { encodeBase64, encodeUtf8 } from "../services/utils/binary.js";
import { buildShareNote } from "../test/shaca_mocking.js";
import {
    getShareRoute, getShareRoutes, handleShareRequest, type ShareReply, type ShareRequest
} from "./handlers.js";
import { SHARE_ROUTE_PATHS, type ShareRoutePath } from "./route_paths.js";
import { getShareProvider } from "./share_provider.js";
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

    afterEach(() => {
        vi.restoreAllMocks();
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

    it("lists only the children visible in the tree in a note's JSON", () => {
        buildShareTree([ {
            id: "jsonParent",
            content: "<p>Parent</p>",
            children: [
                { id: "jsonVisible", content: "<p>Visible</p>" },
                { "id": "jsonHidden", "content": "<p>Hidden</p>", "#shareHiddenFromTree": "" }
            ]
        } ]);

        const reply = request("/share/api/notes/:noteId", { params: { noteId: "jsonParent" } });
        expect(reply.status).toBe(200);
        expect(JSON.parse(String(reply.body))).toMatchObject({ childNoteIds: [ "jsonVisible" ] });
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

        const routes = getShareRoutes();
        expect(routes.map((route) => route.path)).toEqual([ ...SHARE_ROUTE_PATHS ]);
        for (const route of routes) {
            expect(route.handle, route.path).toBe(getShareRoute(route.path).handle);
        }
    });

    it("answers 503 until the share provider is ready and lets unexpected errors through", () => {
        buildShareTree([ { id: "readyNote", content: "<p>Ready</p>" } ]);
        const isReady = vi.spyOn(getShareProvider(), "isReady").mockReturnValue(false);
        const reply = request("/share/:shareId", { params: { shareId: "readyNote" } });
        expect(reply.status).toBe(503);
        expect(String(reply.body)).toContain("still initializing");
        isReady.mockRestore();
        expect(request("/share/:shareId", { params: { shareId: "readyNote" } }).status).toBe(200);

        const failing = {
            path: "/share/" as const,
            handle: (): ShareReply => {
                throw new Error("unexpected failure");
            }
        };
        expect(() => handleShareRequest(failing, buildRequest("/share/"))).toThrow("unexpected failure");
    });

    it("answers 404 when a route's id parameter is missing", () => {
        buildShareTree([]);

        expect(String(request("/share/:shareId").body)).toContain("<html");
        for (const path of [
            "/share/:shareId",
            "/share/api/notes/:noteId",
            "/share/api/notes/:noteId/download",
            "/share/api/notes/:noteId/view",
            "/share/api/images/:noteId/:filename",
            "/share/api/attachments/:attachmentId/image/:filename",
            "/share/api/attachments/:attachmentId/download"
        ] as const) {
            expect(request(path).status, path).toBe(404);
        }
    });

    it("locks a raw SVG note down with a content security policy, but not raw HTML", () => {
        buildShareTree([
            { id: "rawSvg", type: "image", mime: "image/svg+xml", content: "<svg/>", "#shareRaw": "" },
            { id: "rawHtml", content: "<p>Raw</p>", "#shareRaw": "" }
        ]);

        const svg = request("/share/:shareId", { params: { shareId: "rawSvg" } });
        expect(svg.headers).toMatchObject({
            "Content-Type": "image/svg+xml",
            "X-Content-Type-Options": "nosniff"
        });
        expect(svg.headers["Content-Security-Policy"]).toContain("default-src 'none'");
        expect(svg.body).toBe("<svg/>");

        const html = request("/share/:shareId", { params: { shareId: "rawHtml" } });
        expect(html.headers["Content-Type"]).toBe("text/html");
        expect(html.headers).not.toHaveProperty("Content-Security-Policy");
        expect(html.body).toBe("<p>Raw</p>");
    });

    it("withholds an included note behind credentials until the request presents them", () => {
        buildShareTree([
            {
                id: "hostNote",
                content: `<section class="include-note" data-note-id="lockedEmbed">&nbsp;</section>`
            },
            { "id": "lockedEmbed", "content": "<p>embedded secret</p>", "#shareCredentials": "root:hunter2" }
        ]);

        const anonymous = String(request("/share/:shareId", { params: { shareId: "hostNote" } }).body);
        expect(anonymous).toContain("include-note-forbidden");
        expect(anonymous).not.toContain("embedded secret");

        const authorized = String(request("/share/:shareId", {
            params: { shareId: "hostNote" },
            headers: { authorization: `Basic ${encodeBase64("root:hunter2")}` }
        }).body);
        expect(authorized).toContain("embedded secret");
        expect(authorized).not.toContain("include-note-forbidden");
    });

    it("refuses credentials that are not Basic or that the decoder rejects", () => {
        buildShareTree([
            { "id": "lockedNote", "content": "<p>classified</p>", "#shareCredentials": "root:hunter2" }
        ]);
        const valid = `Basic ${encodeBase64("root:hunter2")}`;
        const fetchNote = (authorization: string) => request("/share/api/notes/:noteId", {
            params: { noteId: "lockedNote" },
            headers: { authorization }
        }).status;

        expect(fetchNote(`Bearer ${encodeBase64("root:hunter2")}`)).toBe(401);

        vi.spyOn(getCrypto(), "base64Decode").mockImplementationOnce(() => {
            throw new Error("invalid base64");
        });
        expect(fetchNote(valid)).toBe(401);
        expect(fetchNote(valid)).toBe(200);
    });

    it("serves the SVG a canvas, mermaid or mind map note renders to, sanitized", () => {
        buildShareTree([
            {
                id: "canvasNote",
                type: "canvas",
                mime: "application/json",
                content: "{}",
                attachments: [
                    { id: "canvasExport", title: NOTE_TYPE_IMAGE_ATTACHMENTS.canvas, mime: "image/svg+xml" }
                ]
            },
            {
                id: "mermaidNote",
                type: "mermaid",
                mime: "text/mermaid",
                content: JSON.stringify({ svg: `<svg id="legacy"><script>alert(1)</script></svg>` })
            },
            { id: "mindMapNote", type: "mindMap", mime: "application/json", content: "not json" },
            {
                id: "binaryExport",
                type: "canvas",
                mime: "application/json",
                content: JSON.stringify({ svg: `<svg id="fallback"/>` }),
                attachments: [ { id: "binaryAttachment", title: NOTE_TYPE_IMAGE_ATTACHMENTS.canvas } ]
            }
        ]);
        stubAttachmentContent("canvasExport", `<svg id="export" onload="alert(1)"/>`);
        stubAttachmentContent("binaryAttachment", encodeUtf8("<svg id=\"binary\"/>"));
        const image = (noteId: string) => request("/share/api/images/:noteId/:filename", {
            params: { noteId, filename: "x.svg" }
        });

        const canvas = image("canvasNote");
        expect(canvas.status).toBe(200);
        expect(canvas.headers).toMatchObject({
            "Content-Type": "image/svg+xml",
            "X-Content-Type-Options": "nosniff"
        });
        expect(canvas.headers["Content-Security-Policy"]).toContain("default-src 'none'");
        expect(canvas.body).toBe(`<svg id="export"/>`);

        // Before attachments existed, the SVG lived under the `svg` key of the note's own JSON.
        expect(image("mermaidNote").body).toBe(`<svg id="legacy"></svg>`);
        expect(image("binaryExport").body).toBe(`<svg id="fallback"/>`);
        expect(image("mindMapNote").body).toBe("<svg/>");

        for (const content of [ "", "5", "{}", "{\"svg\":1}", "{\"svg\":\"\"}" ]) {
            const legacyNote = shaca.getNote("mindMapNote");
            legacyNote.getContent = () => content;
            expect(image("mindMapNote").body, content).toBe("<svg/>");
        }
    });

    it("serves an image attachment and downloads any attachment, behind its owner's checks", () => {
        buildShareTree([
            {
                "id": "attachmentOwner",
                "content": "<p>Owner</p>",
                "#shareDisallowRobotIndexing": "true",
                "attachments": [
                    { id: "pngAttachment", role: "image", mime: "image/png", title: "picture.png" },
                    { id: "svgAttachment", role: "image", mime: "image/svg+xml", title: "drawing.svg" },
                    { id: "fileAttachment", role: "file", mime: "application/pdf", title: "report.pdf" }
                ]
            },
            {
                id: "protectedOwner",
                content: "<p>Secret</p>",
                isProtected: true,
                attachments: [ { id: "protectedAttachment", role: "image", mime: "image/png" } ]
            },
            {
                "id": "lockedOwner",
                "content": "<p>Locked</p>",
                "#shareCredentials": "root:hunter2",
                "attachments": [ { id: "lockedAttachment", role: "image", mime: "image/png" } ]
            }
        ]);
        const pngBytes = new Uint8Array([ 0x89, 0x50, 0x4e, 0x47 ]);
        stubAttachmentContent("pngAttachment", pngBytes);
        stubAttachmentContent("svgAttachment", encodeUtf8(`<svg><script>alert(1)</script></svg>`));
        stubAttachmentContent("fileAttachment", "%PDF");
        for (const attachmentId of [ "protectedAttachment", "lockedAttachment" ]) {
            stubAttachmentContent(attachmentId, "attachment bytes");
        }
        const image = (attachmentId: string) => request(
            "/share/api/attachments/:attachmentId/image/:filename",
            { params: { attachmentId, filename: "x" } }
        );
        const download = (attachmentId: string) => request(
            "/share/api/attachments/:attachmentId/download",
            { params: { attachmentId } }
        );

        const png = image("pngAttachment");
        expect(png).toMatchObject({ status: 200, body: pngBytes });
        expect(png.headers).toEqual({ "X-Robots-Tag": "noindex", "Content-Type": "image/png" });

        const svg = image("svgAttachment");
        expect(svg.body).toBe("<svg></svg>");
        expect(svg.headers).toMatchObject({ "X-Robots-Tag": "noindex", "Content-Type": "image/svg+xml" });
        expect(svg.headers["Content-Security-Policy"]).toContain("default-src 'none'");

        stubAttachmentContent("svgAttachment", undefined);
        expect(image("svgAttachment")).toMatchObject({ status: 200, body: "" });

        expect(image("fileAttachment").status).toBe(400);
        const pdf = download("fileAttachment");
        expect(pdf).toMatchObject({ status: 200, body: "%PDF" });
        expect(pdf.headers).toMatchObject({
            "X-Robots-Tag": "noindex",
            "Content-Type": "application/pdf",
            "Cache-Control": "no-cache, no-store, must-revalidate"
        });
        expect(pdf.headers["Content-Disposition"]).toContain("report.pdf");

        for (const route of [ image, download ]) {
            const missing = route("noSuchAttachment");
            expect(missing.status).toBe(404);
            expect(String(missing.body)).toContain("noSuchAttachment");

            const protectedReply = route("protectedAttachment");
            expect(protectedReply.status).toBe(404);
            expect(String(protectedReply.body)).not.toContain("attachment bytes");

            expect(route("lockedAttachment").status).toBe(401);
        }
    });

    it("searches the share tree and returns only the results the caller can see", () => {
        buildShareTree([
            {
                id: "docs",
                title: "Docs",
                content: "",
                children: [
                    { id: "visible", title: "Visible", content: "" },
                    { "id": "labelHidden", "title": "Label hidden", "content": "", "#shareHiddenFromTree": "" },
                    { id: "branchHidden", title: "Branch hidden", content: "" },
                    { "id": "locked", "title": "Locked", "content": "", "#shareCredentials": "root:hunter2" },
                    { id: "protectedNote", title: "Protected", content: "", isProtected: true }
                ]
            },
            { id: "outside", title: "Outside", content: "" }
        ]);
        shaca.shareIndexEnabled = true;
        shaca.getBranchFromChildAndParent("branchHidden", "docs").isHidden = true;

        const visible = new SearchResult([ "root", "_share", "docs", "visible" ]);
        visible.score = 7;
        visible.contentSnippet = "plain snippet";
        visible.highlightedContentSnippet = "<b>plain</b> snippet";
        const results = [
            visible,
            ...[ "labelHidden", "branchHidden", "locked", "protectedNote" ]
                .map((noteId) => new SearchResult([ "root", "_share", "docs", noteId ])),
            new SearchResult([ "root", "notShared" ]),
            new SearchResult([ "root", "outside" ]),
            new SearchResult([ "root", "_share", "visible" ]),
            new SearchResult([ "root", "_share", "notShared", "visible" ])
        ];
        // The spies replace the search service on its shared default export, which handlers.ts
        // already holds; a vi.mock() of the module would not reach that instance.
        const findResults = vi.spyOn(searchService, "findResultsWithQuery").mockReturnValue(results);
        const buildDetails = vi.spyOn(searchService, "buildSearchResultDetails").mockReturnValue([]);
        const search = (query: ShareRequest["query"], authorization?: string) => request(
            "/share/api/notes",
            { query, headers: authorization ? { authorization } : {} }
        );
        const titles = (reply: ShareReply) => {
            const { results: found } = JSON.parse(String(reply.body)) as { results: { title: string }[] };
            return found.map((result) => result.title);
        };

        const anonymous = search({ search: "anything" });
        expect(anonymous.status).toBe(200);
        expect(JSON.parse(String(anonymous.body))).toEqual({
            results: [ {
                id: "visible",
                noteId: "visible",
                title: "Visible",
                score: 7,
                path: "Docs / Visible",
                snippet: "plain snippet",
                highlightedSnippet: "<b>plain</b> snippet"
            } ]
        });
        expect(findResults.mock.lastCall?.[1].ancestorNoteId).toBe("_share");
        expect(buildDetails.mock.lastCall?.[0]).toEqual([ visible ]);

        const authorized = search({ search: "anything" }, `Basic ${encodeBase64("root:hunter2")}`);
        expect(titles(authorized)).toEqual([ "Visible", "Locked" ]);

        const scoped = JSON.parse(String(search({ search: "anything", ancestorNoteId: "docs" }).body));
        expect(scoped.results[0].path).toBe("Visible");

        expect(search({ search: "anything", ancestorNoteId: [ "docs", "outside" ] }).status).toBe(400);
        expect(search({}).status).toBe(400);
        expect(search({ search: "   " }).status).toBe(400);
        expect(search({ search: [ "a", "b" ] }).status).toBe(400);
    });

    it("filters a shared collection to the matches the caller can see, with the tokens to highlight", () => {
        buildShareTree([ {
            id: "board",
            title: "Board",
            content: "",
            children: [
                { id: "seen", title: "Seen", content: "" },
                { "id": "guarded", "title": "Guarded", "content": "", "#shareCredentials": "root:hunter2" },
                { id: "secret", title: "Secret", content: "", isProtected: true }
            ]
        } ]);
        vi.spyOn(searchService, "findResultsWithQuery").mockImplementation((_query, context) => {
            context.highlightedTokens.push("seen");
            return [ "seen", "guarded", "secret", "unshared" ]
                .map((noteId) => new SearchResult([ "root", "_share", "board", noteId ]));
        });
        const filter = (query: ShareRequest["query"], authorization?: string) => request(
            "/share/api/search", { query, headers: authorization ? { authorization } : {} });

        const reply = filter({ searchString: "seen", ancestorNoteId: "board" });
        expect(reply.status).toBe(200);
        expect(JSON.parse(String(reply.body))).toMatchObject({
            searchResultNoteIds: [ "seen" ],
            highlightedTokens: [ expect.objectContaining({ token: "seen" }) ],
            error: null
        });
        const authorized = filter({ searchString: "seen", ancestorNoteId: "board" },
            `Basic ${encodeBase64("root:hunter2")}`);
        expect(JSON.parse(String(authorized.body)).searchResultNoteIds).toEqual([ "seen", "guarded" ]);

        expect(filter({ ancestorNoteId: "board" }).status).toBe(400);
        expect(filter({ searchString: "seen" }).status).toBe(400);
        expect(filter({ searchString: "seen", ancestorNoteId: "missing" }).status).toBe(404);
    });

    it("reads a search string without running it, answering its error", () => {
        const lint = (query: ShareRequest["query"]) => request("/share/api/search/lint", { query });
        vi.spyOn(searchService, "validateSearchQuery").mockImplementation((query) =>
            (query === "#" ? "Misplaced or incomplete expression" : null));

        expect(JSON.parse(String(lint({ searchString: "#" }).body))).toEqual({ error: "Misplaced or incomplete expression" });
        expect(JSON.parse(String(lint({ searchString: "title" }).body))).toEqual({ error: null });
        expect(lint({}).status).toBe(400);
    });
});

function stubAttachmentContent(attachmentId: string, content: string | Uint8Array | undefined) {
    const attachment = shaca.getAttachment(attachmentId);
    attachment.getContent = () => content;
}

/** Builds the `_share` subtree the renderer walks up to, and returns its root. */
function buildShareTree(children: Parameters<typeof buildShareNote>[0][]) {
    return buildShareNote({ id: shareRoot.SHARE_ROOT_NOTE_ID, title: "Shared Notes", content: "", children });
}

function request(path: ShareRoutePath, overrides: RequestOverrides = {}) {
    return handleShareRequest(getShareRoute(path), buildRequest(path, overrides));
}

type RequestOverrides = Partial<ShareRequest> & { headers?: Record<string, string> };

function buildRequest(path: ShareRoutePath, overrides: RequestOverrides = {}): ShareRequest {
    const { headers = {}, ...rest } = overrides;

    return {
        path: `/share/${path}`,
        params: {},
        query: {},
        getHeader: (name: string) => headers[name.toLowerCase()],
        ...rest
    };
}
