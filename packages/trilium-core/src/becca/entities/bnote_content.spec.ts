import { afterEach, describe, expect, it, vi } from "vitest";

import { dayjs } from "@triliumnext/commons";

import becca from "../becca.js";
import { getContext } from "../../services/context.js";
import eraseService from "../../services/erase.js";
import noteService from "../../services/notes.js";
import optionService from "../../services/options.js";
import protectedSessionService from "../../services/protected_session.js";
import { getSql } from "../../services/sql/index.js";
import date_utils from "../../services/utils/date.js";
import Module from "module";

import { encodeUtf8, unwrapStringOrBuffer } from "../../services/utils/binary.js";
import { buildNote } from "../../test/becca_easy_mocking.js";
import type BNote from "./bnote.js";

// executeScript() does a lazy `require("../../services/script.js")` to avoid a
// circular import. That bare-`.js` require is resolvable only in the bundled
// production build (the source tree has script.ts, not script.js), so under
// vitest the native CommonJS require throws. We intercept Module._load for that
// exact specifier and hand back a stub exposing executeNote.
const executeNoteMock = vi.fn();

let counter = 0;

/** Creates a fresh note under the given parent in the shared in-memory DB. */
function createNote(opts: { parentNoteId?: string; content?: string; type?: "text" | "code" | "image"; mime?: string; isProtected?: boolean } = {}): BNote {
    counter++;
    return getContext().init(() => {
        const { note } = noteService.createNewNote({
            parentNoteId: opts.parentNoteId ?? "root",
            title: `bnote-content-spec-${counter}`,
            content: opts.content ?? "<p>hello</p>",
            type: opts.type ?? "text",
            mime: opts.mime
        });
        if (opts.isProtected) {
            note.isProtected = true;
        }
        return note;
    });
}

const PROTECTED_KEY = encodeUtf8("0123456789abcdef"); // exactly 16 bytes

describe("BNote content / misc getters", () => {
    afterEach(() => {
        protectedSessionService.resetDataKey();
        vi.restoreAllMocks();
    });

    describe("getTitleOrProtected (line 163)", () => {
        it("returns the title when content is available, and a placeholder when protected without a session", () => {
            const note = createNote();
            expect(note.getTitleOrProtected()).toBe(note.title);

            // Protected note with no session -> not available -> placeholder.
            const protectedNote = createNote({ isProtected: true });
            expect(protectedNote.getTitleOrProtected()).toBe("[protected]");
        });
    });

    describe("setJsonContent (line 240-241)", () => {
        it("serialises an object as JSON content and reads it back", () => {
            const note = createNote();
            getContext().init(() => note.setJsonContent({ a: 1, b: "two" }));

            expect(note.getJsonContent()).toEqual({ a: 1, b: "two" });
        });
    });

    describe("date getter objects (lines 244-258)", () => {
        it("returns dayjs objects for a persisted note", () => {
            const note = createNote();

            expect(dayjs.isDayjs(note.dateCreatedObj)).toBe(true);
            expect(dayjs.isDayjs(note.utcDateCreatedObj)).toBe(true);
            expect(dayjs.isDayjs(note.dateModifiedObj)).toBe(true);
            expect(dayjs.isDayjs(note.utcDateModifiedObj)).toBe(true);
        });

        it("returns null when the underlying date field is null", () => {
            const note = buildNote({ id: `date-null-${counter++}`, title: "dates" });
            // Force the `=== null` branch of each getter.
            (note as unknown as { dateCreated: string | null }).dateCreated = null;
            (note as unknown as { utcDateCreated: string | null }).utcDateCreated = null;
            (note as unknown as { dateModified: string | null }).dateModified = null;
            (note as unknown as { utcDateModified: string | null }).utcDateModified = null;

            expect(note.dateCreatedObj).toBeNull();
            expect(note.utcDateCreatedObj).toBeNull();
            expect(note.dateModifiedObj).toBeNull();
            expect(note.utcDateModifiedObj).toBeNull();
        });
    });

    describe("setDateCreatedAndModified (forces import dates, bypassing beforeSaving)", () => {
        it("persists explicit UTC dates, derives the local columns, and keeps the blob in step", () => {
            const note = createNote();
            const utcDateCreated = "2021-03-04 05:06:07.000Z";
            const utcDateModified = "2022-08-09 10:11:12.000Z";

            getContext().init(() => note.setDateCreatedAndModified(utcDateCreated, utcDateModified));

            // the in-memory entity reflects the forced dates
            expect(note.utcDateCreated).toBe(utcDateCreated);
            expect(note.utcDateModified).toBe(utcDateModified);
            expect(note.dateCreated).toBe(dayjs(utcDateCreated).format(date_utils.LOCAL_DATETIME_FORMAT));
            expect(note.dateModified).toBe(dayjs(utcDateModified).format(date_utils.LOCAL_DATETIME_FORMAT));

            // and so does the persisted row — i.e. beforeSaving's "now" stamping did not win
            const row = getSql().getRow<{ utcDateCreated: string; utcDateModified: string }>(
                "SELECT utcDateCreated, utcDateModified FROM notes WHERE noteId = ?",
                [note.noteId]
            );
            expect(row.utcDateCreated).toBe(utcDateCreated);
            expect(row.utcDateModified).toBe(utcDateModified);

            const blobModified = getSql().getValue<string>("SELECT utcDateModified FROM blobs WHERE blobId = ?", [note.blobId]);
            expect(blobModified).toBe(utcDateModified);
        });

        it("leaves a date pair untouched when its argument is omitted", () => {
            const note = createNote();
            const originalUtcCreated = note.utcDateCreated;

            getContext().init(() => note.setDateCreatedAndModified(undefined, "2030-01-02 03:04:05.000Z"));

            expect(note.utcDateCreated).toBe(originalUtcCreated);
            expect(note.utcDateModified).toBe("2030-01-02 03:04:05.000Z");
        });
    });

    describe("type / mime predicates (lines 266-321)", () => {
        it("isJson", () => {
            const json = buildNote({ id: `json-${counter++}`, type: "code", mime: "application/json" });
            expect(json.isJson()).toBe(true);

            const notJson = buildNote({ id: `notjson-${counter++}`, type: "code", mime: "text/plain" });
            expect(notJson.isJson()).toBe(false);
        });

        it("isJavaScript across the env-suffixed mimes", () => {
            const backend = buildNote({ id: `js-be-${counter++}`, type: "code", mime: "application/javascript;env=backend" });
            expect(backend.isJavaScript()).toBe(true);

            const xjs = buildNote({ id: `js-x-${counter++}`, type: "file", mime: "application/x-javascript" });
            expect(xjs.isJavaScript()).toBe(true);

            const textJs = buildNote({ id: `js-t-${counter++}`, type: "launcher", mime: "text/javascript" });
            expect(textJs.isJavaScript()).toBe(true);

            const notJs = buildNote({ id: `js-no-${counter++}`, type: "text", mime: "text/html" });
            expect(notJs.isJavaScript()).toBe(false);
        });

        it("isImage for image type and image/* file mime", () => {
            const imageType = buildNote({ id: `img-t-${counter++}`, type: "image", mime: "image/png" });
            expect(imageType.isImage()).toBe(true);

            const imageFile = buildNote({ id: `img-f-${counter++}`, type: "file", mime: "image/jpeg" });
            expect(imageFile.isImage()).toBe(true);

            const notImage = buildNote({ id: `img-no-${counter++}`, type: "file", mime: "text/plain" });
            expect(notImage.isImage()).toBe(false);
        });

        it("isStringNote delegates to hasStringContent (deprecated alias)", () => {
            const text = buildNote({ id: `str-${counter++}`, type: "text", mime: "text/html" });
            expect(text.isStringNote()).toBe(text.hasStringContent());
            expect(text.isStringNote()).toBe(true);

            const image = buildNote({ id: `str-no-${counter++}`, type: "image", mime: "image/png" });
            expect(image.isStringNote()).toBe(false);
        });

        it("getScriptEnv returns frontend / backend / null", () => {
            const frontendJs = buildNote({ id: `env-fe-${counter++}`, type: "code", mime: "application/javascript;env=frontend" });
            expect(frontendJs.getScriptEnv()).toBe("frontend");

            // A render note whose mime is NOT text/html, so isHtml() is false and the
            // dedicated `type === "render"` branch is what returns "frontend".
            const render = buildNote({ id: `env-render-${counter++}`, type: "render", mime: "text/plain" });
            expect(render.getScriptEnv()).toBe("frontend");

            const backendJs = buildNote({ id: `env-be-${counter++}`, type: "code", mime: "application/javascript;env=backend" });
            expect(backendJs.getScriptEnv()).toBe("backend");

            const plain = buildNote({ id: `env-none-${counter++}`, type: "text", mime: "text/plain" });
            expect(plain.getScriptEnv()).toBeNull();
        });
    });

    describe("executeScript (lines 329-333)", () => {
        it("delegates to scriptService.executeNote with this note as origin", () => {
            const note = buildNote({ id: `exec-${counter++}`, type: "code", mime: "application/javascript;env=backend" });
            executeNoteMock.mockReset();
            executeNoteMock.mockReturnValue("result");

            const moduleAny = Module as unknown as { _load: (...args: unknown[]) => unknown };
            const originalLoad = moduleAny._load;
            moduleAny._load = function (request: unknown, ...rest: unknown[]) {
                if (request === "../../services/script.js") {
                    return { default: { executeNote: (...args: unknown[]) => executeNoteMock(...args) } };
                }
                return originalLoad.call(this, request, ...rest);
            };

            try {
                const result = note.executeScript();

                expect(executeNoteMock).toHaveBeenCalledTimes(1);
                expect(executeNoteMock.mock.calls[0]?.[0]).toBe(note);
                expect(executeNoteMock.mock.calls[0]?.[1]).toEqual({ originEntity: note });
                expect(result).toBe("result");
            } finally {
                moduleAny._load = originalLoad;
            }
        });
    });

    describe("attribute count getters (lines 980-1013)", () => {
        it("counts owned/inherited labels and relations, distinguishing auto-links", () => {
            const note = createNote();
            const target = createNote();

            getContext().init(() => {
                note.addLabel("plainLabel", "v");
                note.addRelation("relTo", target.noteId); // not an auto-link
                note.addRelation("internalLink", target.noteId); // auto-link
            });

            // labels
            expect(note.labelCount).toBeGreaterThanOrEqual(1);
            expect(note.ownedLabelCount).toBe(1);

            // relations: relationCount excludes auto-links, the *IncludingLinks variants include them.
            expect(note.relationCount).toBe(1);
            expect(note.relationCountIncludingLinks).toBe(2);
            expect(note.ownedRelationCount).toBe(1);
            expect(note.ownedRelationCountIncludingLinks).toBe(2);

            // target relations on the target note: it is the destination of two relations,
            // one of which (internalLink) is an auto-link.
            expect(target.targetRelationCount).toBe(1);
            expect(target.targetRelationCountIncludingLinks).toBe(2);

            // attributeCount / ownedAttributeCount include both labels and relations.
            expect(note.attributeCount).toBe(note.getAttributes().length);
            expect(note.ownedAttributeCount).toBe(3);
        });
    });

    describe("cloneTo (lines 1408-1417)", () => {
        it("clones into a parent's branch on success", () => {
            const source = createNote();
            const target = createNote();

            const res = getContext().init(() => source.cloneTo(target.noteId));

            expect(res.success).toBe(true);
            expect(becca.getBranchFromChildAndParent(source.noteId, target.noteId)).not.toBeNull();
        });

        it("fails when the target parent cannot be resolved to a branch", () => {
            const source = createNote();

            const res = source.cloneTo("doesNotExist123");

            expect(res.success).toBe(false);
            expect(typeof res.message).toBe("string");
        });
    });

    describe("isEligibleForConversionToAttachment / convertToParentAttachment (lines 1420-1493)", () => {
        function makeConvertibleImage() {
            const parent = createNote({ content: "" });
            const image = createNote({ parentNoteId: parent.noteId, type: "image", mime: "image/png", content: "binary" });
            // Parent references the image and contains the image URL in its content.
            getContext().init(() => {
                parent.addRelation("imageLink", image.noteId);
                parent.setContent(`<img src="api/images/${image.noteId}/foo.png">`);
            });
            return { parent, image };
        }

        it("rejects a non-image note", () => {
            const text = createNote();
            expect(text.isEligibleForConversionToAttachment()).toBe(false);
        });

        it("rejects an image with children", () => {
            const parent = createNote({ content: "" });
            const image = createNote({ parentNoteId: parent.noteId, type: "image", mime: "image/png", content: "x" });
            createNote({ parentNoteId: image.noteId });
            expect(image.isEligibleForConversionToAttachment()).toBe(false);
        });

        it("rejects an image with more than one parent branch", () => {
            const parentA = createNote({ content: "" });
            const parentB = createNote({ content: "" });
            const image = createNote({ parentNoteId: parentA.noteId, type: "image", mime: "image/png", content: "x" });
            getContext().init(() => image.cloneTo(parentB.noteId));
            expect(image.getParentBranches().length).toBeGreaterThan(1);
            expect(image.isEligibleForConversionToAttachment()).toBe(false);
        });

        it("rejects when autoConversion is requested but there is no imageLink target relation", () => {
            const parent = createNote({ content: "" });
            const image = createNote({ parentNoteId: parent.noteId, type: "image", mime: "image/png", content: "x" });
            expect(image.isEligibleForConversionToAttachment({ autoConversion: true })).toBe(false);
        });

        it("rejects when there are multiple imageLink target relations", () => {
            const parent = createNote({ content: "" });
            const other = createNote({ content: "" });
            const image = createNote({ parentNoteId: parent.noteId, type: "image", mime: "image/png", content: "x" });
            getContext().init(() => {
                parent.addRelation("imageLink", image.noteId);
                other.addRelation("imageLink", image.noteId);
            });
            expect(image.getTargetRelations().filter((r) => r.name === "imageLink").length).toBe(2);
            expect(image.isEligibleForConversionToAttachment()).toBe(false);
        });

        it("rejects when the referencing note is not the parent", () => {
            const parent = createNote({ content: "" });
            const other = createNote({ content: "" });
            const image = createNote({ parentNoteId: parent.noteId, type: "image", mime: "image/png", content: "x" });
            // The single imageLink comes from a note that is NOT the image's parent.
            getContext().init(() => other.addRelation("imageLink", image.noteId));
            expect(image.isEligibleForConversionToAttachment()).toBe(false);
        });

        it("rejects when the parent note is not a text note", () => {
            const parent = createNote({ type: "code", mime: "text/plain", content: "x" });
            const image = createNote({ parentNoteId: parent.noteId, type: "image", mime: "image/png", content: "x" });
            getContext().init(() => parent.addRelation("imageLink", image.noteId));
            expect(image.isEligibleForConversionToAttachment()).toBe(false);
        });

        it("accepts and converts an eligible image into a parent attachment", () => {
            const { parent, image } = makeConvertibleImage();

            expect(image.isEligibleForConversionToAttachment()).toBe(true);

            const imageNoteId = image.noteId;
            const attachment = getContext().init(() => image.convertToParentAttachment());

            expect(attachment).not.toBeNull();
            expect(attachment?.ownerId).toBe(parent.noteId);
            // The original image note is deleted as part of the conversion.
            expect(image.isDeleted).toBe(true);
            // The parent content was rewritten to point at the new attachment URL.
            const parentContent = unwrapStringOrBuffer(parent.getContent());
            expect(parentContent).not.toContain(`api/images/${imageNoteId}/`);
            expect(parentContent).toContain(`api/attachments/${attachment?.attachmentId}/image/`);
        });

        it("convertToParentAttachment returns null when the note is not eligible", () => {
            const text = createNote();
            expect(getContext().init(() => text.convertToParentAttachment())).toBeNull();
        });
    });

    describe("deleteNote (lines 1500-1520)", () => {
        it("soft-deletes the note via its parent branches", () => {
            const note = createNote();
            expect(note.isDeleted).toBe(false);

            getContext().init(() => note.deleteNote());

            expect(note.isDeleted).toBe(true);
        });

        it("is a no-op when the note is already deleted", () => {
            const note = createNote();
            getContext().init(() => note.deleteNote());
            expect(note.isDeleted).toBe(true);

            // Second call hits the early `isDeleted` return.
            expect(() => getContext().init(() => note.deleteNote())).not.toThrow();
        });
    });

    describe("decrypt (lines 1522-1533)", () => {
        it("decrypts a protected note title when a session is available", () => {
            protectedSessionService.setDataKey(PROTECTED_KEY);
            const note = createNote({ isProtected: true });

            // Simulate an encrypted, not-yet-decrypted note.
            const cipher = protectedSessionService.encrypt("secret title");
            expect(typeof cipher).toBe("string");
            note.title = cipher ?? "";
            note.isDecrypted = false;

            note.decrypt();

            expect(note.title).toBe("secret title");
            expect(note.isDecrypted).toBe(true);
        });

        it("swallows decryption errors and leaves the note not decrypted", () => {
            protectedSessionService.setDataKey(PROTECTED_KEY);
            const note = createNote({ isProtected: true });
            note.isDecrypted = false;

            vi.spyOn(protectedSessionService, "decryptString").mockImplementation(() => {
                throw new Error("kaput");
            });

            expect(() => note.decrypt()).not.toThrow();
            expect(note.isDecrypted).toBe(false);
        });

        it("falls back to an empty title when decryptString yields a falsy value", () => {
            protectedSessionService.setDataKey(PROTECTED_KEY);
            const note = createNote({ isProtected: true });
            note.isDecrypted = false;

            // decryptString returning null exercises the `|| ""` fallback.
            vi.spyOn(protectedSessionService, "decryptString").mockReturnValue(null);

            note.decrypt();

            expect(note.title).toBe("");
            expect(note.isDecrypted).toBe(true);
        });

        it("refreshes the flat text search index so a decrypted note is searchable by title (issue #10406)", () => {
            protectedSessionService.setDataKey(PROTECTED_KEY);
            const note = createNote({ isProtected: true });

            const cipher = protectedSessionService.encrypt("topsecret");
            note.title = cipher ?? "";
            note.isDecrypted = false;
            note.invalidateThisCache();

            // Build the index while the title is still encrypted — it must not contain the plaintext yet.
            const idxBefore = becca.getFlatTextIndex().noteIdToIdx.get(note.noteId);
            expect(idxBefore).toBeDefined();
            expect(becca.getFlatTextIndex().flatTexts[idxBefore ?? -1]).not.toContain("topsecret");

            note.decrypt();
            expect(note.isDecrypted).toBe(true);

            // decrypt() must schedule an index refresh; after it the plaintext title is indexed.
            const idxAfter = becca.getFlatTextIndex().noteIdToIdx.get(note.noteId);
            expect(becca.getFlatTextIndex().flatTexts[idxAfter ?? -1]).toContain("topsecret");
        });
    });

    describe("saveRevision / eraseExcessRevisionSnapshots (lines 1551-1620)", () => {
        it("saves a revision and copies note attachments onto it", () => {
            const note = createNote();
            getContext().init(() =>
                note.saveAttachment({
                    role: "image",
                    mime: "image/png",
                    title: "att-" + counter,
                    content: "binary"
                })
            );

            const revision = getContext().init(() => note.saveRevision({ description: "d", source: "test" as never }));

            expect(revision.revisionId).toBeDefined();
            expect(revision.getAttachments().length).toBe(1);
        });

        it("erases excess revisions beyond the #versioningLimit label", () => {
            const note = createNote();
            getContext().init(() => note.setLabel("versioningLimit", "2"));

            const eraseSpy = vi.spyOn(eraseService, "eraseRevisions");

            // Create more revisions than the limit.
            getContext().init(() => note.saveRevision());
            getContext().init(() => note.saveRevision());
            getContext().init(() => note.saveRevision());
            getContext().init(() => note.saveRevision());

            // With a limit of 2, the older revisions beyond the 2 most recent are erased.
            expect(eraseSpy).toHaveBeenCalled();
            const erasedIds = eraseSpy.mock.calls.flatMap((call) => call[0]);
            expect(erasedIds.length).toBeGreaterThan(0);
            // Final count must not exceed the configured limit.
            expect(note.getRevisions().length).toBeLessThanOrEqual(2);
        });

        it("falls back to the option limit when no label is present", () => {
            const note = createNote();
            getContext().init(() => optionService.setOption("revisionSnapshotNumberLimit", "1"));
            try {
                getContext().init(() => note.saveRevision());
                getContext().init(() => note.saveRevision());
                getContext().init(() => note.saveRevision());

                expect(note.getRevisions().length).toBeLessThanOrEqual(1);
            } finally {
                getContext().init(() => optionService.setOption("revisionSnapshotNumberLimit", "-1"));
            }
        });
    });

    describe("saveAttachment matchBy (lines 1628-1655)", () => {
        it("matches an existing attachment by title", () => {
            const note = createNote();
            const first = getContext().init(() =>
                note.saveAttachment({ role: "file", mime: "text/plain", title: "by-title-" + counter, content: "a" })
            );
            const second = getContext().init(() =>
                note.saveAttachment({ role: "file", mime: "text/plain", title: "by-title-" + counter, content: "b" }, "title")
            );

            // Same title -> updates the existing attachment instead of creating a new one.
            expect(second.attachmentId).toBe(first.attachmentId);
            expect(note.getAttachments().length).toBe(1);
            expect(unwrapStringOrBuffer(note.getAttachments()[0].getContent())).toBe("b");
        });

        it("matches an existing attachment by attachmentId (default)", () => {
            const note = createNote();
            const first = getContext().init(() =>
                note.saveAttachment({ role: "file", mime: "text/plain", title: "by-id-" + counter, content: "a" })
            );
            const attachmentId = first.attachmentId ?? "";
            const second = getContext().init(() =>
                note.saveAttachment({ attachmentId, role: "file", mime: "text/plain", title: "by-id-" + counter, content: "b" })
            );

            expect(second.attachmentId).toBe(attachmentId);
            expect(note.getAttachments().length).toBe(1);
        });

        it("throws for an unsupported matchBy value", () => {
            const note = createNote();
            expect(() =>
                getContext().init(() =>
                    note.saveAttachment(
                        { role: "file", mime: "text/plain", title: "bad", content: "x" },
                        "bogus" as never
                    )
                )
            ).toThrow();
        });
    });

    describe("getPojoToSave protected (lines 1687-1700)", () => {
        it("encrypts the title for a decrypted protected note", () => {
            protectedSessionService.setDataKey(PROTECTED_KEY);
            const note = createNote({ isProtected: true });
            note.isDecrypted = true;
            note.title = "plain protected title";

            const pojo = note.getPojoToSave();

            expect(typeof pojo.title).toBe("string");
            expect(pojo.title).not.toBe("plain protected title");
            expect(pojo.title).toBeDefined();
            const persistedTitle = pojo.title ?? "";
            expect(protectedSessionService.decryptString(persistedTitle)).toBe("plain protected title");
        });

        it("strips the title when the protected note is not decrypted", () => {
            const note = createNote({ isProtected: true });
            note.isDecrypted = false;

            const pojo = note.getPojoToSave();

            expect("title" in pojo).toBe(false);
        });

        it("strips the title for a decrypted protected note with an empty title", () => {
            protectedSessionService.setDataKey(PROTECTED_KEY);
            const note = createNote({ isProtected: true });
            note.isDecrypted = true;
            note.title = ""; // falsy title takes the `isDecrypted && pojo.title` short-circuit

            const pojo = note.getPojoToSave();

            expect("title" in pojo).toBe(false);
        });

        it("falls back to undefined when encryption yields a falsy value", () => {
            protectedSessionService.setDataKey(PROTECTED_KEY);
            const note = createNote({ isProtected: true });
            note.isDecrypted = true;
            note.title = "plain protected title";

            // encrypt returning null exercises the `encrypt(...) || undefined` fallback.
            vi.spyOn(protectedSessionService, "encrypt").mockReturnValue(null);

            const pojo = note.getPojoToSave();
            expect(pojo.title).toBeUndefined();
        });
    });

    describe("encodedTitle (line 1738-1739)", () => {
        it("URL-encodes the note title", () => {
            const note = buildNote({ id: `enc-${counter++}`, title: "a b/c?" });
            expect(note.encodedTitle).toBe(encodeURIComponent("a b/c?"));
        });
    });

    describe("shareId (line 1757-1758)", () => {
        it("returns the noteId", () => {
            const note = createNote();
            expect(note.shareId).toBe(note.noteId);
        });
    });
});
