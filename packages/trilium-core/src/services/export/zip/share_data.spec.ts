import { beforeEach, describe, expect, it, vi } from "vitest";

import becca from "../../../becca/becca.js";
import { buildNote } from "../../../test/becca_easy_mocking.js";
import scriptService from "../../script.js";
import { getSql } from "../../sql/index.js";
import { buildShareData, isHostedNote } from "./share_data.js";

describe("buildShareData", () => {
    beforeEach(() => {
        becca.reset();
    });

    it("writes the rows, blobs, images, maps and scripts the app views of the export read", () => {
        buildNote({ id: "outside", title: "Outside" });
        const root = buildNote({
            id: "siteRoot",
            children: [
                { id: "calendar", type: "book", content: "", "#viewType": "calendar", children: [
                    { id: "event", content: "<p>Event</p>", "~related": "outside" }
                ] },
                { id: "canvas", type: "canvas", content: "{}", attachments: [
                    {
                        id: "canvasSvg", title: "canvas-export.svg", role: "image",
                        mime: "image/svg+xml"
                    }
                ] },
                { id: "image", type: "image", mime: "image/png" },
                { id: "relations", type: "relationMap",
                    content: JSON.stringify({ notes: [ { noteId: "event" }, { noteId: "outside" } ] }) },
                { id: "map", type: "noteMap", content: "", "#mapRootNoteId": "calendar",
                    "#mapExcludeRelation": "template", "#mapIncludeRelation": "related" },
                { id: "hoistedMap", type: "noteMap", content: "", "#mapRootNoteId": "hoisted" },
                { id: "parentMap", type: "noteMap", content: "" },
                { id: "render", type: "render", content: "", "~renderNote": "script" },
                { id: "script", type: "code", mime: "application/javascript;env=frontend" },
                { id: "plain", content: "<p>Plain</p>" },
                { id: "locked" }
            ]
        });
        becca.getNoteOrThrow("locked").isProtected = true;
        const image = becca.getNoteOrThrow("image");
        image.getContent = () => new Uint8Array([ 1, 2 ]);
        const [ svg ] = becca.getNoteOrThrow("canvas").getAttachments();
        svg.getContent = () => new TextEncoder().encode("<svg/>");
        const bundle = vi.spyOn(scriptService, "getScriptBundleForFrontend")
            .mockReturnValue({ script: "run()", html: "", allNoteIds: [ "script" ] } as never);
        // The fixtures are in becca alone, so the query for the placed notes finds each.
        const placed = vi.spyOn(getSql(), "getColumn")
            .mockImplementation((_query, params) => params as never);

        const files = buildShareData(root, {
            getNotePath: (noteId) => (noteId === "siteRoot" ? "" : `pages/${noteId}.html`),
            getAttachmentPath: (attachmentId) => `pages/${attachmentId}.svg`
        });

        expect([ ...files.keys() ].sort()).toEqual([
            "data/blobs/attachments/canvasSvg.json",
            "data/blobs/notes/calendar.json",
            "data/blobs/notes/canvas.json",
            "data/blobs/notes/event.json",
            "data/blobs/notes/hoistedMap.json",
            "data/blobs/notes/image.json",
            "data/blobs/notes/map.json",
            "data/blobs/notes/parentMap.json",
            "data/blobs/notes/relations.json",
            "data/blobs/notes/render.json",
            "data/images/image.png",
            "data/note-map/calendar-link.json",
            "data/note-map/calendar-tree.json",
            "data/note-map/siteRoot-link.json",
            "data/note-map/siteRoot-tree.json",
            "data/relation-map/relations.json",
            "data/rows.json",
            "data/script/script.json"
        ]);
        const read = (name: string) => JSON.parse(String(files.get(name)));

        const rows = read("data/rows.json");
        expect(rows.notes.map((note: { noteId: string }) => note.noteId).sort()).toEqual([
            "calendar", "canvas", "event", "hoistedMap", "image", "map", "parentMap", "plain",
            "relations", "render", "script", "siteRoot"
        ]);
        expect(rows.links.siteRoot).toBe("");
        expect(rows.links.event).toBe("pages/event.html");
        expect(rows.attributes.some((attribute: { name: string }) => attribute.name === "related"))
            .toBe(false);
        expect(rows.attachments.canvas[0])
            .toMatchObject({ attachmentId: "canvasSvg", ownerId: "canvas" });
        expect(rows.attachmentPaths).toEqual({ canvasSvg: "pages/canvasSvg.svg" });
        expect(rows.images)
            .toEqual({ image: "data/images/image.png", canvas: "pages/canvasSvg.svg" });

        expect(read("data/blobs/notes/event.json").content).toBe("<p>Event</p>");
        expect(read("data/blobs/attachments/canvasSvg.json").content).toBe("<svg/>");
        expect(files.get("data/images/image.png")).toEqual(new Uint8Array([ 1, 2 ]));
        expect(Object.keys(read("data/relation-map/relations.json").noteTitles))
            .toEqual([ "event" ]);
        const treeMap = read("data/note-map/calendar-tree.json");
        expect(treeMap.notes.map(([ noteId ]: [ string ]) => noteId).sort())
            .toEqual([ "calendar", "event" ]);
        expect(read("data/script/script.json").script).toBe("run()");

        bundle.mockReturnValue({ script: "", html: "", allNoteIds: [ "script", "outside" ] } as never);
        const withOutsideModule = buildShareData(root, {
            getNotePath: (noteId) => (noteId === "outside" ? null : noteId),
            getAttachmentPath: () => null
        });
        expect(withOutsideModule.has("data/script/script.json")).toBe(false);
        expect(JSON.parse(String(withOutsideModule.get("data/rows.json"))).images)
            .toEqual({ image: "data/images/image.png" });
        bundle.mockRestore();
        placed.mockRestore();
    });

    it("tells the notes a page hosts an app view for", () => {
        expect(isHostedNote(buildNote({ type: "book", "#viewType": "geoMap" }))).toBe(true);
        expect(isHostedNote(buildNote({ type: "book" }))).toBe(false);
        expect(isHostedNote(buildNote({ type: "mindMap" }))).toBe(true);
        expect(isHostedNote(buildNote({ type: "text" }))).toBe(false);
    });
});
