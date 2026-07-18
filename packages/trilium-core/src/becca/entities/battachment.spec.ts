import { afterEach, describe, expect, it, vi } from "vitest";

import type { AttachmentRow } from "@triliumnext/commons";

import { getContext } from "../../services/context.js";
import noteService from "../../services/notes.js";
import protectedSessionService from "../../services/protected_session.js";
import { encodeUtf8, unwrapStringOrBuffer } from "../../services/utils/binary.js";
import becca from "../becca.js";
import BAttachment from "./battachment.js";
import type BNote from "./bnote.js";

let counter = 0;

/** Creates a fresh text note under root in the shared in-memory DB. */
function createNote(opts: { isProtected?: boolean; content?: string } = {}): BNote {
    counter++;
    return getContext().init(() => {
        const { note } = noteService.createNewNote({
            parentNoteId: "root",
            title: `battachment-spec-${counter}`,
            content: opts.content ?? "<p>hello</p>",
            type: "text"
        });
        if (opts.isProtected) {
            note.isProtected = true;
        }
        return note;
    });
}

// exactly 16 bytes
const PROTECTED_KEY = encodeUtf8("0123456789abcdef");

/** A valid attachment row, with individual fields removable for validation tests. */
function baseRow(overrides: Partial<AttachmentRow> = {}): AttachmentRow {
    return {
        ownerId: "someOwner",
        role: "file",
        mime: "text/plain",
        title: "t",
        ...overrides
    } as AttachmentRow;
}

describe("BAttachment (real DB)", () => {
    afterEach(() => {
        protectedSessionService.resetDataKey();
        vi.restoreAllMocks();
    });

    describe("updateFromRow validation", () => {
        it("throws when ownerId is missing or blank", () => {
            expect(() => new BAttachment(baseRow({ ownerId: "" }))).toThrow(/ownerId/);
            expect(() => new BAttachment(baseRow({ ownerId: "   " }))).toThrow(/ownerId/);
        });

        it("throws when role is missing or blank", () => {
            expect(() => new BAttachment(baseRow({ role: "" }))).toThrow(/role/);
            expect(() => new BAttachment(baseRow({ role: "  " }))).toThrow(/role/);
        });

        it("throws when mime is missing or blank", () => {
            expect(() => new BAttachment(baseRow({ mime: "" }))).toThrow(/mime/);
            expect(() => new BAttachment(baseRow({ mime: "  " }))).toThrow(/mime/);
        });

        it("throws when title is missing or blank", () => {
            expect(() => new BAttachment(baseRow({ title: "" }))).toThrow(/title/);
            expect(() => new BAttachment(baseRow({ title: "  " }))).toThrow(/title/);
        });

        it("constructs successfully with all required fields and assigns them", () => {
            const att = new BAttachment(baseRow({ position: 30, isProtected: false }));
            expect(att.ownerId).toBe("someOwner");
            expect(att.role).toBe("file");
            expect(att.mime).toBe("text/plain");
            expect(att.title).toBe("t");
            expect(att.position).toBe(30);
            expect(att.isProtected).toBe(false);
            // New (unsaved) attachment is immediately treated as decrypted.
            expect(att.isDecrypted).toBe(true);
        });
    });

    describe("copy / getNote / hasStringContent / getFileName", () => {
        it("copy produces an independent attachment with the same descriptive fields", () => {
            const note = createNote();
            const att = getContext().init(() =>
                note.saveAttachment({ role: "file", mime: "text/plain", title: "orig", content: "hi" })
            );

            const clone = att.copy();
            expect(clone).not.toBe(att);
            expect(clone.ownerId).toBe(att.ownerId);
            expect(clone.role).toBe("file");
            expect(clone.mime).toBe("text/plain");
            expect(clone.title).toBe("orig");
            // The clone is a brand-new entity without its own id yet.
            expect(clone.attachmentId).toBeUndefined();
        });

        it("getNote resolves the owning note through becca", () => {
            const note = createNote();
            const att = getContext().init(() =>
                note.saveAttachment({ role: "file", mime: "text/plain", title: "gn", content: "x" })
            );

            expect(att.getNote()).toBe(note);
        });

        it("hasStringContent reflects the mime via isStringNote", () => {
            const stringAtt = new BAttachment(baseRow({ mime: "text/plain", title: "s" }));
            const binaryAtt = new BAttachment(baseRow({ mime: "image/png", role: "image", title: "b" }));
            // InkML is UTF-8 XML, so it must be served as string content for the attachment preview to work.
            const inkmlAtt = new BAttachment(baseRow({ mime: "application/inkml+xml", role: "importSource", title: "ink" }));

            expect(stringAtt.hasStringContent()).toBe(true);
            expect(binaryAtt.hasStringContent()).toBe(false);
            expect(inkmlAtt.hasStringContent()).toBe(true);
        });

        it("getFileName uses 'image' for image role and 'file' otherwise", () => {
            const fileAtt = new BAttachment(baseRow({ role: "file", mime: "text/plain", title: "doc" }));
            const imageAtt = new BAttachment(baseRow({ role: "image", mime: "image/png", title: "pic" }));

            expect(typeof fileAtt.getFileName()).toBe("string");
            expect(typeof imageAtt.getFileName()).toBe("string");
        });
    });

    describe("content round-trip", () => {
        it("setContent then getContent round-trips through the blob store", () => {
            const note = createNote();
            const att = getContext().init(() =>
                note.saveAttachment({ role: "file", mime: "text/plain", title: "rt", content: "" })
            );

            getContext().init(() => att.setContent("payload-" + counter, { forceSave: true }));

            expect(unwrapStringOrBuffer(att.getContent())).toBe("payload-" + counter);
        });
    });

    describe("isContentAvailable / getTitleOrProtected / decrypt", () => {
        it("a non-protected attachment is always content-available and exposes its title", () => {
            const note = createNote();
            const att = getContext().init(() =>
                note.saveAttachment({ role: "file", mime: "text/plain", title: "plain", content: "x" })
            );

            expect(att.isContentAvailable()).toBe(true);
            expect(att.getTitleOrProtected()).toBe("plain");
        });

        it("a protected attachment hides its title once the session is dropped", () => {
            protectedSessionService.setDataKey(PROTECTED_KEY);
            const note = createNote({ isProtected: true });
            const att = getContext().init(() =>
                note.saveAttachment({
                    role: "file",
                    mime: "text/plain",
                    title: "secret-" + counter,
                    content: "x"
                })
            );
            const attachmentId = att.attachmentId;
            expect(attachmentId).toBeDefined();

            // While the session is available it stays readable.
            expect(att.isContentAvailable()).toBe(true);

            protectedSessionService.resetDataKey();

            // Reload from the DB so a protected, encrypted-from-row instance is produced.
            const reloaded = attachmentId ? becca.getAttachmentOrThrow(attachmentId) : att;
            expect(reloaded.isProtected).toBe(true);
            expect(reloaded.isContentAvailable()).toBe(false);
            expect(reloaded.getTitleOrProtected()).toBe("[protected]");
        });

        it("decrypt restores the plaintext title when the session is available on reload", () => {
            protectedSessionService.setDataKey(PROTECTED_KEY);
            const note = createNote({ isProtected: true });
            const plainTitle = "decrypt-me-" + counter;
            const att = getContext().init(() =>
                note.saveAttachment({
                    role: "file",
                    mime: "text/plain",
                    title: plainTitle,
                    content: "x"
                })
            );
            const attachmentId = att.attachmentId;
            expect(attachmentId).toBeDefined();

            // Reload with the session still available -> decrypt() runs the try branch.
            const reloaded = attachmentId ? becca.getAttachmentOrThrow(attachmentId) : att;
            expect(reloaded.isProtected).toBe(true);
            expect(reloaded.title).toBe(plainTitle);
            expect(reloaded.isDecrypted).toBe(true);
        });

        it("decrypt falls back to an empty title when decryptString yields a falsy value", () => {
            protectedSessionService.setDataKey(PROTECTED_KEY);
            const note = createNote({ isProtected: true });
            const att = getContext().init(() =>
                note.saveAttachment({
                    role: "file",
                    mime: "text/plain",
                    title: "empties-" + counter,
                    content: "x"
                })
            );
            const attachmentId = att.attachmentId;
            expect(attachmentId).toBeDefined();

            // decryptString returns null -> the `|| ""` fallback is exercised.
            vi.spyOn(protectedSessionService, "decryptString").mockReturnValue(null);

            const reloaded = attachmentId ? becca.getAttachmentOrThrow(attachmentId) : att;
            expect(reloaded.title).toBe("");
            expect(reloaded.isDecrypted).toBe(true);
        });

        it("decrypt swallows decryption errors and leaves the entity not-decrypted", () => {
            protectedSessionService.setDataKey(PROTECTED_KEY);
            const note = createNote({ isProtected: true });
            const att = getContext().init(() =>
                note.saveAttachment({
                    role: "file",
                    mime: "text/plain",
                    title: "boom-" + counter,
                    content: "x"
                })
            );
            const attachmentId = att.attachmentId;
            expect(attachmentId).toBeDefined();

            // Force the catch path of decrypt(): session is available but decryptString throws.
            vi.spyOn(protectedSessionService, "decryptString").mockImplementation(() => {
                throw new Error("kaput");
            });

            const reloaded = attachmentId ? becca.getAttachmentOrThrow(attachmentId) : att;
            expect(reloaded.isProtected).toBe(true);
            // The catch branch was taken: isDecrypted was never flipped to true.
            expect(reloaded.isDecrypted).toBeFalsy();
        });
    });

    describe("convertToNote", () => {
        it("throws for a 'search' type guard", () => {
            const att = new BAttachment(baseRow({ role: "file", mime: "text/plain", title: "srch" }));
            (att as unknown as { type: string }).type = "search";

            expect(() => getContext().init(() => att.convertToNote())).toThrow(/search/);
        });

        it("throws when the owning note cannot be found", () => {
            const att = new BAttachment(
                baseRow({ ownerId: "missingOwner123", role: "file", mime: "text/plain", title: "noOwner" })
            );

            expect(() => getContext().init(() => att.convertToNote())).toThrow(/Cannot find note/);
        });

        it("throws when the role has no note-type mapping", () => {
            const note = createNote();
            const att = getContext().init(() =>
                note.saveAttachment({ role: "file", mime: "text/plain", title: "badrole", content: "x" })
            );
            // Mutate to an unmapped role after construction.
            att.role = "unknownRole";

            expect(() => getContext().init(() => att.convertToNote())).toThrow(/Mapping from attachment role/);
        });

        it("throws when converting a protected attachment outside of a protected session", () => {
            protectedSessionService.setDataKey(PROTECTED_KEY);
            const note = createNote({ isProtected: true });
            const att = getContext().init(() =>
                note.saveAttachment({
                    role: "file",
                    mime: "text/plain",
                    title: "protConv-" + counter,
                    content: "x"
                })
            );
            const attachmentId = att.attachmentId;
            expect(attachmentId).toBeDefined();

            protectedSessionService.resetDataKey();
            const reloaded = attachmentId ? becca.getAttachmentOrThrow(attachmentId) : att;

            expect(() => getContext().init(() => reloaded.convertToNote())).toThrow(/protected session/);
        });

        it("converts a 'file' attachment into a note without rewriting parent content", () => {
            const parentContent = "<p>no image refs here</p>";
            const note = createNote({ content: parentContent });
            const att = getContext().init(() =>
                note.saveAttachment({
                    role: "file",
                    mime: "text/plain",
                    title: "fileconv-" + counter,
                    content: "file body"
                })
            );
            const attachmentId = att.attachmentId;
            expect(attachmentId).toBeDefined();

            const { note: created, branch } = getContext().init(() => att.convertToNote());

            expect(created.type).toBe("file");
            expect(created.title).toBe("fileconv-" + counter);
            expect(branch.parentNoteId).toBe(note.noteId);
            // The attachment row is now soft-deleted, so it is no longer retrievable.
            expect(attachmentId ? becca.getAttachment(attachmentId) : null).toBeFalsy();
            // Parent content is unchanged (no image-url rewrite for a 'file' role).
            expect(unwrapStringOrBuffer(note.getContent())).toBe(parentContent);
        });

        it("converts an 'image' attachment and rewrites the embedded attachment URL in the parent", () => {
            const note = createNote({ content: "<p>placeholder</p>" });
            const att = getContext().init(() =>
                note.saveAttachment({
                    role: "image",
                    mime: "image/png",
                    title: "imgconv-" + counter,
                    content: "binarydata"
                })
            );
            const attachmentId = att.attachmentId;
            expect(attachmentId).toBeDefined();

            // Embed a reference to the attachment image URL so replaceAll has something to change.
            const refContent = `<img src="api/attachments/${attachmentId}/image/foo.png">`;
            getContext().init(() => note.setContent(refContent));

            const { note: created } = getContext().init(() => att.convertToNote());

            expect(created.type).toBe("image");
            // The parent content's attachment URL has been rewritten to the new image note URL.
            const expected = `<img src="api/images/${created.noteId}/foo.png">`;
            expect(unwrapStringOrBuffer(note.getContent())).toBe(expected);
        });

        it("converts an 'image' attachment without touching content that has no matching URL", () => {
            const stableContent = "<p>nothing to rewrite</p>";
            const note = createNote({ content: stableContent });
            const att = getContext().init(() =>
                note.saveAttachment({
                    role: "image",
                    mime: "image/png",
                    title: "imgnochange-" + counter,
                    content: "binarydata"
                })
            );

            const { note: created } = getContext().init(() => att.convertToNote());

            expect(created.type).toBe("image");
            // No URL matched, so the parent content stays exactly as it was.
            expect(unwrapStringOrBuffer(note.getContent())).toBe(stableContent);
        });

        it("throws when an image parent has non-string content", () => {
            // Build a text parent but force its content to be non-string so the
            // type guard inside the image branch fires.
            const note = createNote({ content: "<p>x</p>" });
            const att = getContext().init(() =>
                note.saveAttachment({
                    role: "image",
                    mime: "image/png",
                    title: "nonstr-" + counter,
                    content: "binarydata"
                })
            );

            vi.spyOn(note, "getContent").mockReturnValue(new Uint8Array([1, 2, 3]));

            expect(() => getContext().init(() => att.convertToNote())).toThrow(/non-string content/);
        });

        it("rewrites a reference link to a converted 'file' attachment so it points at the new note", () => {
            const note = createNote({ content: "<p>placeholder</p>" });
            const att = getContext().init(() =>
                note.saveAttachment({ role: "file", mime: "text/plain", title: "doc-" + counter, content: "file body" })
            );
            const attachmentId = att.attachmentId;
            expect(attachmentId).toBeDefined();

            // CKEditor stores attachment reference links with the `&` HTML-encoded as `&amp;`.
            const refContent = `<p>see <a class="reference-link" href="#root/${note.noteId}?viewMode=attachments&amp;attachmentId=${attachmentId}">doc</a></p>`;
            getContext().init(() => note.setContent(refContent));

            const { note: created } = getContext().init(() => att.convertToNote());

            // The dangling attachment link is collapsed into a plain note link to the new note.
            const expected = `<p>see <a class="reference-link" href="#root/${created.noteId}">doc</a></p>`;
            expect(unwrapStringOrBuffer(note.getContent())).toBe(expected);

            // ...and the parent gains an internal-link relation to the new note (no longer a [missing attachment]).
            const internalLinks = note
                .getRelations()
                .filter((rel) => rel.name === "internalLink")
                .map((rel) => rel.value);
            expect(internalLinks).toContain(created.noteId);
        });

        it("rewrites a reference link that uses an unencoded '&' separator", () => {
            const note = createNote({ content: "<p>x</p>" });
            const att = getContext().init(() =>
                note.saveAttachment({ role: "file", mime: "text/plain", title: "raw-" + counter, content: "y" })
            );
            const attachmentId = att.attachmentId;

            const refContent = `<a href="#root/${note.noteId}?viewMode=attachments&attachmentId=${attachmentId}">raw</a>`;
            getContext().init(() => note.setContent(refContent));

            const { note: created } = getContext().init(() => att.convertToNote());

            expect(unwrapStringOrBuffer(note.getContent())).toBe(`<a href="#root/${created.noteId}">raw</a>`);
        });

        it("rewrites both the embedded image and a reference link when converting an 'image' attachment", () => {
            const note = createNote({ content: "<p>x</p>" });
            const att = getContext().init(() =>
                note.saveAttachment({ role: "image", mime: "image/png", title: "pic-" + counter, content: "binarydata" })
            );
            const attachmentId = att.attachmentId;
            expect(attachmentId).toBeDefined();

            const refContent =
                `<img src="api/attachments/${attachmentId}/image/pic.png">` +
                `<a class="reference-link" href="#root/${note.noteId}?viewMode=attachments&amp;attachmentId=${attachmentId}">pic</a>`;
            getContext().init(() => note.setContent(refContent));

            const { note: created } = getContext().init(() => att.convertToNote());

            const expected =
                `<img src="api/images/${created.noteId}/pic.png">` +
                `<a class="reference-link" href="#root/${created.noteId}">pic</a>`;
            expect(unwrapStringOrBuffer(note.getContent())).toBe(expected);
        });

        it("leaves reference links to other attachments untouched when converting one of them", () => {
            const note = createNote({ content: "<p>x</p>" });
            const target = getContext().init(() =>
                note.saveAttachment({ role: "file", mime: "text/plain", title: "target-" + counter, content: "a" })
            );
            const other = getContext().init(() =>
                note.saveAttachment({ role: "file", mime: "text/plain", title: "other-" + counter, content: "b" })
            );

            const otherHref = `#root/${note.noteId}?viewMode=attachments&amp;attachmentId=${other.attachmentId}`;
            const refContent =
                `<a href="#root/${note.noteId}?viewMode=attachments&amp;attachmentId=${target.attachmentId}">target</a>` +
                `<a href="${otherHref}">other</a>`;
            getContext().init(() => note.setContent(refContent));

            const { note: created } = getContext().init(() => target.convertToNote());

            // Only the converted attachment's link is rewritten; the other attachment's link is left intact.
            const expected = `<a href="#root/${created.noteId}">target</a>` + `<a href="${otherHref}">other</a>`;
            expect(unwrapStringOrBuffer(note.getContent())).toBe(expected);
        });
    });

    describe("getPojo / getPojoToSave", () => {
        it("getPojo exposes the descriptive fields and drops a blank title", () => {
            const att = new BAttachment(baseRow({ role: "file", mime: "text/plain", title: "pojo" }));
            const pojo = att.getPojo();

            expect(pojo.ownerId).toBe("someOwner");
            expect(pojo.role).toBe("file");
            expect(pojo.mime).toBe("text/plain");
            expect(pojo.title).toBe("pojo");
            expect(pojo.isDeleted).toBe(false);
        });

        it("getPojo maps a blank title to undefined", () => {
            const att = new BAttachment(baseRow({ role: "file", mime: "text/plain", title: "nonblank" }));
            // Blank the title after construction so getPojo's `title || undefined` falls through.
            att.title = "";

            expect(att.getPojo().title).toBeUndefined();
        });

        it("getPojoToSave strips contentLength and leaves the title for non-protected attachments", () => {
            const att = new BAttachment(baseRow({ role: "file", mime: "text/plain", title: "save" }));
            att.contentLength = 42;

            const pojo = att.getPojoToSave();
            expect("contentLength" in pojo).toBe(false);
            expect(pojo.title).toBe("save");
        });

        it("getPojoToSave encrypts the title for a decrypted protected attachment", () => {
            protectedSessionService.setDataKey(PROTECTED_KEY);
            const att = new BAttachment(
                baseRow({ role: "file", mime: "text/plain", title: "plaintext", isProtected: true })
            );
            // New attachment with no id is treated as decrypted.
            expect(att.isDecrypted).toBe(true);

            vi.spyOn(protectedSessionService, "encrypt").mockReturnValue("CIPHER");

            const pojo = att.getPojoToSave();
            expect(pojo.isProtected).toBe(true);
            expect(pojo.title).toBe("CIPHER");
        });

        it("getPojoToSave handles a blank title and a null encrypt result for a protected attachment", () => {
            protectedSessionService.setDataKey(PROTECTED_KEY);
            const att = new BAttachment(
                baseRow({ role: "file", mime: "text/plain", title: "nonblank", isProtected: true })
            );
            expect(att.isDecrypted).toBe(true);
            // Blank the title so `pojo.title || ""` falls through to "".
            att.title = "";

            // encrypt returns null so `encrypt(...) || undefined` falls through to undefined.
            const encryptSpy = vi.spyOn(protectedSessionService, "encrypt").mockReturnValue(null);

            const pojo = att.getPojoToSave();
            expect(pojo.isProtected).toBe(true);
            expect(pojo.title).toBeUndefined();
            expect(encryptSpy).toHaveBeenCalledWith("");
        });

        it("getPojoToSave drops the title for a protected attachment outside a session", () => {
            protectedSessionService.setDataKey(PROTECTED_KEY);
            const note = createNote({ isProtected: true });
            const att = getContext().init(() =>
                note.saveAttachment({
                    role: "file",
                    mime: "text/plain",
                    title: "keepcipher-" + counter,
                    content: "x"
                })
            );
            const attachmentId = att.attachmentId;
            expect(attachmentId).toBeDefined();

            protectedSessionService.resetDataKey();
            const reloaded = attachmentId ? becca.getAttachmentOrThrow(attachmentId) : att;
            // Loaded protected attachment outside a session is not decrypted.
            expect(reloaded.isDecrypted).toBeFalsy();

            const pojo = reloaded.getPojoToSave();
            expect(pojo.isProtected).toBe(true);
            // Title is omitted so the original ciphertext is preserved on save.
            expect("title" in pojo).toBe(false);
        });
    });
});
