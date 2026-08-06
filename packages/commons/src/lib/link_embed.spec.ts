import { describe, expect, it } from "vitest";

import {
    type BlockChildLike,
    chooseLinkPreviewKind,
    extractYouTubeVideoId,
    isHttpUrl,
    isLocalPreviewImageSrc,
    isUrlAloneInBlock,
    linkPreviewImageName,
    safeHostname,
    safeLinkPreviewHref,
    safeLinkPreviewImageSrc,
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

describe("isLocalPreviewImageSrc / safeLinkPreviewImageSrc", () => {
    it("accepts the inline images and own attachments the metadata pipeline produces", () => {
        expect(isLocalPreviewImageSrc("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
        expect(isLocalPreviewImageSrc("data:image/jpeg;base64,/9j/4AAQ")).toBe(true);
        // The server emits one of these for a vector favicon; an SVG loaded through <img> runs no script.
        expect(isLocalPreviewImageSrc("data:image/svg+xml;base64,PHN2Zz4=")).toBe(true);
        expect(isLocalPreviewImageSrc("api/attachments/abc123DEF_/image/preview.png")).toBe(true);
        expect(isLocalPreviewImageSrc("  api/attachments/abc123/image/x.png  ")).toBe(true);
    });

    it("rejects anything that would make the reader fetch from a third party", () => {
        // The whole point: an <img> fires on load, so a remote favicon/image would announce every
        // reader of the note — and every visitor to it as a shared page — to whoever it points at.
        expect(isLocalPreviewImageSrc("https://evil.test/pixel.gif")).toBe(false);
        expect(isLocalPreviewImageSrc("http://169.254.169.254/latest/meta-data/")).toBe(false);
        expect(isLocalPreviewImageSrc("//evil.test/api/attachments/abc123/image/x.png")).toBe(false);
        expect(isLocalPreviewImageSrc("https://evil.test/api/attachments/abc123/image/x.png")).toBe(false);
        expect(isLocalPreviewImageSrc("/api/attachments/abc123/image/x.png")).toBe(false);
        expect(isLocalPreviewImageSrc("../../api/attachments/abc123/image/x.png")).toBe(false);
    });

    it("rejects non-image data URIs and other schemes", () => {
        expect(isLocalPreviewImageSrc("data:text/html,<script>alert(1)</script>")).toBe(false);
        expect(isLocalPreviewImageSrc("javascript:alert(1)")).toBe(false);
        expect(isLocalPreviewImageSrc("file:///etc/passwd")).toBe(false);
        expect(isLocalPreviewImageSrc(undefined)).toBe(false);
        expect(isLocalPreviewImageSrc("")).toBe(false);
    });

    it("degrades a rejected value to no image at all, so the caller shows its placeholder", () => {
        expect(safeLinkPreviewImageSrc("data:image/png;base64,iVBORw0KGgo=")).toBe("data:image/png;base64,iVBORw0KGgo=");
        expect(safeLinkPreviewImageSrc("  api/attachments/abc123/image/x.png  ")).toBe("api/attachments/abc123/image/x.png");
        expect(safeLinkPreviewImageSrc("https://evil.test/pixel.gif")).toBeUndefined();
        expect(safeLinkPreviewImageSrc(undefined)).toBeUndefined();
    });
});

describe("safeHostname", () => {
    it("names the host, and answers with the address itself where there is no host to name", () => {
        expect(safeHostname("https://en.wikipedia.org/wiki/Russo-Japanese_War")).toBe("en.wikipedia.org");
        // An international host is punycoded by the parse, which is what makes it a file name.
        expect(safeHostname("https://münchen.de/x")).toBe("xn--mnchen-3ya.de");

        // Not an address at all. Both the label a preview falls back to and the title its favicon is
        // stored under come from here, so answering with nothing would leave a preview unnamed.
        expect(safeHostname("not a url")).toBe("not a url");
    });
});

describe("linkPreviewImageName", () => {
    const wiki = "https://en.wikipedia.org/wiki/Russo-Japanese_War";

    it("names the page it is a picture of, readably", () => {
        // The attachment list shows this, where several rows of "image.jpeg" say nothing about
        // which is which.
        expect(linkPreviewImageName(wiki)).toMatch(/^en\.wikipedia\.org-Russo-Japanese-War-[0-9a-f]{8}$/);
    });

    it("spells the site the same way its favicon does", () => {
        // A favicon is titled by the bare hostname, so reducing the hostname here would put the
        // two pictures of one site under two different-looking names in the same list.
        // Matched to where the hostname ends, not merely to where it starts: a bare `startsWith`
        // says nothing about what follows, which is how a host check is normally got wrong.
        expect(linkPreviewImageName(wiki)).toMatch(/^en\.wikipedia\.org-/);
        expect(linkPreviewImageName("https://example.com/")).toMatch(/^example\.com-[0-9a-f]{8}$/);
    });

    it("gives the same URL the same name, which is what makes pasting it twice reuse one picture", () => {
        expect(linkPreviewImageName(wiki)).toBe(linkPreviewImageName(wiki));
    });

    it("never gives two different URLs the same name, however alike they reduce to", () => {
        // The readable part alone could not be the key: reducing a URL to filename-safe characters
        // is lossy, and these two collapse to the same letters.
        const slash = "https://example.com/a/b";
        const dash = "https://example.com/a-b";
        expect(linkPreviewImageName(slash)).not.toBe(linkPreviewImageName(dash));

        // Same page, different query — a different picture as far as the site is concerned.
        expect(linkPreviewImageName("https://example.com/p?id=1")).not.toBe(linkPreviewImageName("https://example.com/p?id=2"));
    });

    it("ignores the fragment, which never changed the picture", () => {
        // Two links into different sections of one page show the cover they both showed anyway.
        expect(linkPreviewImageName(`${wiki}#Background`)).toBe(linkPreviewImageName(wiki));
        expect(linkPreviewImageName(`${wiki}#Aftermath`)).toBe(linkPreviewImageName(wiki));
    });

    it("treats the same page written two ways as one page", () => {
        // A bare host and a trailing slash address the same thing, so they share the picture.
        expect(linkPreviewImageName("https://example.com")).toBe(linkPreviewImageName("https://example.com/"));
    });

    it("stays a usable file name whatever the address looks like", () => {
        const names = [
            linkPreviewImageName("https://example.com/"),
            linkPreviewImageName("https://exämple.com/ünïcode path/§±!"),
            linkPreviewImageName(`https://example.com/${"very-long-segment".repeat(20)}`),
            linkPreviewImageName("not a url at all"),
            linkPreviewImageName("")
        ];

        for (const name of names) {
            // Nothing a file system, a URL or an export archive would have to escape. Dots are in,
            // being what a hostname is written with.
            expect(name, name).toMatch(/^[a-zA-Z0-9.-]+$/);
            expect(name.startsWith("-") || name.startsWith("."), name).toBe(false);
            expect(name.endsWith("-") || name.endsWith("."), name).toBe(false);
            // Bounded, so a long path cannot crowd the attachment list out.
            expect(name.length, name).toBeLessThanOrEqual(70);
        }

        // And these are all different addresses, so they are all different names.
        expect(new Set(names).size).toBe(names.length);
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
