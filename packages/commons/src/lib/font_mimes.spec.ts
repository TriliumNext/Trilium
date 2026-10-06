import { describe, expect, it } from "vitest";

import { FONT_MIMES, isFontMimeType } from "./font_mimes.js";

describe("isFontMimeType", () => {
    it("accepts every listed type, whatever its casing, and nothing else", () => {
        for (const mime of FONT_MIMES) {
            expect(isFontMimeType(mime), mime).toBe(true);
        }
        expect(isFontMimeType("FONT/WOFF2")).toBe(true);

        // EOT and TrueType collections are deliberately absent: no engine loads either through
        // `FontFace`, so neither gets the font icon or a preview that could only fail.
        for (const mime of [ "application/vnd.ms-fontobject", "font/collection", "application/octet-stream", "image/png" ]) {
            expect(isFontMimeType(mime), mime).toBe(false);
        }

        expect(isFontMimeType(undefined)).toBe(false);
        expect(isFontMimeType(null)).toBe(false);
        expect(isFontMimeType("")).toBe(false);
    });
});
