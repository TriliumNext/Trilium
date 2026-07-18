import { describe, expect, it } from "vitest";

import FBlob, { type FBlobRow } from "./fblob.js";

describe("FBlob", () => {
    it("exposes the row fields on the instance", () => {
        const blob = buildBlob({
            blobId: "blob1",
            content: "hello",
            contentLength: 5,
            dateModified: "2026-01-01 00:00:00.000+0000",
            utcDateModified: "2026-01-01 00:00:00.000Z"
        });

        expect(blob.blobId).toBe("blob1");
        expect(blob.content).toBe("hello");
        expect(blob.contentLength).toBe(5);
        expect(blob.dateModified).toBe("2026-01-01 00:00:00.000+0000");
        expect(blob.utcDateModified).toBe("2026-01-01 00:00:00.000Z");
    });

    describe("getJsonContent", () => {
        it("returns the parsed object for valid JSON content", () => {
            const blob = buildBlob({ content: '{"foo":"bar","count":3}' });

            expect(blob.getJsonContent<{ foo: string; count: number }>()).toEqual({ foo: "bar", count: 3 });
        });

        it("returns null for empty content and whitespace-only content", () => {
            expect(buildBlob({ content: "" }).getJsonContent()).toBeNull();
            expect(buildBlob({ content: "   \n\t" }).getJsonContent()).toBeNull();
        });

        it("throws on invalid JSON", () => {
            expect(() => buildBlob({ content: "{not valid json" }).getJsonContent()).toThrow();
        });
    });

    describe("getJsonContentSafely", () => {
        it("returns the parsed object for valid JSON", () => {
            const blob = buildBlob({ content: '{"foo":"bar"}' });

            expect(blob.getJsonContentSafely()).toEqual({ foo: "bar" });
        });

        it("returns null for invalid JSON instead of throwing", () => {
            const blob = buildBlob({ content: "{not valid json" });

            expect(blob.getJsonContentSafely()).toBeNull();
        });
    });
});

function buildBlob(overrides: Partial<FBlobRow> = {}): FBlob {
    const row: FBlobRow = {
        blobId: "blobId",
        content: "",
        contentLength: 0,
        dateModified: "2026-01-01 00:00:00.000+0000",
        utcDateModified: "2026-01-01 00:00:00.000Z",
        ...overrides
    };

    return new FBlob(row);
}
