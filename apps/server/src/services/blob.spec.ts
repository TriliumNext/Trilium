import { describe, expect, it } from "vitest";

import blobService from "./blob.js";
import type { Blob } from "./blob-interface.js";

// These tests lock the exact output of calculateContentHash against known inputs.
// The hash is written to entity_changes.hash and shipped to sync peers — any
// change to the formula (fields, separators, ordering) silently invalidates
// hashes on already-synced blobs, so changes must be deliberate. If a code
// change breaks these expectations, update the expected values AND ensure a
// migration or sync-compatibility plan is in place.
describe("calculateContentHash", () => {
    const baseBlob: Blob = {
        blobId: "blob001",
        content: "hello world",
        utcDateModified: "2026-01-01 00:00:00.000Z"
    };

    it("hashes a blob without textRepresentation to the locked value (no trailing separator)", () => {
        // Must match hash("blobId|content") — same formula used before
        // textRepresentation existed, so pre-OCR blobs don't re-hash on upgrade.
        expect(blobService.calculateContentHash(baseBlob)).toBe("dyhIZrQHB3Bb1bhcZVPld8Q6ONU=");
    });

    it("hashes a blob with textRepresentation to the locked value", () => {
        expect(blobService.calculateContentHash({ ...baseBlob, textRepresentation: "OCR result" }))
            .toBe("CsMYMZbvYJtrGVGJwxnr5w6KbMg=");
    });

    it("treats undefined, null, and empty-string textRepresentation identically", () => {
        const undefinedHash = blobService.calculateContentHash(baseBlob);
        const nullHash = blobService.calculateContentHash({ ...baseBlob, textRepresentation: null });
        const emptyHash = blobService.calculateContentHash({ ...baseBlob, textRepresentation: "" });
        expect(nullHash).toBe(undefinedHash);
        expect(emptyHash).toBe(undefinedHash);
    });

    it("produces different hashes for different blobIds, content, and textRepresentation", () => {
        const base = blobService.calculateContentHash(baseBlob);
        const diffId = blobService.calculateContentHash({ ...baseBlob, blobId: "blob002" });
        const diffContent = blobService.calculateContentHash({ ...baseBlob, content: "other" });
        const diffTextRep = blobService.calculateContentHash({ ...baseBlob, textRepresentation: "x" });
        expect(diffId).not.toBe(base);
        expect(diffContent).not.toBe(base);
        expect(diffTextRep).not.toBe(base);
    });

    it("hashes string and equivalent Buffer content identically", () => {
        const stringHash = blobService.calculateContentHash(baseBlob);
        const bufferHash = blobService.calculateContentHash({ ...baseBlob, content: Buffer.from("hello world") });
        expect(bufferHash).toBe(stringHash);
    });
});
