import { afterEach, describe, expect, it, vi } from "vitest";

import { createShareFrocaSource, createStaticFrocaSource } from "./share_froca_source.js";

describe("createShareFrocaSource", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("links a note to the page of its ID until a loaded row names its own link", async () => {
        stubFiles({ "api/tree?noteIds=aliased": { notes: [], branches: [], attributes: [], links: { aliased: "./nice-name" } } });
        const source = createShareFrocaSource({ shown: "./shown-alias" });

        expect(source.getNoteLink("shown")).toBe("./shown-alias");
        expect(source.getNoteLink("aliased")).toBe("./aliased");
        expect(source.getNoteLink("a b")).toBe("./a%20b");
        await source.loadNotes([ "aliased" ]);
        expect(source.getNoteLink("aliased")).toBe("./nice-name");
    });
});

describe("createStaticFrocaSource", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("answers froca from the files of the static export, relative to the page", async () => {
        const fetch = stubFiles({
            "../data/rows.json": ROWS,
            "../data/blobs/notes/event.json": { content: "<p>Event</p>" },
            "../data/note-map/0.json": { notes: [ [ "filtered" ] ] },
            "../data/note-map/1.json": { notes: [ [ "plain" ] ] },
            "../data/relation-map/relations.json": { noteTitles: { event: "Event" } },
            "../data/script/script.json": { script: "run()" }
        });
        const links: Record<string, string> = {};
        const source = createStaticFrocaSource(links, "../");

        expect(await source.loadNotes([ "event" ])).toEqual({
            notes: ROWS.notes, branches: ROWS.branches, attributes: ROWS.attributes
        });
        expect(links).toEqual({ siteRoot: "../", event: "../pages/event.html" });
        expect(source.getNoteLink("event")).toBe("../pages/event.html");
        expect(source.getNoteLink("notExported")).toBeNull();
        expect(await source.getAttachments("canvas")).toEqual([ SVG ]);
        expect(await source.getAttachments("event")).toEqual([]);
        expect(await source.getSiblingAttachments("svg")).toEqual([ SVG ]);
        await expect(source.getSiblingAttachments("gone")).rejects.toThrow("no attachment 'gone'");
        expect(await source.getBlob("notes", "event")).toEqual({ content: "<p>Event</p>" });

        const filters = { excludeRelations: [ "template" ], includeRelations: [] };
        expect(await source.getNoteMap("site", "link", filters))
            .toEqual({ notes: [ [ "filtered" ] ] });
        expect(await source.getNoteMap("site", "link",
            { excludeRelations: [ "other" ], includeRelations: [] }))
            .toEqual({ notes: [ [ "filtered" ] ] });
        expect(await source.getNoteMap("site", "tree", filters))
            .toEqual({ notes: [ [ "plain" ] ] });
        expect(await source.getNoteMap("elsewhere", "tree", filters))
            .toEqual({ notes: [], links: [], noteIdToDescendantCountMap: {} });
        expect(await source.getRelationMap("relations", []))
            .toEqual({ noteTitles: { event: "Event" } });
        expect(await source.getScriptBundle("script")).toEqual({ script: "run()" });
        expect(await source.getScriptBundle("missing")).toBeUndefined();
        expect(fetch.mock.calls.filter(([ url ]) => url === "../data/rows.json")).toHaveLength(1);
    });

    it("finds the images of the export once it has read its rows", async () => {
        stubFiles({ "data/rows.json": ROWS });
        const source = createStaticFrocaSource({}, "");

        expect(source.getImageUrl({ noteId: "image" })).toBeNull();
        await source.loadNotes([]);
        expect(source.getImageUrl({ noteId: "image" })).toBe("data/images/image.png");
        expect(source.getImageUrl({ noteId: "canvas" })).toBe("pages/canvas_svg.svg");
        expect(source.getImageUrl({ attachmentId: "svg" })).toBe("pages/canvas_svg.svg");
        expect(source.getImageUrl({ noteId: "unknown" })).toBeNull();
        expect(source.getImageUrl({ attachmentId: "unknown" })).toBeNull();
    });

    it("lists a note's children that are not archived, the one search it answers", async () => {
        stubFiles({ "data/rows.json": {
            ...ROWS,
            branches: [
                { branchId: "a", noteId: "open", parentNoteId: "board" },
                { branchId: "b", noteId: "archived", parentNoteId: "board" },
                { branchId: "c", noteId: "elsewhere", parentNoteId: "other" }
            ],
            attributes: [
                { noteId: "archived", type: "label", name: "archived", value: "" },
                { noteId: "open", type: "relation", name: "archived", value: "x" }
            ]
        } });
        const source = createStaticFrocaSource({}, "");

        expect(await source.searchNoteIds("note.parents.noteId=\"board\" #!archived", "board"))
            .toEqual([ "open" ]);
    });

    it("finds nothing and keeps nothing it is asked to search or save", async () => {
        const source = createStaticFrocaSource({}, "");

        expect(await source.searchNoteIds("#a", "root")).toEqual([]);
        expect(await source.searchInSubtree("#a", "root"))
            .toEqual({ searchResultNoteIds: [], highlightedTokens: [], error: null });
        expect(await source.lintSearch("#a")).toEqual({ error: null });
        expect(await source.getAttributeNames("label", "a")).toEqual([]);
        await expect(source.saveAttachment("note", {
            role: "viewConfig", title: "config.json", mime: "application/json", content: "{}",
            position: 0
        })).resolves.toBeUndefined();
        await expect(source.removeAttachment("attachment")).resolves.toBeUndefined();
    });
});

const SVG = { attachmentId: "svg", ownerId: "canvas", title: "canvas-export.svg" };

const ROWS = {
    notes: [ { noteId: "event", title: "Event" } ],
    branches: [ { branchId: "site_event", noteId: "event", parentNoteId: "siteRoot" } ],
    attributes: [],
    links: { siteRoot: "", event: "pages/event.html" },
    attachments: { canvas: [ SVG ] },
    attachmentPaths: { svg: "pages/canvas_svg.svg" },
    images: { image: "data/images/image.png", canvas: "pages/canvas_svg.svg" },
    noteMaps: {
        "site/link?exclude=template": "data/note-map/0.json",
        "site/tree?": "data/note-map/1.json"
    }
};

/** Has `fetch` answer each of `files` by its URL with its JSON, and anything else with a 404. */
function stubFiles(files: Record<string, unknown>) {
    const fetch = vi.fn(async (url: string) => (url in files
        ? new Response(JSON.stringify(files[url]))
        : new Response("", { status: 404, statusText: "Not Found" })));
    vi.stubGlobal("fetch", fetch);
    return fetch;
}
