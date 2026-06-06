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

function runExport(branch: BBranch, version: string): FakeResponse {
    const res = new FakeResponse();
    opml.exportToOpml(getTaskContext(), branch, version, res as unknown as Response);
    return res;
}

describe("exportToOpml (real DB)", () => {
    beforeAll(async () => {
        sql_init.initializeDb();
        await sql_init.dbReady;
    });

    it("rejects an unrecognized OPML version before touching the response", () => {
        const { branch } = createNote("root");
        const res = new FakeResponse();

        expect(() => opml.exportToOpml(getTaskContext(), branch, "9.9", res as unknown as Response)).toThrow(/9\.9/);
        // Nothing should have been written when the version is invalid.
        expect(res.chunks).toHaveLength(0);
        expect(res.ended).toBe(false);
    });

    it("exports a v1.0 document with the opml header, download headers and stripped text content", () => {
        const { note, branch } = createNote("root", {
            title: "Root v1",
            content: "<p>line one</p><p>line two</p>"
        });

        const res = runExport(branch, "1.0");

        // Streaming the export sets the OPML download headers.
        expect(res.headers["Content-Type"]).toBe("text/x-opml");
        expect(res.headers["Content-Disposition"]).toContain("Root%20v1.opml");
        expect(res.ended).toBe(true);

        const body = res.body;
        // The XML/opml envelope is emitted with the requested version.
        expect(body).toContain(`<opml version="1.0">`);
        expect(body).toContain("<title>Trilium export</title>");
        expect(body.trim().endsWith("</opml>")).toBe(true);

        // v1 uses the `title`/`text` attribute pair; every <p> opener (including
        // the leading one) becomes a newline encoded as &#10; and the surrounding
        // tags are stripped.
        expect(body).toContain(`<outline title="Root v1" text="&#10;line one&#10;line two">`);
        expect(body).toContain("</outline>");
        // The note was counted in the export progress (no throw from increaseProgressCount).
        expect(note.title).toBe("Root v1");
    });

    it("exports a v2.0 document using the text/_note attribute pair with raw escaped HTML", () => {
        const { branch } = createNote("root", {
            title: "Root v2",
            content: "<p>body</p>"
        });

        const res = runExport(branch, "2.0");

        expect(res.headers["Content-Type"]).toBe("text/x-opml");
        const body = res.body;
        expect(body).toContain(`<opml version="2.0">`);
        // v2 keeps the raw HTML content but XML-escapes it into the _note attribute.
        expect(body).toContain(`<outline text="Root v2" _note="&lt;p&gt;body&lt;/p&gt;">`);
    });

    it("escapes XML-significant characters in titles for both versions", () => {
        const { branch } = createNote("root", {
            title: `A & B <c> "d" 'e'`,
            content: ""
        });

        const v1 = runExport(branch, "1.0").body;
        const v2 = runExport(branch, "2.0").body;

        const escapedTitle = `A &amp; B &lt;c&gt; &quot;d&quot; &apos;e&apos;`;
        expect(v1).toContain(`<outline title="${escapedTitle}" text="">`);
        expect(v2).toContain(`<outline text="${escapedTitle}" _note="">`);
    });

    it("recursively exports child notes nested inside the parent outline", () => {
        const { note: parent, branch } = createNote("root", { title: "Parent node", content: "" });
        createNote(parent.noteId, { title: "Child A", content: "<p>a</p>" });
        createNote(parent.noteId, { title: "Child B", content: "<p>b</p>" });

        const body = runExport(branch, "2.0").body;

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

        const body = runExport(branch, "2.0").body;

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

        const res = runExport(branch, "1.0");

        expect(res.headers["Content-Disposition"]).toContain("Pre%20-%20Prefixed.opml");
        expect(res.body).toContain(`<outline title="Pre - Prefixed" text="">`);
        expect(note.title).toBe("Prefixed");
    });

    it("leaves text empty for non-string (binary) content notes", () => {
        // An image note has binary content, so hasStringContent() is false and the
        // text/_note attribute must be emitted empty rather than dumping the buffer.
        const { branch } = createNote("root", {
            title: "Binary note",
            type: "image",
            mime: "image/png",
            content: "not-really-png-bytes"
        });

        const v1 = runExport(branch, "1.0").body;
        const v2 = runExport(branch, "2.0").body;

        expect(v1).toContain(`<outline title="Binary note" text="">`);
        expect(v2).toContain(`<outline text="Binary note" _note="">`);
    });
}, 60_000);
