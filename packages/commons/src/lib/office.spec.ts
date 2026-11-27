import { describe, expect, it } from "vitest";

import {
    DOCX_MIME, isConvertibleToText, isDefaultHyperlinkColor, isOfficeMimeType, ODT_MIME,
    OFFICE_FILE_TYPE_HINTS, OFFICE_MIME_TYPES
} from "./office.js";

describe("isOfficeMimeType", () => {
    it("recognizes all office formats and rejects everything else", () => {
        for (const mime of OFFICE_MIME_TYPES) {
            expect(isOfficeMimeType(mime)).toBe(true);
        }
        expect(OFFICE_MIME_TYPES.size).toBe(10);
        expect(isOfficeMimeType("application/epub+zip")).toBe(true);
        expect(isOfficeMimeType("application/pdf")).toBe(false);
        expect(isOfficeMimeType("text/plain")).toBe(false);
        expect(isOfficeMimeType("")).toBe(false);
        expect(isOfficeMimeType(null)).toBe(false);
        expect(isOfficeMimeType(undefined)).toBe(false);
    });

    it("provides parser hints only for MIME types in the supported set", () => {
        for (const mime of Object.keys(OFFICE_FILE_TYPE_HINTS)) {
            expect(OFFICE_MIME_TYPES.has(mime)).toBe(true);
        }
    });
});

describe("isConvertibleToText", () => {
    it("accepts the word-processing formats only", () => {
        for (const mime of [ DOCX_MIME, ODT_MIME, "application/rtf", "text/rtf" ]) {
            expect(isConvertibleToText(mime)).toBe(true);
        }
        expect(isConvertibleToText("application/pdf")).toBe(false);
        expect(isConvertibleToText("application/epub+zip")).toBe(false);
        expect(isConvertibleToText(null)).toBe(false);
    });
});

describe("isDefaultHyperlinkColor", () => {
    it("recognizes the word processors' link colors in hex and rgb(), but not an author's", () => {
        expect(isDefaultHyperlinkColor("#0563C1")).toBe(true);
        expect(isDefaultHyperlinkColor("rgb(0, 0, 128)")).toBe(true);
        expect(isDefaultHyperlinkColor("#138613")).toBe(false);
    });
});
