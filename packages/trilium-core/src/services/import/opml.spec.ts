import { beforeAll, describe, expect, it } from "vitest";

import { getBecca } from "../../becca/becca.js";
import type BNote from "../../becca/entities/bnote.js";
import { getContext } from "../context.js";
import noteService from "../notes.js";
import sql_init from "../sql_init.js";
import TaskContext from "../task_context.js";
import { decodeUtf8 } from "../utils/binary.js";
import opml from "./opml.js";

let counter = 0;

/**
 * Creates a fresh parent note under root for an import so each `it()` works on
 * an isolated subtree of the shared fixture DB.
 */
function createParent(): BNote {
    counter++;
    return getContext().init(() =>
        noteService.createNewNote({
            parentNoteId: "root",
            title: `opml-spec-parent-${counter}`,
            content: "",
            type: "text"
        }).note
    );
}

function getTaskContext() {
    // "no-progress-reporting" suppresses the WebSocket broadcast in increaseProgressCount.
    return TaskContext.getInstance("no-progress-reporting", "importNotes", {});
}

function runImport(xml: string, parent: BNote) {
    return getContext().init(() => opml.importOpml(getTaskContext(), xml, parent));
}

describe("importOpml (real DB)", () => {
    beforeAll(async () => {
        sql_init.initializeDb();
        await sql_init.dbReady;
    });

    it("rejects unsupported OPML versions with a 400 tuple", async () => {
        const parent = createParent();
        const xml = `<?xml version="1.0"?>
            <opml version="9.9">
                <body>
                    <outline title="Nope" text="Nope" />
                </body>
            </opml>`;

        const result = (await runImport(xml, parent)) as [number, string];

        expect(Array.isArray(result)).toBe(true);
        expect(result[0]).toBe(400);
        expect(result[1]).toContain("9.9");
        // Nothing should have been imported when the version is rejected.
        expect(parent.getChildNotes()).toHaveLength(0);
    });

    it("imports a v1.0 outline tree, wrapping text in <p> and nesting children", async () => {
        const parent = createParent();
        const xml = `<?xml version="1.0"?>
            <opml version="1.0">
                <body>
                    <outline title="Parent" text="line one&#10;line two">
                        <outline title="Child" text="child text" />
                    </outline>
                </body>
            </opml>`;

        const returnNote = (await runImport(xml, parent)) as BNote;

        // The returned note is the first top-level outline.
        expect(returnNote.title).toBe("Parent");
        expect(getBecca().notes[returnNote.noteId]).toBe(returnNote);

        // v1 derives content from `text`, joining newlines into separate <p> blocks.
        expect(decodeUtf8(returnNote.getContent())).toBe("<p>line one</p><p>line two</p>");

        // The single top-level outline is placed under the import parent.
        const topLevel = parent.getChildNotes();
        expect(topLevel).toHaveLength(1);
        expect(topLevel[0].noteId).toBe(returnNote.noteId);

        // The nested outline becomes a child note.
        const children = returnNote.getChildNotes();
        expect(children).toHaveLength(1);
        expect(children[0].title).toBe("Child");
        expect(decodeUtf8(children[0].getContent())).toBe("<p>child text</p>");
    });

    it("falls back to text as the title (with empty content) when a v1 outline has a blank title", async () => {
        const parent = createParent();
        const xml = `<?xml version="1.0"?>
            <opml version="1.0">
                <body>
                    <outline title="   " text="the only text" />
                </body>
            </opml>`;

        const returnNote = (await runImport(xml, parent)) as BNote;

        // Blank/whitespace title triggers the issue-1862 fallback.
        expect(returnNote.title).toBe("the only text");
        expect(decodeUtf8(returnNote.getContent())).toBe("");
    });

    it("imports a v2.0 outline using text as title and _note as raw HTML content", async () => {
        const parent = createParent();
        const xml = `<?xml version="1.0"?>
            <opml version="2.0">
                <body>
                    <outline text="First" _note="&lt;p&gt;first body&lt;/p&gt;" />
                    <outline text="Second" _note="&lt;p&gt;second body&lt;/p&gt;" />
                </body>
            </opml>`;

        const returnNote = (await runImport(xml, parent)) as BNote;

        // Only the first created note is returned/activated.
        expect(returnNote.title).toBe("First");
        expect(decodeUtf8(returnNote.getContent())).toBe("<p>first body</p>");

        // Both top-level outlines are imported in order.
        const topLevel = parent.getChildNotes();
        expect(topLevel.map((n) => n.title)).toEqual(["First", "Second"]);

        const second = topLevel.find((n) => n.title === "Second")!;
        expect(decodeUtf8(second.getContent())).toBe("<p>second body</p>");
    });

    it("sanitizes dangerous markup out of v2 _note content", async () => {
        const parent = createParent();
        // <script> is not in the allowed-tags list, so the sanitizer must strip it.
        const xml = `<?xml version="1.0"?>
            <opml version="2.0">
                <body>
                    <outline text="XSS" _note="&lt;p&gt;safe&lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt;" />
                </body>
            </opml>`;

        const returnNote = (await runImport(xml, parent)) as BNote;

        const content = decodeUtf8(returnNote.getContent());
        // The safe paragraph survives; the disallowed <script> tag is stripped
        // (sanitize-html keeps the text node but drops the executable element).
        expect(content).toContain("<p>safe</p>");
        expect(content).not.toContain("<script");
        expect(content).not.toContain("</script>");
    });

    it("returns null and imports nothing when the OPML body has no outlines", async () => {
        const parent = createParent();
        const xml = `<?xml version="1.0"?>
            <opml version="2.0">
                <body></body>
            </opml>`;

        const returnNote = await runImport(xml, parent);

        expect(returnNote).toBeNull();
        expect(parent.getChildNotes()).toHaveLength(0);
    });

    it("rejects malformed XML by throwing", async () => {
        const parent = createParent();
        const xml = "<opml version=\"1.0\"><body><outline></body></opml>";

        await expect(runImport(xml, parent)).rejects.toThrow();
    });
}, 60_000);
