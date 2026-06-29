import { describe, expect, it } from "vitest";

import BBlob from "./bblob.js";
import { getContext } from "../../services/context.js";
import { getSql } from "../../services/sql/index.js";

describe("BBlob static metadata", () => {
    it("exposes entityName, primaryKeyName and hashedProperties", () => {
        expect(BBlob.entityName).toBe("blobs");
        expect(BBlob.primaryKeyName).toBe("blobId");
        expect(BBlob.hashedProperties).toContain("content");
        expect(BBlob.hashedProperties).toContain("blobId");
    });
});

describe("BBlob instance", () => {
    it("populates fields from the row via the constructor", () => {
        const blob = new BBlob({
            blobId: "bblob-spec-1",
            content: "x",
            contentLength: 1,
            textRepresentation: "x-text",
            dateModified: "2025-06-27 14:10:39.688+0300",
            utcDateModified: "2025-06-27 14:10:39.688+0300"
        });

        expect(blob.blobId).toBe("bblob-spec-1");
        expect(blob.content).toBe("x");
        expect(blob.contentLength).toBe(1);
        expect(blob.textRepresentation).toBe("x-text");
    });

    it("getPojo returns the full shape including contentLength", () => {
        const blob = new BBlob({
            blobId: "bblob-spec-2",
            content: "hello",
            contentLength: 5,
            textRepresentation: "hello",
            dateModified: "2025-06-27 14:10:39.688+0300",
            utcDateModified: "2025-06-27 14:10:39.688+0300"
        });

        const pojo = blob.getPojo();
        expect(pojo).toEqual({
            blobId: "bblob-spec-2",
            content: "hello",
            contentLength: 5,
            textRepresentation: "hello",
            dateModified: "2025-06-27 14:10:39.688+0300",
            utcDateModified: "2025-06-27 14:10:39.688+0300"
        });
    });

    it("getPojo falls back to null for empty content and missing text representation", () => {
        const blob = new BBlob({
            blobId: "bblob-spec-3",
            content: "",
            contentLength: 0,
            textRepresentation: null,
            dateModified: "2025-06-27 14:10:39.688+0300",
            utcDateModified: "2025-06-27 14:10:39.688+0300"
        });

        const pojo = blob.getPojo();
        expect(pojo.content).toBeNull();
        expect(pojo.textRepresentation).toBeNull();
    });
});

describe("BBlob save (getPojoToSave omits contentLength)", () => {
    it("persists a row without the contentLength column", () => {
        const blobId = "bblob-spec-save-1";
        const blob = new BBlob({
            blobId,
            content: "persisted-content",
            contentLength: 17,
            textRepresentation: null,
            dateModified: "2025-06-27 14:10:39.688+0300",
            utcDateModified: "2025-06-27 14:10:39.688+0300"
        });

        getContext().init(() => blob.save());

        const row = getSql().getRow<Record<string, unknown>>(
            "SELECT * FROM blobs WHERE blobId = ?",
            [blobId]
        );
        expect(row).toBeDefined();
        expect(row?.blobId).toBe(blobId);
        // getPojoToSave strips contentLength, so the persisted row has no such column value beyond schema defaults.
        expect("contentLength" in (row ?? {})).toBe(false);
    });
});
