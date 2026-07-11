import { describe, expect, it } from "vitest";

import { parseManifest, resolveGlyph } from "./IconPackPreview";

// U+E964 is the code point used across the escape-form assertions below.
const E964 = String.fromCodePoint(0xe964);

describe("resolveGlyph", () => {
    it("converts escape-string glyphs to their code point and leaves real characters untouched", () => {
        // Manifests may store the glyph as a literal escape string (CSS-style, any case), not a real char.
        expect(resolveGlyph("\\e964")).toBe(E964);
        expect(resolveGlyph("\\ue964")).toBe(E964);
        expect(resolveGlyph("\\uE964")).toBe(E964);

        // A real glyph character (boxicons-style) is returned as-is.
        const realGlyph = String.fromCodePoint(0xea3f);
        expect(resolveGlyph(realGlyph)).toBe(realGlyph);

        // Non-escape strings must not be mistaken for escapes.
        expect(resolveGlyph("")).toBe("");
        expect(resolveGlyph("bx-sushi")).toBe("bx-sushi");
        expect(resolveGlyph("\\zzzz")).toBe("\\zzzz");

        // An out-of-range code point (regex allows 6 hex digits) is left as-is, not passed to
        // String.fromCodePoint (which throws RangeError above U+10FFFF).
        expect(resolveGlyph("\\110000")).toBe("\\110000");
        expect(resolveGlyph("\\10ffff")).toBe(String.fromCodePoint(0x10ffff));
    });
});

describe("parseManifest", () => {
    it("parses icons, resolving glyphs and defaulting missing or ill-typed fields", () => {
        const result = parseManifest(JSON.stringify({
            icons: {
                mat_2k_plus: { glyph: "\\e964", terms: [ "2k", "plus" ] },
                mat_bare: { glyph: String.fromCodePoint(0xea3f) },   // no terms
                mat_bad: { terms: [ "x", 5 ] }                       // no glyph, non-string term dropped
            }
        }));

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.icons).toEqual([
            { id: "mat_2k_plus", glyph: E964, terms: [ "2k", "plus" ] },
            { id: "mat_bare", glyph: String.fromCodePoint(0xea3f), terms: [] },
            { id: "mat_bad", glyph: "", terms: [ "x" ] }
        ]);
    });

    it("treats blank content as an empty pack and rejects malformed input", () => {
        expect(parseManifest("")).toEqual({ ok: true, icons: [] });
        expect(parseManifest("   ")).toEqual({ ok: true, icons: [] });
        expect(parseManifest(JSON.stringify({ icons: {} }))).toEqual({ ok: true, icons: [] });

        // Invalid JSON, or valid JSON without a usable `icons` object.
        expect(parseManifest("{ not json")).toEqual({ ok: false });
        expect(parseManifest(JSON.stringify({ icons: "nope" }))).toEqual({ ok: false });
        expect(parseManifest(JSON.stringify({ foo: 1 }))).toEqual({ ok: false });
    });
});
