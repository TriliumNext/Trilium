import { describe, expect, it } from "vitest";

import { normalizeExternalUrl, safeUrlHref } from "./url";

describe("normalizeExternalUrl", () => {
    it("keeps the schemes an address may carry, and defaults the one a bare address is missing", () => {
        expect(normalizeExternalUrl("https://example.com/a?b=c#d")).toBe("https://example.com/a?b=c#d");
        expect(normalizeExternalUrl("http://example.com")).toBe("http://example.com");
        // Followed as stored, a bare address would resolve against Trilium's own origin.
        expect(normalizeExternalUrl("example.com/path")).toBe("https://example.com/path");
        expect(normalizeExternalUrl("  example.com  ")).toBe("https://example.com");
    });

    it("rejects a scheme that would run in Trilium's own origin", () => {
        // A label's value can arrive from an import or a sync peer, so following one must not run it.
        expect(normalizeExternalUrl("javascript:alert(1)")).toBeNull();
        expect(normalizeExternalUrl("JavaScript:alert(1)")).toBeNull();
        expect(normalizeExternalUrl("  javascript:alert(1)")).toBeNull();
        expect(normalizeExternalUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
        expect(normalizeExternalUrl("vbscript:msgbox(1)")).toBeNull();
    });

    it("rejects a value that is no address at all", () => {
        expect(normalizeExternalUrl(undefined)).toBeNull();
        expect(normalizeExternalUrl(null)).toBeNull();
        expect(normalizeExternalUrl("   ")).toBeNull();
    });
});

describe("safeUrlHref", () => {
    it("links what may be followed and renders the rest inert, rather than leaving it out", () => {
        expect(safeUrlHref("example.com")).toBe("https://example.com");
        expect(safeUrlHref("https://example.com")).toBe("https://example.com");
        expect(safeUrlHref("javascript:alert(1)")).toBe("about:blank");
    });

    it("renders a blank href for missing values, an empty cell being no link", () => {
        expect(safeUrlHref(undefined)).toBe("");
        expect(safeUrlHref(null)).toBe("");
        expect(safeUrlHref("   ")).toBe("");
    });
});
