import { describe, expect, it } from "vitest";

import { buildBody, deriveTitle, getOptionalString, needsContainerNote } from "./share_target.js";

describe("getOptionalString", () => {
    it("returns the value for non-blank strings", () => {
        expect(getOptionalString("hello")).toBe("hello");
        expect(getOptionalString("  padded  ")).toBe("  padded  ");
    });

    it("returns undefined for blanks and non-strings", () => {
        expect(getOptionalString("")).toBeUndefined();
        expect(getOptionalString("   ")).toBeUndefined();
        expect(getOptionalString(undefined)).toBeUndefined();
        expect(getOptionalString(null)).toBeUndefined();
        expect(getOptionalString(42)).toBeUndefined();
    });
});

describe("deriveTitle", () => {
    it("prefers the explicit title, trimmed", () => {
        expect(deriveTitle("  My Title  ", "body")).toBe("My Title");
    });

    it("falls back to the first line of the body", () => {
        expect(deriveTitle(undefined, "first line\nsecond line")).toBe("first line");
        expect(deriveTitle("   ", "first line\r\nsecond")).toBe("first line");
    });

    it("falls back to a placeholder when nothing usable is provided", () => {
        expect(deriveTitle(undefined, undefined)).toBe("Shared content");
        expect(deriveTitle(undefined, "   ")).toBe("Shared content");
        expect(deriveTitle(42, undefined)).toBe("Shared content");
    });

    it("truncates long titles to 80 characters", () => {
        const long = "a".repeat(200);
        expect(deriveTitle(long, undefined)).toHaveLength(80);
        expect(deriveTitle(undefined, long)).toHaveLength(80);
    });
});

describe("buildBody", () => {
    it("escapes HTML in shared text and converts newlines to <br>", () => {
        expect(buildBody("hello <b>world</b>\nsecond", undefined)).toBe(
            "<p>hello &lt;b&gt;world&lt;/b&gt;<br>second</p>"
        );
    });

    it("renders a shared url as an escaped anchor", () => {
        expect(buildBody(undefined, "https://example.com/a?x=1&y=2")).toBe(
            `<p><a href="https://example.com/a?x=1&amp;y=2">https://example.com/a?x=1&amp;y=2</a></p>`
        );
    });

    it("includes both text and url when both are present", () => {
        expect(buildBody("note", "https://example.com")).toBe(
            `<p>note</p><p><a href="https://example.com">https://example.com</a></p>`
        );
    });

    it("returns an empty string when nothing is provided", () => {
        expect(buildBody(undefined, undefined)).toBe("");
    });
});

describe("needsContainerNote", () => {
    it("groups under a parent when text/url is present", () => {
        expect(needsContainerNote(true, 0)).toBe(true);
        expect(needsContainerNote(true, 1)).toBe(true);
        expect(needsContainerNote(true, 5)).toBe(true);
    });

    it("groups under a parent when more than one file is shared", () => {
        expect(needsContainerNote(false, 2)).toBe(true);
        expect(needsContainerNote(false, 10)).toBe(true);
    });

    it("does not create a parent for a single lone file", () => {
        expect(needsContainerNote(false, 1)).toBe(false);
    });

    it("does not create a parent when nothing is shared", () => {
        expect(needsContainerNote(false, 0)).toBe(false);
    });
});
