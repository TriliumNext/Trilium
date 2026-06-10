import { afterEach, describe, expect, it, vi } from "vitest";

import { getContext } from "../../services/context.js";
import noteService from "../../services/notes.js";
import protectedSessionService from "../../services/protected_session.js";
import { getSql } from "../../services/sql/index.js";
import { encodeUtf8, unwrapStringOrBuffer } from "../../services/utils/binary.js";
import type BNote from "./bnote.js";
import BBlob from "./bblob.js";
import BOption from "./boption.js";

let counter = 0;

/** Creates a fresh text note under root in the shared in-memory DB. */
function createNote(opts: { isProtected?: boolean } = {}): BNote {
    counter++;
    return getContext().init(() => {
        const { note } = noteService.createNewNote({
            parentNoteId: "root",
            title: `abstract-becca-entity-spec-${counter}`,
            content: "<p>hello</p>",
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

describe("AbstractBeccaEntity (real DB)", () => {
    afterEach(() => {
        protectedSessionService.resetDataKey();
        vi.restoreAllMocks();
    });

    describe("hasStringContent / init defaults", () => {
        it("hasStringContent defaults to true for entities that don't override it", () => {
            const blob = new BBlob({
                blobId: "abe-blob-default",
                content: "x",
                contentLength: 1,
                dateModified: "2020-01-01 00:00:00.000Z",
                utcDateModified: "2020-01-01 00:00:00.000Z"
            });

            expect(blob.hasStringContent()).toBe(true);
        });

        it("init is a no-op that does not throw for entities that don't override it", () => {
            const blob = new BBlob({
                blobId: "abe-blob-init",
                content: "x",
                contentLength: 1,
                dateModified: "2020-01-01 00:00:00.000Z",
                utcDateModified: "2020-01-01 00:00:00.000Z"
            });

            expect(() => blob.init()).not.toThrow();
            expect(blob.init()).toBeUndefined();
        });
    });

    describe("getUtcDateChanged", () => {
        it("returns utcDateModified when present", () => {
            const blob = new BBlob({
                blobId: "abe-date-modified",
                content: "x",
                contentLength: 1,
                dateModified: "2020-01-01 00:00:00.000Z",
                utcDateModified: "2021-02-03 04:05:06.000Z"
            });

            expect(blob.getUtcDateChanged()).toBe("2021-02-03 04:05:06.000Z");
        });

        it("falls back to utcDateCreated when utcDateModified is absent", () => {
            const blob = new BBlob({
                blobId: "abe-date-created",
                content: "x",
                contentLength: 1,
                dateModified: "2020-01-01 00:00:00.000Z",
                utcDateModified: ""
            });
            blob.utcDateModified = undefined;
            blob.utcDateCreated = "2019-09-09 09:09:09.000Z";

            expect(blob.getUtcDateChanged()).toBe("2019-09-09 09:09:09.000Z");
        });
    });

    describe("putEntityChange isSynced branch", () => {
        it("saves an options entity (forces the non-synced branch) and a regular entity", () => {
            // Regular (non-options) entity: putEntityChange always sets isSynced true.
            const note = createNote();
            expect(note.noteId).toBeDefined();

            // Options entity with isSynced falsy -> ternary false-branch.
            const option = new BOption({
                name: `abeTestOption${counter}`,
                value: "v",
                isSynced: false,
                utcDateModified: "2020-01-01 00:00:00.000Z"
            });
            getContext().init(() => option.save());

            const stored = getSql().getValue<string>(
                "SELECT value FROM options WHERE name = ?",
                [`abeTestOption${counter}`]
            );
            expect(stored).toBe("v");
        });
    });

    describe("_setContent guards", () => {
        it("throws when content is null", () => {
            const note = createNote();
            expect(() => getContext().init(() => note.setContent(null as unknown as string))).toThrow(
                /Cannot set null content/
            );
        });

        it("throws when content is undefined", () => {
            const note = createNote();
            expect(() =>
                getContext().init(() => note.setContent(undefined as unknown as string))
            ).toThrow(/Cannot set null content/);
        });
    });

    describe("forceFrontendReload componentId branch (saveBlob)", () => {
        it("saves new content with forceFrontendReload set", () => {
            const note = createNote();
            getContext().init(() =>
                note.setContent("<p>reload-me-" + counter + "</p>", { forceFrontendReload: true })
            );

            expect(unwrapStringOrBuffer(note.getContent())).toBe("<p>reload-me-" + counter + "</p>");
        });
    });

    describe("protected content paths", () => {
        it("encrypts string content when a protected session is available", () => {
            protectedSessionService.setDataKey(PROTECTED_KEY);
            const note = createNote({ isProtected: true });

            getContext().init(() => note.setContent("super secret " + counter));

            // Round-trips back to plaintext while the session is available.
            expect(unwrapStringOrBuffer(note.getContent())).toBe("super secret " + counter);
        });

        it("throws when encryption fails (encrypt returns null)", () => {
            protectedSessionService.setDataKey(PROTECTED_KEY);
            const note = createNote({ isProtected: true });

            vi.spyOn(protectedSessionService, "encrypt").mockReturnValue(null);

            expect(() => getContext().init(() => note.setContent("won't encrypt " + counter))).toThrow(
                /Unable to encrypt/
            );
        });

        it("throws when the protected session is not available", () => {
            // Create the protected note while a session is available, then drop the key.
            protectedSessionService.setDataKey(PROTECTED_KEY);
            const note = createNote({ isProtected: true });
            protectedSessionService.resetDataKey();

            expect(() => getContext().init(() => note.setContent("no session " + counter))).toThrow(
                /protected session is not available/
            );
        });
    });
});
