import { afterAll, beforeAll, describe, expect, it } from "vitest";

import becca from "../becca/becca.js";
import type BBranch from "../becca/entities/bbranch.js";
import type BNote from "../becca/entities/bnote.js";
import { getContext } from "./context.js";
import noteService, { prepareTitle, saveLinks } from "./notes.js";
import optionService from "./options.js";
import { getSql } from "./sql/index.js";

/**
 * The pure link-extraction helpers (findBookmarks, findLlmChatLinks) and the
 * becca-mocked checkImageAttachments path are already covered by
 * apps/server/src/services/notes.spec.ts. This file exercises the real-DB
 * write paths (note creation, update, duplication) which that spec stubs out.
 */

let counter = 0;

/**
 * Creates a fresh text note under the given parent in the real in-memory DB.
 * Each call uses a unique title since the same fixture DB is shared between
 * the `it()`s in this file.
 */
function createNote(parentNoteId: string, overrides: Partial<Parameters<typeof noteService.createNewNote>[0]> = {}): {
    note: BNote;
    branch: BBranch;
} {
    counter++;
    return getContext().init(() =>
        noteService.createNewNote({
            parentNoteId,
            title: `notes-spec-${counter}`,
            content: "<p>hello</p>",
            type: "text",
            ...overrides
        })
    );
}

describe("notes service (real DB)", () => {
    beforeAll(() => {
        // The in-memory fixture DB and initializeCore are booted by the
        // server suite setup (apps/server/spec/setup.ts), through which
        // co-located trilium-core specs run.
    });

    describe("createNewNote", () => {
        it("creates a text note under root with content, branch and derived mime", () => {
            const { note, branch } = createNote("root", { title: "spec-create-basic", content: "<p>body</p>" });

            expect(becca.notes[note.noteId]).toBe(note);
            expect(note.title).toBe("spec-create-basic");
            expect(note.type).toBe("text");
            expect(note.mime).toBe("text/html");
            expect(note.getContent()).toBe("<p>body</p>");

            expect(branch.parentNoteId).toBe("root");
            expect(branch.noteId).toBe(note.noteId);
            // position derives from MAX existing position + 10 and is therefore positive.
            expect(branch.notePosition).toBeGreaterThan(0);

            // The note row is persisted in the DB, not just becca.
            const row = getSql().getRow<{ title: string }>("SELECT title FROM notes WHERE noteId = ?", [note.noteId]);
            expect(row.title).toBe("spec-create-basic");
        });

        it("honours an explicit notePosition and creates atomic attributes", () => {
            const { note, branch } = createNote("root", {
                title: "spec-create-attrs",
                content: "",
                notePosition: 1234,
                attributes: [
                    { type: "label", name: "myLabel", value: "v1", isInheritable: false, position: 10 },
                    { type: "label", name: "secondLabel", value: "v2", isInheritable: false, position: 20 }
                ]
            });

            expect(branch.notePosition).toBe(1234);
            expect(note.getLabelValue("myLabel")).toBe("v1");
            expect(note.getLabelValue("secondLabel")).toBe("v2");
        });

        it("throws when the parent note does not exist", () => {
            expect(() => createNote("noSuchParent00", { title: "spec-bad-parent" })).toThrow(
                /Parent note 'noSuchParent00' was not found/
            );
        });

        it("throws when the content is null/undefined", () => {
            expect(() =>
                getContext().init(() =>
                    noteService.createNewNote({
                        parentNoteId: "root",
                        title: "spec-null-content",
                        // deliberately invalid content to hit the guard
                        content: null as unknown as string,
                        type: "text"
                    })
                )
            ).toThrow(/Note content must be set/);
        });

        it("refuses to create notes under a forbidden parent like _hidden", () => {
            expect(() => createNote("_hidden", { title: "spec-hidden-child" })).toThrow(
                /Creating child notes into '_hidden' is not allowed/
            );
        });

        it("inherits the template's mime and adds a template relation when creating from a template", () => {
            const template = createNote("root", { title: "spec-template", content: "<p>tmpl</p>" });
            // Give the template a non-default mime so we can verify inheritance.
            getContext().init(() => {
                template.note.mime = "text/special";
                template.note.save();
            });

            const { note } = createNote("root", {
                title: "spec-from-template",
                content: "<p>child</p>",
                templateNoteId: template.note.noteId
            });

            expect(note.mime).toBe("text/special");
            expect(note.getRelationValue("template")).toBe(template.note.noteId);
        });
    });

    describe("createNewNoteWithTarget", () => {
        it("defaults the type from the parent and creates the note for 'into'", () => {
            const parent = createNote("root", { title: "spec-into-parent" });

            const { note, branch } = getContext().init(() =>
                noteService.createNewNoteWithTarget("into", undefined, {
                    parentNoteId: parent.note.noteId,
                    title: "spec-into-child",
                    content: "<p>x</p>",
                    // type intentionally left unset so it is derived from the parent
                    type: undefined as unknown as "text"
                })
            );

            expect(note.type).toBe("text");
            expect(branch.parentNoteId).toBe(parent.note.noteId);
        });

        it("positions a note after an existing sibling branch", () => {
            const parent = createNote("root", { title: "spec-after-parent" });
            const first = createNote(parent.note.noteId, { title: "spec-after-first" });

            const { branch } = getContext().init(() =>
                noteService.createNewNoteWithTarget("after", first.branch.branchId, {
                    parentNoteId: parent.note.noteId,
                    title: "spec-after-second",
                    content: "<p>x</p>",
                    type: "text"
                })
            );

            expect(branch.notePosition).toBe(first.branch.notePosition + 10);
        });

        it("throws on an unknown target", () => {
            expect(() =>
                getContext().init(() =>
                    noteService.createNewNoteWithTarget("sideways" as "into", undefined, {
                        parentNoteId: "root",
                        title: "spec-bad-target",
                        content: "",
                        type: "text"
                    })
                )
            ).toThrow(/Unknown target/);
        });
    });

    describe("saveLinks", () => {
        it("creates internal-link relations to existing target notes and strips absolute hrefs", () => {
            const target = createNote("root", { title: "spec-link-target" });
            const source = createNote("root", { title: "spec-link-source" });

            const content = `<p>link <a href="http://example.com/#root/${target.note.noteId}">here</a></p>`;

            const { content: newContent } = getContext().init(() => saveLinks(source.note, content));

            // Absolute href is rewritten to a relative #root reference.
            expect(newContent).toContain(`href="#root/${target.note.noteId}"`);
            expect(newContent).not.toContain("http://example.com");

            const relation = source.note.getRelations().find((r) => r.name === "internalLink");
            expect(relation).toBeDefined();
            expect(relation!.value).toBe(target.note.noteId);
        });

        it("removes link relations that are no longer present in the content", () => {
            const target = createNote("root", { title: "spec-unused-target" });
            const source = createNote("root", { title: "spec-unused-source" });

            // First, create the link.
            getContext().init(() => saveLinks(source.note, `<a href="#root/${target.note.noteId}">x</a>`));
            expect(source.note.getRelations().some((r) => r.name === "internalLink")).toBe(true);

            // Then save content without the link; the relation should be marked deleted.
            getContext().init(() => saveLinks(source.note, "<p>no links anymore</p>"));
            expect(source.note.getRelations().some((r) => r.name === "internalLink" && !r.isDeleted)).toBe(false);
        });

        it("is a no-op for note types it does not scan", () => {
            const code = createNote("root", {
                title: "spec-code",
                content: "let x = 1;",
                type: "code",
                mime: "application/javascript"
            });

            const content = `<a href="#root/root">x</a>`;
            const res = getContext().init(() => saveLinks(code.note, content));

            expect(res).toEqual({ forceFrontendReload: false, content });
            expect(code.note.getRelations().some((r) => r.name === "internalLink")).toBe(false);
        });

        it("extracts an inline base64 attachment, deriving its title via prepareTitle", () => {
            const source = createNote("root", { title: "spec-inline-attachment" });

            // A 1x1 PNG embedded inline, with an HTML-entity-encoded link label.
            const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
            const content = `<p><a href="data:image/png;base64,${pngBase64}">my &amp; file.png</a></p>`;

            const { content: newContent } = getContext().init(() => saveLinks(source.note, content));

            const attachments = source.note.getAttachments().filter((a) => a.role === "file");
            expect(attachments).toHaveLength(1);
            // prepareTitle stripped the tag context and decoded the &amp; entity for the title.
            expect(attachments[0].title).toBe("my & file.png");
            expect(attachments[0].mime).toBe("image/png");

            // The inline data URL is replaced by a reference-link to the new attachment.
            expect(newContent).toContain(`attachmentId=${attachments[0].attachmentId}`);
            expect(newContent).not.toContain("data:image/png;base64");
        });
    });

    describe("updateNoteData", () => {
        it("persists new content and extracts link relations", () => {
            const target = createNote("root", { title: "spec-update-target" });
            const note = createNote("root", { title: "spec-update", content: "<p>old</p>" }).note;

            const content = `<p>new <a href="#root/${target.note.noteId}">link</a></p>`;
            getContext().init(() => noteService.updateNoteData(note.noteId, content));

            expect(note.getContent()).toContain("new");
            expect(
                note.getRelations().some((r) => r.name === "internalLink" && r.value === target.note.noteId)
            ).toBe(true);
        });

        it("throws when the note is not available", () => {
            expect(() => getContext().init(() => noteService.updateNoteData("doesNotExist99", "<p>x</p>"))).toThrow(
                /not available for change/
            );
        });
    });

    describe("duplicateSubtree", () => {
        it("duplicates a note and its descendants, remapping internal relations and appending a suffix", () => {
            const root = createNote("root", { title: "spec-dup-root" });
            const child = createNote(root.note.noteId, { title: "spec-dup-child" });

            // Add a relation from the parent to its own child so we can verify remapping.
            getContext().init(() => root.note.setRelation("myRel", child.note.noteId));

            const { note: dupNote } = getContext().init(() => noteService.duplicateSubtree(root.note.noteId, "root"));

            // A brand new note id is allocated.
            expect(dupNote.noteId).not.toBe(root.note.noteId);
            // The duplicate gets the "(dup)" suffix in its title.
            expect(dupNote.title).not.toBe(root.note.title);

            // The internal relation now points at the duplicated child, not the original.
            const dupChildren = dupNote.getChildNotes();
            expect(dupChildren).toHaveLength(1);
            expect(dupNote.getRelationValue("myRel")).toBe(dupChildren[0].noteId);
            expect(dupChildren[0].noteId).not.toBe(child.note.noteId);
        });

        it("refuses to duplicate the root note", () => {
            expect(() => getContext().init(() => noteService.duplicateSubtree("root", "root"))).toThrow(
                /Duplicating root is not possible/
            );
        });
    });

    describe("saveRevisionIfNeeded", () => {
        // saveRevisionIfNeeded only creates a revision once the note is at least
        // `revisionSnapshotTimeInterval` seconds old (default 600s). A freshly
        // created note is ~0s old, so with the default interval the revision
        // branch is unreachable and the `disableVersioning` guard would never be
        // exercised. Force the interval to 0 so the branch becomes reachable, and
        // restore the original value afterwards so sibling tests are unaffected.
        let originalInterval: string;

        beforeAll(() => {
            originalInterval = optionService.getOption("revisionSnapshotTimeInterval");
            getContext().init(() => optionService.setOption("revisionSnapshotTimeInterval", "0"));
        });

        afterAll(() => {
            getContext().init(() => optionService.setOption("revisionSnapshotTimeInterval", originalInterval));
        });

        function revisionCount(note: BNote): number {
            return getSql().getValue<number>("SELECT COUNT(*) FROM revisions WHERE noteId = ?", [note.noteId]);
        }

        it("creates a revision for an eligible note without disableVersioning", () => {
            const note = createNote("root", {
                title: "spec-revision-eligible",
                content: "<p>x</p>"
            }).note;

            const before = revisionCount(note);
            getContext().init(() => noteService.saveRevisionIfNeeded(note));
            const after = revisionCount(note);

            expect(after).toBe(before + 1);
        });

        it("does nothing for notes with disableVersioning", () => {
            const note = createNote("root", {
                title: "spec-no-revision",
                content: "<p>x</p>",
                attributes: [
                    { type: "label", name: "disableVersioning", value: "", isInheritable: false, position: 10 }
                ]
            }).note;

            const before = revisionCount(note);
            getContext().init(() => noteService.saveRevisionIfNeeded(note));
            const after = revisionCount(note);

            expect(after).toBe(before);
        });
    });
});

/**
 * Characterization of the attachment-title derivation used by saveAttachments
 * (the inner label of an inline base64 `<a>` link → a plain-text title). Locks
 * the behavior so the underlying HTML-to-text implementation can be swapped
 * without regressing real-world inputs (filenames, entities, inline markup).
 */
describe("prepareTitle", () => {
    it("decodes HTML entities (named, decimal, hex)", () => {
        expect(prepareTitle("a &amp; b.txt")).toBe("a & b.txt");
        expect(prepareTitle("caf&eacute;.pdf")).toBe("café.pdf");
        expect(prepareTitle("&copy; report.docx")).toBe("© report.docx");
        expect(prepareTitle("price &lt; 100 &gt; 50.csv")).toBe("price < 100 > 50.csv");
        expect(prepareTitle("emoji &#x1F600; file.png")).toBe("emoji 😀 file.png");
    });

    it("strips inline tags, keeping their text", () => {
        expect(prepareTitle("<b>bold</b> name.jpg")).toBe("bold name.jpg");
        expect(prepareTitle('<span class="x">nested <i>tags</i></span>.svg')).toBe("nested tags.svg");
    });

    it("collapses runs of whitespace and trims", () => {
        expect(prepareTitle("spaced    out    name.dat")).toBe("spaced out name.dat");
        expect(prepareTitle("tab\tand\nnewline.bin")).toBe("tab and newline.bin");
        expect(prepareTitle("  leading & trailing  ")).toBe("leading & trailing");
    });

    it("passes plain filenames through unchanged and handles empty input", () => {
        expect(prepareTitle("document.pdf")).toBe("document.pdf");
        expect(prepareTitle("My File (1).png")).toBe("My File (1).png");
        expect(prepareTitle("")).toBe("");
    });
});
