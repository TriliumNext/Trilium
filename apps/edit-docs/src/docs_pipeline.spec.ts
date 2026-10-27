import { describe, expect, it } from "vitest";

import { normalizeLineEndings } from "./docs_pipeline.js";

describe("normalizeLineEndings", () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    it("rewrites CRLF to LF and keeps a lone CR, LF and trailing CR", () => {
        const input = encoder.encode("# Title\r\n\r\nA line.\nAnother\rline.\r");
        expect(decoder.decode(normalizeLineEndings(input))).toBe("# Title\n\nA line.\nAnother\rline.\r");
    });

    it("keeps multi-byte characters intact", () => {
        const input = encoder.encode("Ștergere\r\nnotițe 😀\r\n");
        expect(decoder.decode(normalizeLineEndings(input))).toBe("Ștergere\nnotițe 😀\n");
    });

    it("returns the same content when there is no CRLF to rewrite", () => {
        const input = encoder.encode("Already normalized.\n");
        expect(normalizeLineEndings(input)).toBe(input);
    });

    it("leaves binary content untouched", () => {
        // A PNG header, whose byte 4 is the NUL that marks the content as binary, followed by
        // pixel data that happens to contain a CRLF pair.
        const input = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x0d, 0x0a, 0xff]);
        expect(normalizeLineEndings(input)).toBe(input);
    });

    it("normalizes content whose NUL sits past the 8000-byte detection window", () => {
        const prefix = "a".repeat(8000);
        const input = encoder.encode(`${prefix}\r\n\0`);
        expect(decoder.decode(normalizeLineEndings(input))).toBe(`${prefix}\n\0`);
    });
});
