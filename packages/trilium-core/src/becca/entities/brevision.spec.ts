import { afterEach, describe, expect, it } from "vitest";

import becca from "../becca.js";
import type BNote from "./bnote.js";
import BRevision from "./brevision.js";
import { getContext } from "../../services/context.js";
import noteService from "../../services/notes.js";
import protectedSession from "../../services/protected_session.js";
import { encodeUtf8, unwrapStringOrBuffer } from "../../services/utils/binary.js";

let counter = 0;

/** Creates a fresh text note in the real in-memory DB with a unique title. */
function createNote(content = "<p>hello</p>"): BNote {
    counter++;
    return getContext().init(() =>
        noteService.createNewNote({
            parentNoteId: "root",
            title: `brevision-spec-${counter}`,
            content,
            type: "text"
        }).note
    );
}

describe("Revision", () => {
    it("handles note with empty title properly", () => {
        const revision = new BRevision({
            revisionId: "4omM5OvlLhOw",
            noteId: "WHMg7iFCRG3Z",
            type: "text",
            mime: "text/html",
            isProtected: false,
            title: "",
            blobId: "",
            dateLastEdited: "2025-06-27 14:10:39.688+0300",
            dateCreated: "2025-06-27 14:10:39.688+0300",
            utcDateLastEdited: "2025-06-27 14:10:39.688+0300",
            utcDateCreated: "2025-06-27 14:10:39.688+0300",
            utcDateModified: "2025-06-27 14:10:39.688+0300"
        });
        const pojo = revision.getPojo();
        expect(pojo.title).toBeDefined();
    });
});

describe("Revision constructor (protected)", () => {
    afterEach(() => {
        protectedSession.resetDataKey();
    });

    it("falls back to a placeholder title for a protected revision when no session is available", () => {
        // isProtected with titleDecrypted=false and no protected session -> placeholder.
        const revision = new BRevision({
            revisionId: "protNoSession1",
            noteId: "noteProt1",
            type: "text",
            mime: "text/html",
            isProtected: true,
            title: "ciphertext-title",
            blobId: "",
            dateCreated: "2025-06-27 14:10:39.688+0300",
            utcDateCreated: "2025-06-27 14:10:39.688+0300",
            utcDateModified: "2025-06-27 14:10:39.688+0300"
        });

        expect(revision.isProtected).toBe(true);
        expect(revision.title).toBe("[protected]");
    });

    it("decrypts the title for a protected revision when a session is available", () => {
        protectedSession.setDataKey(encodeUtf8("0123456789abcdef"));
        const cipher = protectedSession.encrypt("secret title");
        expect(typeof cipher).toBe("string");

        const revision = new BRevision({
            revisionId: "protWithSession1",
            noteId: "noteProt2",
            type: "text",
            mime: "text/html",
            isProtected: true,
            title: cipher ?? "",
            blobId: "",
            dateCreated: "2025-06-27 14:10:39.688+0300",
            utcDateCreated: "2025-06-27 14:10:39.688+0300",
            utcDateModified: "2025-06-27 14:10:39.688+0300"
        });

        expect(revision.title).toBe("secret title");
    });

    it("reports content availability based on revisionId, protection and session", () => {
        // New revision (no revisionId) -> always available.
        const fresh = new BRevision(
            {
                revisionId: undefined,
                noteId: "noteAvail0",
                type: "text",
                mime: "text/html",
                isProtected: true,
                title: "x",
                blobId: "",
                dateCreated: "2025-06-27 14:10:39.688+0300",
                utcDateCreated: "2025-06-27 14:10:39.688+0300",
                utcDateModified: "2025-06-27 14:10:39.688+0300"
            },
            true
        );
        expect(fresh.isContentAvailable()).toBe(true);

        // Persisted, unprotected -> available.
        const unprotected = new BRevision({
            revisionId: "availUnprot1",
            noteId: "noteAvail1",
            type: "text",
            mime: "text/html",
            isProtected: false,
            title: "x",
            blobId: "",
            dateCreated: "2025-06-27 14:10:39.688+0300",
            utcDateCreated: "2025-06-27 14:10:39.688+0300",
            utcDateModified: "2025-06-27 14:10:39.688+0300"
        });
        expect(unprotected.isContentAvailable()).toBe(true);

        // Persisted, protected, no session -> reaches the session check and is unavailable.
        const protectedRev = new BRevision(
            {
                revisionId: "availProt1",
                noteId: "noteAvail2",
                type: "text",
                mime: "text/html",
                isProtected: true,
                title: "x",
                blobId: "",
                dateCreated: "2025-06-27 14:10:39.688+0300",
                utcDateCreated: "2025-06-27 14:10:39.688+0300",
                utcDateModified: "2025-06-27 14:10:39.688+0300"
            },
            true
        );
        expect(protectedRev.isContentAvailable()).toBe(false);

        // Same revision once a session is available -> the session check makes it available.
        protectedSession.setDataKey(encodeUtf8("0123456789abcdef"));
        expect(protectedRev.isContentAvailable()).toBe(true);
    });

    it("does not touch the title when titleDecrypted is passed for a protected revision", () => {
        const revision = new BRevision(
            {
                revisionId: "protAlreadyDecrypted1",
                noteId: "noteProt3",
                type: "text",
                mime: "text/html",
                isProtected: true,
                title: "already plain",
                blobId: "",
                dateCreated: "2025-06-27 14:10:39.688+0300",
                utcDateCreated: "2025-06-27 14:10:39.688+0300",
                utcDateModified: "2025-06-27 14:10:39.688+0300"
            },
            true
        );

        expect(revision.title).toBe("already plain");
    });
});

describe("Revision JSON content", () => {
    function saveRevisionWithContent(content: string): BRevision {
        const note = createNote();
        const revision = getContext().init(() => {
            const rev = note.saveRevision();
            rev.setContent(content, { forceSave: true });
            return rev;
        });
        return revision;
    }

    it("getJsonContent parses valid JSON into an object", () => {
        const revision = saveRevisionWithContent(`{"a":1,"b":"two"}`);
        expect(revision.getJsonContent()).toEqual({ a: 1, b: "two" });
        expect(revision.getJsonContentSafely()).toEqual({ a: 1, b: "two" });
    });

    it("getJsonContent returns null for empty / whitespace content", () => {
        const blank = saveRevisionWithContent("   ");
        expect(blank.getJsonContent()).toBeNull();
        expect(blank.getJsonContentSafely()).toBeNull();

        const empty = saveRevisionWithContent("");
        expect(empty.getJsonContent()).toBeNull();
    });

    it("getJsonContent throws on invalid JSON while getJsonContentSafely returns null", () => {
        const revision = saveRevisionWithContent("not valid json {");
        expect(() => revision.getJsonContent()).toThrow();
        expect(revision.getJsonContentSafely()).toBeNull();
    });
});

describe("Revision attachments", () => {
    let revision: BRevision;

    function setup(): BRevision {
        const note = createNote();
        return getContext().init(() => {
            note.saveAttachment({
                attachmentId: undefined,
                role: "image",
                mime: "image/png",
                title: "my-attachment",
                content: "binary-content",
                position: 10
            });
            // saveRevision copies note attachments onto the revision (ownerId = revisionId).
            return note.saveRevision();
        });
    }

    it("exposes the copied attachment through the revision queries", () => {
        revision = setup();

        const attachments = revision.getAttachments();
        expect(attachments.length).toBe(1);
        const attachment = attachments[0];
        expect(attachment).toBeDefined();
        expect(attachment.ownerId).toBe(revision.revisionId);
        expect(attachment.role).toBe("image");
        expect(attachment.title).toBe("my-attachment");

        // getAttachmentById without content length.
        const attachmentId = attachment.attachmentId ?? "";
        const byId = revision.getAttachmentById(attachmentId);
        expect(byId).toBeDefined();
        expect(byId?.attachmentId).toBe(attachmentId);
        expect(byId?.contentLength).toBeUndefined();

        // getAttachmentById with content length.
        const byIdWithLength = revision.getAttachmentById(attachmentId, { includeContentLength: true });
        expect(byIdWithLength).toBeDefined();
        expect(typeof byIdWithLength?.contentLength).toBe("number");
        expect(byIdWithLength?.contentLength).toBe("binary-content".length);

        // getAttachmentsByRole.
        const byRole = revision.getAttachmentsByRole("image");
        expect(byRole.length).toBe(1);
        expect(byRole[0].attachmentId).toBe(attachmentId);
        expect(revision.getAttachmentsByRole("nonexistent-role").length).toBe(0);

        // getAttachmentByTitle.
        const byTitle = revision.getAttachmentByTitle("my-attachment");
        expect(byTitle).toBeDefined();
        expect(byTitle.attachmentId).toBe(attachmentId);
        expect(unwrapStringOrBuffer(byTitle.getContent())).toBe("binary-content");
        expect(revision.getAttachmentByTitle("nope")).toBeUndefined();
    });

    it("returns undefined for an unknown attachment id", () => {
        revision = setup();
        expect(revision.getAttachmentById("does-not-exist")).toBeUndefined();
        expect(revision.getAttachmentById("does-not-exist", { includeContentLength: true })).toBeUndefined();
    });
});

describe("Revision getNote", () => {
    it("resolves the owning note from becca", () => {
        const note = createNote();
        const revision = getContext().init(() => note.saveRevision());

        expect(revision.getNote()).toBe(note);
    });
});

describe("Revision eraseRevision", () => {
    it("hard-deletes the revision so it is no longer retrievable", () => {
        const note = createNote();
        const revision = getContext().init(() => note.saveRevision());
        const revisionId = revision.revisionId ?? "";
        expect(revisionId).not.toBe("");
        expect(becca.getRevision(revisionId)).not.toBeNull();

        getContext().init(() => revision.eraseRevision());

        expect(becca.getRevision(revisionId)).toBeNull();
    });
});

describe("Revision getPojoToSave (protected)", () => {
    afterEach(() => {
        protectedSession.resetDataKey();
    });

    function makeProtectedRevision(): BRevision {
        return new BRevision(
            {
                revisionId: "pojoToSaveProt1",
                noteId: "notePojo1",
                type: "text",
                mime: "text/html",
                isProtected: true,
                title: "plain title",
                blobId: "",
                dateCreated: "2025-06-27 14:10:39.688+0300",
                utcDateCreated: "2025-06-27 14:10:39.688+0300",
                utcDateModified: "2025-06-27 14:10:39.688+0300"
            },
            true
        );
    }

    it("encrypts the title and strips content when a protected session is available", () => {
        protectedSession.setDataKey(encodeUtf8("0123456789abcdef"));
        const revision = makeProtectedRevision();
        revision.content = "some content";
        revision.contentLength = 12;

        const pojo = revision.getPojoToSave();

        expect("content" in pojo).toBe(false);
        expect("contentLength" in pojo).toBe(false);
        expect(typeof pojo.title).toBe("string");
        expect(pojo.title).not.toBe("");
        // The persisted title is the ciphertext, not the plaintext.
        expect(pojo.title).not.toBe("plain title");
        expect(protectedSession.decryptString(pojo.title)).toBe("plain title");
    });

    it("clears the title when no protected session is available", () => {
        const revision = makeProtectedRevision();
        const pojo = revision.getPojoToSave();
        expect(pojo.title).toBe("");
    });

    it("falls back to an empty title when encryption yields no ciphertext", () => {
        protectedSession.setDataKey(encodeUtf8("0123456789abcdef"));
        const revision = makeProtectedRevision();
        // A null title makes protectedSession.encrypt return null, exercising the `?? ""` fallback.
        revision.title = null as unknown as string;

        const pojo = revision.getPojoToSave();
        expect(pojo.title).toBe("");
    });

    it("leaves the title intact for an unprotected revision", () => {
        const revision = new BRevision({
            revisionId: "pojoUnprotected1",
            noteId: "notePojo2",
            type: "text",
            mime: "text/html",
            isProtected: false,
            title: "visible title",
            blobId: "",
            dateCreated: "2025-06-27 14:10:39.688+0300",
            utcDateCreated: "2025-06-27 14:10:39.688+0300",
            utcDateModified: "2025-06-27 14:10:39.688+0300"
        });

        const pojo = revision.getPojoToSave();
        expect(pojo.title).toBe("visible title");
    });
});
