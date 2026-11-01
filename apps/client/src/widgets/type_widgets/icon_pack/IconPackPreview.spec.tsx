import { afterEach, describe, expect, it, vi } from "vitest";

import FNote from "../../../entities/fnote";
import { loadIconPackFont, parseManifest, resolveGlyph } from "./IconPackPreview";

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

describe("loadIconPackFont", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    /** A note whose `file`-role attachments are the given (mime, attachmentId) pairs. */
    function fakeNote(attachments: { mime: string; attachmentId: string }[]) {
        return { getAttachmentsByRole: () => Promise.resolve(attachments) } as unknown as FNote;
    }

    function stubFetch(response: Partial<Response>) {
        const fetchMock = vi.fn(() => Promise.resolve(response as Response));
        vi.stubGlobal("fetch", fetchMock);
        vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:font");
        return fetchMock;
    }

    it("downloads the preferred font attachment and returns it as a blob URL", async () => {
        // woff2 wins over woff and ttf regardless of the order the attachments come back in.
        const fetchMock = stubFetch({ ok: true, blob: () => Promise.resolve(new Blob([ "font" ])) });
        const note = fakeNote([
            { mime: "font/ttf", attachmentId: "ttfId" },
            { mime: "font/woff2", attachmentId: "woff2Id" },
            { mime: "font/woff", attachmentId: "woffId" }
        ]);

        expect(await loadIconPackFont(note)).toEqual({ url: "blob:font", format: "woff2" });
        // The bytes must be fetched from the host document — the preview's iframe reaches no backend
        // in standalone — and the URL resolved against its base so Electron's protocol is covered.
        expect(fetchMock).toHaveBeenCalledWith(new URL("api/attachments/download/woff2Id", document.baseURI).href);
    });

    it("falls back to the next best mime and yields null when there is no font or the download fails", async () => {
        stubFetch({ ok: true, blob: () => Promise.resolve(new Blob([ "font" ])) });
        expect(await loadIconPackFont(fakeNote([
            { mime: "application/pdf", attachmentId: "pdfId" },
            { mime: "font/woff", attachmentId: "woffId" }
        ]))).toEqual({ url: "blob:font", format: "woff" });

        expect(await loadIconPackFont(fakeNote([ { mime: "application/pdf", attachmentId: "pdfId" } ]))).toBeNull();
        expect(await loadIconPackFont(fakeNote([]))).toBeNull();

        // A failed download (e.g. the attachment vanished) must not produce a broken @font-face.
        stubFetch({ ok: false, status: 404 });
        expect(await loadIconPackFont(fakeNote([ { mime: "font/woff2", attachmentId: "woff2Id" } ]))).toBeNull();
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
