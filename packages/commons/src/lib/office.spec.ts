import { describe, expect, it } from "vitest";

import { isOfficeMimeType, OFFICE_FILE_TYPE_HINTS, OFFICE_MIME_TYPES } from "./office.js";

describe("isOfficeMimeType", () => {
    it("recognizes all office formats and rejects everything else", () => {
        for (const mime of OFFICE_MIME_TYPES) {
            expect(isOfficeMimeType(mime)).toBe(true);
        }
        expect(OFFICE_MIME_TYPES.size).toBe(8);
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
