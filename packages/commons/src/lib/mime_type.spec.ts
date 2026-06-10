import { describe, expect, it } from "vitest";

import { getMimeTypeFromMarkdownName, MIME_TYPE_AUTO, MIME_TYPES_DICT, normalizeMimeTypeForCKEditor } from "./mime_type.js";

describe("normalizeMimeTypeForCKEditor", () => {
    it("collapses non-word characters and underscores into single dashes", () => {
        expect(normalizeMimeTypeForCKEditor("text/x-c++src")).toBe("text-x-c-src");
        expect(normalizeMimeTypeForCKEditor("application/javascript;env=backend")).toBe("application-javascript-env-backend");
        expect(normalizeMimeTypeForCKEditor("a__b")).toBe("a-b");
    });

    it("lowercases the MIME type", () => {
        expect(normalizeMimeTypeForCKEditor("TEXT/HTML")).toBe("text-html");
        expect(normalizeMimeTypeForCKEditor("Text/X-CSrc")).toBe("text-x-csrc");
    });
});

describe("getMimeTypeFromMarkdownName", () => {
    it("returns the definition for a language tag with a single entry", () => {
        const result = getMimeTypeFromMarkdownName("css");
        expect(result).toBeDefined();
        expect(result?.mime).toBe("text/css");
        expect(result?.mdLanguageCode).toBe("css");
    });

    it("returns the first matching entry in dict order when multiple entries share a language tag", () => {
        const result = getMimeTypeFromMarkdownName("javascript");
        expect(result).toBeDefined();
        expect(result?.mdLanguageCode).toBe("javascript");
        // Plain "JavaScript" comes before the Trilium frontend/backend script variants in
        // the dictionary, so it wins — a markdown code fence is not a Trilium script.
        expect(result?.title).toBe("JavaScript");
        expect(result?.mime).toBe("text/javascript");
    });

    it("returns undefined for an unknown language tag", () => {
        expect(getMimeTypeFromMarkdownName("definitely-not-a-language")).toBeUndefined();
    });

    it("returns the same cached reference across calls", () => {
        const first = getMimeTypeFromMarkdownName("css");
        const second = getMimeTypeFromMarkdownName("css");
        expect(second).toBe(first);
    });
});

describe("exports", () => {
    it("exposes the auto MIME type pseudo-value", () => {
        expect(MIME_TYPE_AUTO).toBe("text-x-trilium-auto");
    });

    it("exposes a non-empty frozen MIME types dictionary", () => {
        expect(Array.isArray(MIME_TYPES_DICT)).toBe(true);
        expect(MIME_TYPES_DICT.length).toBeGreaterThan(0);
        expect(Object.isFrozen(MIME_TYPES_DICT)).toBe(true);
    });
});
