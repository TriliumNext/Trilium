import type { TextRepresentationResponse } from "@triliumnext/commons";
import { beforeAll, describe, expect, it } from "vitest";

import becca from "../../becca/becca.js";
import blobService from "../../services/blob.js";
import * as cls from "../../services/context.js";
import protectedSessionService from "../../services/protected_session.js";
import { getSql } from "../../services/sql/index.js";
import { encodeUtf8 } from "../../services/utils/binary.js";
import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

const PROTECTED_KEY = encodeUtf8("0123456789abcdef"); // exactly 16 bytes

/**
 * Drives the shared OCR read routes through {@link CoreApiTester} (no Express), so this spec runs
 * under both the node and standalone (WASM) suites — the second being the point of sharing them:
 * the text is written by the server's OCR engine but travels with the blob, so a synced client has
 * it too.
 */
let api: CoreApiTester;

interface AttachmentPojo {
    attachmentId: string;
}

/** Writes OCR text straight onto a blob, standing in for what the engine would have stored. */
function storeOcrText(blobId: string | undefined, text: string) {
    cls.init(() => getSql().execute("UPDATE blobs SET textRepresentation = ? WHERE blobId = ?", [ text, blobId ]));
}

describe("OCR text API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    it("returns the text stored for a note, and says when there is none", async () => {
        const { noteId } = await createTextNote(api, { content: "<p>a scan</p>" });

        const before = await api.get<TextRepresentationResponse>(`/api/ocr/notes/${noteId}/text`);
        expect(before.status).toBe(200);
        expect(before.body).toEqual({ success: true, text: "", hasOcr: false });

        storeOcrText(becca.getNoteOrThrow(noteId).blobId, "scanned text");

        const after = await api.get<TextRepresentationResponse>(`/api/ocr/notes/${noteId}/text`);
        expect(after.body).toEqual({ success: true, text: "scanned text", hasOcr: true });
    });

    it("returns the text stored for an attachment", async () => {
        const { noteId } = await createTextNote(api, { title: "Has a scan" });
        expect((await api.post(`/api/notes/${noteId}/attachments`, {
            body: { role: "file", mime: "image/png", title: "scan.png", content: "x" }
        })).status).toBe(204);
        const list = await api.get<AttachmentPojo[]>(`/api/notes/${noteId}/attachments`);
        const { attachmentId } = list.body[0];

        storeOcrText(becca.getAttachmentOrThrow(attachmentId).blobId, "text on the scan");

        const res = await api.get<TextRepresentationResponse>(`/api/ocr/attachments/${attachmentId}/text`);
        expect(res.body).toEqual({ success: true, text: "text on the scan", hasOcr: true });
    });

    it("decrypts a protected note's text, and withholds it when the session is closed", async () => {
        const { noteId } = await createTextNote(api, { content: "<p>a protected scan</p>" });
        const note = becca.getNoteOrThrow(noteId);
        note.isProtected = true;

        protectedSessionService.setDataKey(PROTECTED_KEY);
        try {
            // Stored the way the OCR service stores it, so this covers both halves of the round trip.
            storeOcrText(note.blobId, blobService.encryptTextRepresentation("secret scanned text", true));

            const unlocked = await api.get<TextRepresentationResponse>(`/api/ocr/notes/${noteId}/text`);
            expect(unlocked.body).toEqual({ success: true, text: "secret scanned text", hasOcr: true });
        } finally {
            protectedSessionService.resetDataKey();
        }

        // Locked again: the stored ciphertext must not reach the client in place of the text.
        const locked = await api.get<TextRepresentationResponse>(`/api/ocr/notes/${noteId}/text`);
        expect(locked.body).toEqual({ success: true, text: "", hasOcr: false });
    });

    it("404s for a missing note or attachment", async () => {
        const note = await api.get<TextRepresentationResponse>("/api/ocr/notes/missingNote123/text");
        expect(note.status).toBe(404);
        expect(note.body).toEqual({ success: false, message: "Note not found" });

        const attachment = await api.get<TextRepresentationResponse>("/api/ocr/attachments/missingAttachment123/text");
        expect(attachment.status).toBe(404);
        expect(attachment.body).toEqual({ success: false, message: "Attachment not found" });
    });
});
