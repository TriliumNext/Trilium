import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { encodeUtf8 } from "../../../services/utils/binary.js";
import { buildShareNote, stubShareSql } from "../../../test/shaca_mocking.js";
import shaca from "../shaca.js";
import SAttachment from "./sattachment.js";

const PNG_BYTES = new Uint8Array([ 0x89, 0x50, 0x4e, 0x47 ]);
const BLOBS: Record<string, { content: string | Uint8Array | null }> = {
    textBlob: { content: encodeUtf8("plain text") },
    emptyBlob: { content: null },
    imageBlob: { content: PNG_BYTES }
};

describe("SAttachment", () => {
    let restore: () => void;

    beforeEach(() => {
        shaca.reset();
        restore = stubShareSql({ getRow: (_query, [ blobId ]) => BLOBS[blobId] });
    });

    afterEach(() => {
        restore();
    });

    it("registers itself on its owner and describes itself", () => {
        const owner = buildShareNote({ id: "owner" });
        const attachment = new SAttachment([
            "att1", "owner", "image", "image/png", "Picture", "imageBlob", "2025-01-01"
        ]);

        expect(attachment.note).toBe(owner);
        expect(owner.getAttachments()).toEqual([ attachment ]);
        expect(shaca.getAttachment("att1")).toBe(attachment);
        expect(attachment.getPojo()).toEqual({
            attachmentId: "att1",
            role: "image",
            mime: "image/png",
            title: "Picture",
            blobId: "imageBlob",
            utcDateModified: "2025-01-01"
        });
    });

    it("reads text blobs as strings, binary blobs as bytes, and reports a missing blob", () => {
        buildShareNote({ id: "owner" });
        const attach = (id: string, mime: string, blobId: string) =>
            new SAttachment([ id, "owner", "file", mime, id, blobId, "2025-01-01" ]);

        const text = attach("text", "text/plain", "textBlob");
        expect(text.hasStringContent()).toBe(true);
        expect(text.getContent()).toBe("plain text");
        expect(attach("empty", "text/plain", "emptyBlob").getContent()).toBe("");

        const image = attach("image", "image/png", "imageBlob");
        expect(image.hasStringContent()).toBe(false);
        expect(image.getContent()).toBe(PNG_BYTES);

        const missing = attach("missing", "text/plain", "noSuchBlob");
        expect(missing.getContent(true)).toBeUndefined();
        expect(() => missing.getContent()).toThrow(
            "Cannot find blob for attachment 'missing', blob 'noSuchBlob'"
        );
    });
});
