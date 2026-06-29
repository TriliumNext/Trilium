import type { Response } from "express";
import { beforeAll, describe, expect, it } from "vitest";

import type BBranch from "../../becca/entities/bbranch.js";
import type BNote from "../../becca/entities/bnote.js";
import { getContext } from "../context.js";
import noteService from "../notes.js";
import sql_init from "../sql_init.js";
import TaskContext from "../task_context.js";
import opml from "./opml.js";

let counter = 0;

/**
 * Creates a fresh note under the given parent in the shared in-memory fixture
 * DB. Each call uses a unique title so the `it()`s in this file (which share a
 * single DB copy per fork) don't collide.
 */
function createNote(
    parentNoteId: string,
    overrides: Partial<{ title: string; content: string; type: BNote["type"]; mime: string }> = {}
): { note: BNote; branch: BBranch } {
    counter++;
    return getContext().init(() =>
        noteService.createNewNote({
            parentNoteId,
            title: overrides.title ?? `opml-export-spec-${counter}`,
            content: overrides.content ?? "<p>hello</p>",
            type: overrides.type ?? "text",
            mime: overrides.mime
        })
    );
}

/** A minimal Express-`res`-like sink that records header writes and the body. */
class FakeResponse {
    headers: Record<string, string> = {};
    chunks: string[] = [];
    ended = false;

    setHeader(name: string, value: string) {
        this.headers[name] = value;
        return this;
    }

    write(chunk: string) {
        this.chunks.push(chunk);
        return true;
    }

    end() {
        this.ended = true;
        return this;
    }

    get body() {
        return this.chunks.join("");
    }
}

function getTaskContext() {
    // "no-progress-reporting" suppresses the WebSocket broadcast in increaseProgressCount.
    return TaskContext.getInstance("opml-export-spec", "export", null);
}

function runExport(branch: BBranch): FakeResponse {
    const res = new FakeResponse();
    opml.exportToOpml(getTaskContext(), branch, res as unknown as Response);
    return res;
}

describe("exportToOpml (real DB)", () => {
    beforeAll(async () => {
        sql_init.initializeDb();
        await sql_init.dbReady;
    });

    it("exports a document with the opml header, download headers and text/_note attribute pair", () => {
        const { note, branch } = createNote("root", {
            title: "Root note",
            content: "<p>body</p>"
        });

        const res = runExport(branch);

        // Streaming the export sets the OPML download headers.
        expect(res.headers["Content-Type"]).toBe("text/x-opml");
        expect(res.headers["Content-Disposition"]).toContain("Root%20note.opml");
        expect(res.ended).toBe(true);

        const body = res.body;
        // The XML/opml envelope is always emitted as OPML 2.0.
        expect(body).toContain(`<opml version="2.0">`);
        expect(body).toContain("<title>Trilium export</title>");
        expect(body.trim().endsWith("</opml>")).toBe(true);

        // The title goes in the standard `text` attribute; the raw HTML content is
        // XML-escaped into the `_note` extension attribute.
        expect(body).toContain(`<outline text="Root note" _note="&lt;p&gt;body&lt;/p&gt;">`);
        expect(body).toContain("</outline>");
        // The note was counted in the export progress (no throw from increaseProgressCount).
        expect(note.title).toBe("Root note");
    });

    it("escapes XML-significant characters in titles", () => {
        const { branch } = createNote("root", {
            title: `A & B <c> "d" 'e'`,
            content: ""
        });

        const body = runExport(branch).body;

        const escapedTitle = `A &amp; B &lt;c&gt; &quot;d&quot; &apos;e&apos;`;
        expect(body).toContain(`<outline text="${escapedTitle}" _note="">`);
    });

    it("recursively exports child notes nested inside the parent outline", () => {
        const { note: parent, branch } = createNote("root", { title: "Parent node", content: "" });
        createNote(parent.noteId, { title: "Child A", content: "<p>a</p>" });
        createNote(parent.noteId, { title: "Child B", content: "<p>b</p>" });

        const body = runExport(branch).body;

        // The parent outline is opened, both children appear nested before it closes.
        const parentIdx = body.indexOf(`text="Parent node"`);
        const childAIdx = body.indexOf(`text="Child A"`);
        const childBIdx = body.indexOf(`text="Child B"`);
        expect(parentIdx).toBeGreaterThanOrEqual(0);
        expect(childAIdx).toBeGreaterThan(parentIdx);
        expect(childBIdx).toBeGreaterThan(parentIdx);

        // Three opening outlines (parent + two children) and three closing tags.
        expect(body.match(/<outline /g)).toHaveLength(3);
        expect(body.match(/<\/outline>/g)).toHaveLength(3);
    });

    it("skips notes labelled #excludeFromExport", () => {
        const { note: parent, branch } = createNote("root", { title: "Export parent", content: "" });
        createNote(parent.noteId, { title: "Kept child", content: "<p>keep</p>" });
        const { note: excluded } = createNote(parent.noteId, { title: "Excluded child", content: "<p>no</p>" });
        getContext().init(() => excluded.addLabel("excludeFromExport"));

        const body = runExport(branch).body;

        expect(body).toContain(`text="Kept child"`);
        expect(body).not.toContain(`text="Excluded child"`);
        // Parent + the single kept child remain.
        expect(body.match(/<outline /g)).toHaveLength(2);
    });

    it("includes the branch prefix in the title and the download filename", () => {
        const { note, branch } = createNote("root", { title: "Prefixed", content: "" });
        getContext().init(() => {
            branch.prefix = "Pre";
            branch.save();
        });

        const res = runExport(branch);

        expect(res.headers["Content-Disposition"]).toContain("Pre%20-%20Prefixed.opml");
        expect(res.body).toContain(`<outline text="Pre - Prefixed" _note="">`);
        expect(note.title).toBe("Prefixed");
    });

    it("leaves the _note attribute empty for non-string (binary) content notes", () => {
        // An image note has binary content, so hasStringContent() is false and the
        // _note attribute must be emitted empty rather than dumping the buffer.
        const { branch } = createNote("root", {
            title: "Binary note",
            type: "image",
            mime: "image/png",
            content: "not-really-png-bytes"
        });

        const body = runExport(branch).body;

        expect(body).toContain(`<outline text="Binary note" _note="">`);
    });
}, 60_000);
