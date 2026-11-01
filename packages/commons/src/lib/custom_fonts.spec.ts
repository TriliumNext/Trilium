import { describe, expect, it } from "vitest";

import { customFontFamily, customFontNoteId, customFontOption } from "./custom_fonts.js";

describe("custom font options", () => {
    it("round-trips a note id through the option value, and registers it under a family of its own", () => {
        const option = customFontOption("abc123XYZ_89");
        expect(customFontNoteId(option)).toBe("abc123XYZ_89");
        expect(customFontFamily("abc123XYZ_89")).toBe("trilium-font-abc123XYZ_89");
    });

    it("reads no note out of an option naming a family the browser resolves itself", () => {
        for (const value of [ "theme", "system", "Arial", "Times New Roman", "", undefined, null ]) {
            expect(customFontNoteId(value), String(value)).toBeNull();
        }
    });

    it("reads no note out of a reference that is not one Trilium could have written", () => {
        // The id is built into a CSS family, so anything a stylesheet would read as more than a
        // family name resolves to nothing rather than reaching the declaration.
        for (const value of [ "customFont:", "customFont:abc\"; } body {", "customFont:a b", "customFont:a-b" ]) {
            expect(customFontNoteId(value), value).toBeNull();
        }
    });
});
