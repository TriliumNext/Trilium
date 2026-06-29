import fs from "fs";
import { default as path, dirname } from "path";
import { fileURLToPath } from "url";
import { beforeAll, describe, expect, it, vi } from "vitest";

import becca from "../../becca/becca.js";
import type BNote from "../../becca/entities/bnote.js";
import { getContext } from "../context.js";
import sql_init from "../sql_init.js";
import TaskContext from "../task_context.js";
import { decodeUtf8 } from "../utils/binary.js";
import imageService from "../image.js";
import enex from "./enex.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));

async function testImport(fileName: string) {
    const sample = fs.readFileSync(path.join(scriptDir, "samples", fileName));
    const taskContext = TaskContext.getInstance("import-enex", "importNotes", {});

    return new Promise<{ importedNote: BNote; rootNote: BNote; taskContext: TaskContext<"importNotes"> }>((resolve, reject) => {
        getContext().init(async () => {
            const rootNote = becca.getNote("root");
            if (!rootNote) {
                expect(rootNote).toBeTruthy();
                return;
            }

            const importedNote = await enex.importEnex(taskContext, {
                originalname: fileName,
                mimetype: "application/enex+xml",
                buffer: sample
            }, rootNote as BNote);
            resolve({
                importedNote,
                rootNote,
                taskContext
            });
        });
    });
}

describe("importEnex", () => {
    beforeAll(async () => {
        sql_init.initializeDb();
        await sql_init.dbReady;
    });

    it("imports non-image resources as attachments instead of child notes", async () => {
        const { importedNote } = await testImport("File with attachments.enex");

        // The root import note should contain the individual notes as children
        const test1 = importedNote.getChildNotes().find(n => n.title === "TEST1");
        expect(test1).toBeTruthy();

        // Non-image resources should be attachments, not child notes
        const childNotes = test1!.getChildNotes();
        expect(childNotes).toHaveLength(0);

        // Should have two file attachments
        const attachments = test1!.getAttachmentsByRole("file");
        expect(attachments).toHaveLength(2);

        const txt = attachments.find(a => a.title === "attachments1.txt");
        expect(txt).toBeTruthy();
        expect(txt!.mime).toBe("text/plain");
        expect(decodeUtf8(txt!.getContent())).toBe("111");

        const bin = attachments.find(a => a.title === "attachments2");
        expect(bin).toBeTruthy();
        expect(bin!.mime).toBe("application/octet-stream");
        expect(decodeUtf8(bin!.getContent())).toBe("222");

        // The note content should contain reference links to the attachments
        const content = decodeUtf8(test1!.getContent());
        expect(content).toContain(`class="reference-link" href="#root/${test1!.noteId}?viewMode=attachments&amp;attachmentId=${txt!.attachmentId}"`);
        expect(content).toContain(`class="reference-link" href="#root/${test1!.noteId}?viewMode=attachments&amp;attachmentId=${bin!.attachmentId}"`);
    });

    it("imports notes without attachments normally", async () => {
        const { importedNote } = await testImport("File with attachments.enex");

        const test2 = importedNote.getChildNotes().find(n => n.title === "TEST2");
        expect(test2).toBeTruthy();
        expect(test2!.getChildNotes()).toHaveLength(0);
        expect(test2!.getAttachmentsByRole("file")).toHaveLength(0);

        const test3 = importedNote.getChildNotes().find(n => n.title === "TEST3");
        expect(test3).toBeTruthy();
        expect(test3!.getChildNotes()).toHaveLength(0);
        expect(test3!.getAttachmentsByRole("file")).toHaveLength(0);
    });

    it("reports the note count as the task total so the client shows a progress bar", async () => {
        // setTotalCount drives the denominator of the progress bar; spy on the prototype before importing
        // since the call happens inside importEnex. It should match the number of imported notes.
        const setTotalCount = vi.spyOn(TaskContext.prototype, "setTotalCount");
        try {
            const { importedNote } = await testImport("File with attachments.enex");

            const noteCount = importedNote.getChildNotes().length;
            expect(noteCount).toBeGreaterThan(0);
            expect(setTotalCount).toHaveBeenCalledWith(noteCount);
        } finally {
            setTotalCount.mockRestore();
        }
    });

    it("converts Evernote's rich blocks (code, math, mermaid, tasks, callouts, toggles, checkboxes)", async () => {
        const { importedNote } = await testImport("Formatting.enex");

        const note = importedNote.getChildNotes().find(n => n.title === "Formatting");
        if (!note) {
            throw new Error("'Formatting' note was not imported");
        }
        const content = decodeUtf8(note.getContent());

        // Code block, with the syntax language preserved as a CKEditor mime class.
        expect(content).toContain(`<pre><code class="language-text-x-csrc">`);
        expect(content).toContain("void main() {");

        // Math equation (formula block) → CKEditor display-math span.
        expect(content).toContain(`<span class="math-tex">\\[e=mc^2\\]</span>`);

        // Inline mermaid → language-mermaid code block.
        expect(content).toContain(`<pre><code class="language-mermaid">`);
        expect(content).toContain("graph TD");

        // Tasks → a to-do list (both tasks are "open", so unchecked; titles trimmed).
        expect(content).toContain(`<span class="todo-list__label__description">Task</span>`);
        expect(content).toContain(`<span class="todo-list__label__description">Another task</span>`);
        // The "Content not supported" task placeholder must not survive.
        expect(content).not.toContain("Content not supported");

        // Callouts → admonitions: the default light-bulb maps to "tip", a custom emoji to "note" (emoji kept).
        expect(content).toContain(`<aside class="admonition tip">`);
        expect(content).toContain(`<aside class="admonition note">`);
        expect(content).toContain("🤖");

        // Toggle → Trilium collapsible.
        expect(content).toContain(`<details class="trilium-collapsible">`);
        expect(content).toContain("Toggle goes here");

        // Checkboxes → a nested to-do list with proper checked state.
        expect(content).toContain(`<ul class="todo-list">`);
        expect(content).toContain(`<span class="todo-list__label__description">Checkbox</span>`);
        expect(content).toContain(`<span class="todo-list__label__description">Sub</span>`);
        expect(content).toContain(`checked="checked"`);
        expect(content).toContain(`<span class="todo-list__label__description">Checked</span>`);

        // The Evernote `--en-*` style markers must not leak into the imported note.
        expect(content).not.toContain("--en-");
    });

    it("converts Evernote internal note links into Trilium reference links, leaving external links intact", async () => {
        const { importedNote } = await testImport("Internal links.enex");

        const first = importedNote.getChildNotes().find(n => n.title === "First Note");
        const second = importedNote.getChildNotes().find(n => n.title === "Second Note");
        if (!first || !second) {
            throw new Error("cross-linked notes were not imported");
        }

        const firstContent = decodeUtf8(first.getContent());
        // The internal link is resolved (by the inline-richlink's text = target title) to a reference link.
        expect(firstContent).toContain(`href="#root/${second.noteId}"`);
        expect(firstContent).toContain(`class="reference-link"`);
        expect(firstContent).not.toContain("evernote://");
        // The external link is left untouched.
        expect(firstContent).toContain(`href="http://triliumnotes.org"`);

        // The reverse link resolves too.
        const secondContent = decodeUtf8(second.getContent());
        expect(secondContent).toContain(`href="#root/${first.noteId}"`);

        // An internalLink relation is created so backlinks/the link map work.
        expect(first.getRelations("internalLink").some(r => r.value === second.noteId)).toBe(true);
    });

    it("leaves a link to a duplicated title unresolved (avoids guessing the wrong same-named note)", async () => {
        const { importedNote } = await testImport("Duplicate titles.enex");

        const linker = importedNote.getChildNotes().find(n => n.title === "Linker");
        const target = importedNote.getChildNotes().find(n => n.title === "Target");
        if (!linker || !target) {
            throw new Error("duplicate-title sample notes were not imported");
        }
        const content = decodeUtf8(linker.getContent());

        // "Dup" is shared by two imported notes, so the link is ambiguous and kept as the original link.
        expect(content).toContain(`href="evernote://view-note/dddddddd-dddd-dddd-dddd-dddddddddddd"`);
        // A uniquely-titled target still resolves to a reference link.
        expect(content).toContain(`href="#root/${target.noteId}"`);

        // No internalLink relation is created toward either ambiguous "Dup" note.
        const dupIds = importedNote.getChildNotes().filter(n => n.title === "Dup").map(n => n.noteId);
        expect(linker.getRelations("internalLink").some(r => dupIds.includes(r.value))).toBe(false);
    });

    it("resolves an internal link to a note whose title has surrounding whitespace", async () => {
        const { importedNote } = await testImport("Internal links whitespace.enex");

        const linker = importedNote.getChildNotes().find(n => n.title === "Linker");
        // The target's exported title is padded (" Padded Note "); match it trim-insensitively.
        const padded = importedNote.getChildNotes().find(n => n.title.trim() === "Padded Note");
        if (!linker || !padded) {
            throw new Error("whitespace-title sample notes were not imported");
        }
        const content = decodeUtf8(linker.getContent());

        // The link text ("Padded Note") is matched against the padded title after trimming both sides,
        // so it still resolves to a reference link rather than being left as the raw evernote:// link.
        expect(content).toContain(`href="#root/${padded.noteId}"`);
        expect(content).toContain(`class="reference-link"`);
        expect(content).not.toContain("evernote://");
        // The backlink relation is created too.
        expect(linker.getRelations("internalLink").some(r => r.value === padded.noteId)).toBe(true);
    });

    it("imports note metadata (source-url, tags) as labels and appends an unreferenced image resource", async () => {
        const { importedNote } = await testImport("Note metadata.enex");

        const note = importedNote.getChildNotes().find(n => n.title === "Metadata Note");
        if (!note) {
            throw new Error("'Metadata Note' note was not imported");
        }

        // A note-attributes source-url becomes a "pageUrl" label; each tag becomes an empty label.
        expect(note.getLabelValue("pageUrl")).toBe("https://triliumnotes.org/page");
        expect(note.getOwnedAttributes("label").map(a => a.name)).toEqual(expect.arrayContaining(["pageUrl", "important", "archive"]));

        // The image resource isn't referenced by an <en-media> in the body, so it's appended as an attachment
        // rather than dropped; the empty (data-less) resource is skipped without failing the import.
        const content = decodeUtf8(note.getContent());
        expect(content).toContain("<img");
        // The data-less "empty.bin" resource contributes no attachment.
        expect(note.getAttachmentsByRole("file").some(a => a.title === "empty.bin")).toBe(false);
    });

    it("falls back to a file attachment when saving an image resource throws", async () => {
        // If image processing fails (e.g. a corrupt image), the resource is preserved as a plain file
        // attachment rather than being lost.
        const saveImage = vi.spyOn(imageService, "saveImageToAttachment").mockImplementation(() => {
            throw new Error("simulated image processing failure");
        });
        try {
            const { importedNote } = await testImport("Note metadata.enex");
            const note = importedNote.getChildNotes().find(n => n.title === "Metadata Note");
            if (!note) {
                throw new Error("'Metadata Note' note was not imported");
            }
            // The image couldn't be saved as an image, so it lands as a role:"file" attachment instead.
            expect(note.getAttachmentsByRole("file").map(a => a.title)).toContain("orphan.png");
        } finally {
            saveImage.mockRestore();
        }
    });

    it("converts legacy <en-todo> checkboxes into a real todo-list, not literal ballot boxes", async () => {
        const { importedNote } = await testImport("Legacy checkboxes.enex");

        const note = importedNote.getChildNotes().find(n => n.title === "Ideas");
        if (!note) {
            throw new Error("'Ideas' note was not imported");
        }
        const content = decodeUtf8(note.getContent());

        // Rendered as an actual CKEditor todo-list, not the old literal ☐/☑ characters.
        expect(content).toContain(`<ul class="todo-list">`);
        expect(content).not.toContain("☐");
        expect(content).not.toContain("☑");

        expect(content).toContain(`<span class="todo-list__label__description">Write tests</span>`);
        expect(content).toContain(`<span class="todo-list__label__description">Ship <i>it</i></span>`);
        expect(content).toContain(`<span class="todo-list__label__description">Investigate bug</span>`);
        // The checked item ("Investigate bug") carries the checked state.
        expect(content).toContain(`checked="checked"`);
    });
}, 60_000);
