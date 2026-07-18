import { describe, expect, it } from "vitest";

import {
    type BlockChildLike,
    chooseLinkPreviewKind,
    extractYouTubeVideoId,
    isHttpUrl,
    isUrlAloneInBlock,
    safeLinkPreviewHref,
    YOUTUBE_REGEX
} from "./link_embed.js";

describe("extractYouTubeVideoId", () => {
    it("extracts the id from a standard watch URL", () => {
        expect(extractYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("extracts the id from a youtu.be short link", () => {
        expect(extractYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("extracts the id from an embed URL", () => {
        expect(extractYouTubeVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("extracts the id from a shorts URL", () => {
        expect(extractYouTubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("extracts the id from a watch URL with extra query params around v=", () => {
        expect(
            extractYouTubeVideoId("https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=10s")
        ).toBe("dQw4w9WgXcQ");
    });

    it("returns null for a non-YouTube URL", () => {
        expect(extractYouTubeVideoId("https://example.com/foo")).toBeNull();
    });
});

describe("YOUTUBE_REGEX", () => {
    it("is a RegExp that matches a known YouTube URL", () => {
        expect(YOUTUBE_REGEX).toBeInstanceOf(RegExp);

        const match = "https://www.youtube.com/watch?v=dQw4w9WgXcQ".match(YOUTUBE_REGEX);
        expect(match).not.toBeNull();
        expect(match?.[1]).toBe("dQw4w9WgXcQ");
    });
});

describe("isHttpUrl / safeLinkPreviewHref", () => {
    it("accepts only http(s), which is all the metadata endpoint can ever produce", () => {
        expect(isHttpUrl("https://example.com/page")).toBe(true);
        expect(isHttpUrl("http://localhost:8080/x")).toBe(true);

        expect(isHttpUrl("javascript:alert(1)")).toBe(false);
        expect(isHttpUrl("JavaScript:alert(1)")).toBe(false);
        expect(isHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
        expect(isHttpUrl("vbscript:msgbox(1)")).toBe(false);
        expect(isHttpUrl("file:///etc/passwd")).toBe(false);
        // Not absolute, so not something a stored preview may point at.
        expect(isHttpUrl("/relative/path")).toBe(false);
        expect(isHttpUrl("not-a-url")).toBe(false);
        expect(isHttpUrl(undefined)).toBe(false);
        expect(isHttpUrl("")).toBe(false);
    });

    it("renders a hostile scheme inert instead of linking to it", () => {
        expect(safeLinkPreviewHref("https://example.com/page")).toBe("https://example.com/page");
        expect(safeLinkPreviewHref("javascript:alert(document.cookie)")).toBe("about:blank");
        expect(safeLinkPreviewHref(undefined)).toBe("about:blank");
    });
});

describe("isUrlAloneInBlock", () => {
    const url = "https://youtu.be/dQw4w9WgXcQ";
    const text = (data: string): BlockChildLike => ({ isText: true, data });
    const element = (): BlockChildLike => ({ isText: false });

    it("is true when the URL is the block's only content, ignoring surrounding whitespace", () => {
        // Sole text node.
        expect(isUrlAloneInBlock([text(url)], url)).toBe(true);
        // Trailing space (the character that triggers auto-linking) as its own node.
        expect(isUrlAloneInBlock([text(url), text(" ")], url)).toBe(true);
        // Whitespace-only nodes on either side.
        expect(isUrlAloneInBlock([text("  "), text(url), text("\n")], url)).toBe(true);
        // Adjacent text nodes that together spell the URL.
        expect(isUrlAloneInBlock([text("https://youtu.be/"), text("dQw4w9WgXcQ")], url)).toBe(true);
        // A text child carrying no data contributes nothing, rather than the string "undefined".
        expect(isUrlAloneInBlock([text(url), { isText: true }], url)).toBe(true);
    });

    it("is false when the URL is surrounded by other text or non-text nodes", () => {
        expect(isUrlAloneInBlock([text("Check out "), text(url)], url)).toBe(false);
        expect(isUrlAloneInBlock([text(url), text(" today")], url)).toBe(false);
        // A non-text node (e.g. an inline image or soft break) disqualifies it.
        expect(isUrlAloneInBlock([text(url), element()], url)).toBe(false);
        expect(isUrlAloneInBlock([element()], url)).toBe(false);
        // An empty block contains nothing, let alone the URL.
        expect(isUrlAloneInBlock([], url)).toBe(false);
    });
});

describe("chooseLinkPreviewKind", () => {
    /** The full gesture: a URL left alone on its own line, then Enter. */
    const leftAloneOnItsOwnLine = {
        urlAloneInBlock: true,
        blockIsStandalone: true,
        caretLeftBlock: true
    };

    it("gives a URL left alone on its own line a block preview, keyed by the URL", () => {
        // An embeddable URL becomes a player; anything else becomes a card.
        expect(chooseLinkPreviewKind("youtube", leftAloneOnItsOwnLine)).toBe("embed");
        expect(chooseLinkPreviewKind("opengraph", leftAloneOnItsOwnLine)).toBe("card");
    });

    it("keeps every other placement inline, embeddable or not", () => {
        for (const embedType of ["youtube", "opengraph"]) {
            // Text either side of it: a block preview cannot go mid-sentence.
            expect(chooseLinkPreviewKind(embedType, { ...leftAloneOnItsOwnLine, urlAloneInBlock: false })).toBe("mention");
            // Inside a list, table, quote or heading.
            expect(chooseLinkPreviewKind(embedType, { ...leftAloneOnItsOwnLine, blockIsStandalone: false })).toBe("mention");
            // The caret is still in the block, so the user may yet type on that line — the URL has
            // not been *left* alone, it merely happens to be alone right now.
            expect(chooseLinkPreviewKind(embedType, { ...leftAloneOnItsOwnLine, caretLeftBlock: false })).toBe("mention");
        }
    });
});
