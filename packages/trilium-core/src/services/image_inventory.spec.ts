import { afterEach, describe, expect, it } from "vitest";

import becca from "../becca/becca.js";
import { getContext } from "./context.js";
import { getNoteImageInventory } from "./image_inventory.js";
import notesService from "./notes.js";
import protectedSessionService from "./protected_session.js";
import { getSql } from "./sql/index.js";
import { encodeUtf8 } from "./utils/binary.js";

const PROTECTED_KEY = encodeUtf8("0123456789abcdef"); // exactly 16 bytes

/** A PNG signature and an IHDR chunk stating 3000x2000, which is all the inventory reads. */
const PNG_HEADER = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x0b, 0xb8, 0x00, 0x00, 0x07, 0xd0,
    0x08, 0x06, 0x00, 0x00, 0x00
]);

let counter = 0;

afterEach(() => {
    protectedSessionService.resetDataKey();
});

function createNote(isProtected = false) {
    return getContext().init(() => notesService.createNewNote({
        parentNoteId: "root",
        title: `image-inventory-spec-${++counter}`,
        content: "",
        type: "text",
        isProtected
    })).note.noteId;
}

/** An image attachment whose bytes are its own, so no other test shares its blob. */
function addImage(noteId: string) {
    const content = Uint8Array.from([ ...PNG_HEADER, ...encodeUtf8(`inventory ${++counter}`) ]);

    return {
        size: content.byteLength,
        attachmentId: getContext().init(() => getSql().transactional(() => becca.getNoteOrThrow(noteId)
            .saveAttachment({ role: "image", mime: "image/png", title: `p${counter}.png`, content }).attachmentId ?? ""))
    };
}

describe("getNoteImageInventory", () => {
    it("reads a protected image in full when a session is open, its stored bytes being ciphertext", () => {
        protectedSessionService.setDataKey(PROTECTED_KEY);
        const noteId = createNote(true);
        const { size } = addImage(noteId);

        expect(getNoteImageInventory(noteId, { maxWidthHeight: 1000 })).toMatchObject({
            total: { count: 1, size },
            oversized: { count: 1, size },
            formats: [ { format: "png", count: 1, size } ],
            unreadable: 0
        });
    });

    it("counts an image it cannot read as unreadable rather than as one of no size", () => {
        const noteId = createNote();
        const { attachmentId } = addImage(noteId);
        getSql().execute("UPDATE attachments SET blobId = 'missingInventoryBlob' WHERE attachmentId = ?", [ attachmentId ]);

        expect(getNoteImageInventory(noteId)).toMatchObject({
            total: { count: 0, size: 0 },
            unreadable: 1
        });
    });
});
