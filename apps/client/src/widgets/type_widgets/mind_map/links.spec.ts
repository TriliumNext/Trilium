import type { Suggestion } from "../../../services/note_autocomplete";
import { describe, expect, it } from "vitest";

import { describeExternalLink, getNodeLinkHref, linkFromSuggestion, renderNodeLinks, suggestionFromLink } from "./links";

/** Builds the anchor Mind Elixir gives a node that carries a link. */
function buildNodes(...links: string[]) {
    const nodes = document.createElement("div");
    for (const link of links) {
        const anchor = document.createElement("a");
        anchor.className = "hyper-link";
        anchor.target = "_blank";
        anchor.innerText = "🔗";
        anchor.setAttribute("href", link);
        nodes.appendChild(anchor);
    }
    return nodes;
}

function anchors(nodes: HTMLElement) {
    return Array.from(nodes.querySelectorAll("a"));
}

describe("linkFromSuggestion", () => {
    it("stores a note as an in-app address and an external link as one we could follow", () => {
        expect(linkFromSuggestion({ notePath: "root/abc123" } as Suggestion)).toBe("#root/abc123");
        expect(linkFromSuggestion({ externalLink: "https://example.com/page" } as Suggestion))
            .toBe("https://example.com/page");
        // A bare host gets the scheme an address bar would give it.
        expect(linkFromSuggestion({ externalLink: "example.com" } as Suggestion)).toBe("https://example.com");

        // Nothing to store: no pick, a pick that is neither, or an address we may not follow.
        expect(linkFromSuggestion(null)).toBeNull();
        expect(linkFromSuggestion({ action: "search-notes" } as Suggestion)).toBeNull();
        expect(linkFromSuggestion({ externalLink: "javascript:alert(1)" } as Suggestion)).toBeNull();
    });
});

describe("suggestionFromLink", () => {
    it("hands a stored link back as the pick it was, for a picker to open on", () => {
        expect(suggestionFromLink("#root/abc123")).toEqual({ notePath: "root/abc123" });
        expect(suggestionFromLink("https://example.com/page")).toEqual({ externalLink: "https://example.com/page" });

        // A node linked to nothing opens the picker on nothing in particular.
        expect(suggestionFromLink(null)).toBeUndefined();
        expect(suggestionFromLink("")).toBeUndefined();

        // What it hands over is what the picker gives back, for every link we would store.
        for (const link of [ "#root/abc123", "https://example.com/page" ]) {
            expect(linkFromSuggestion(suggestionFromLink(link) ?? null)).toBe(link);
        }
    });
});

describe("getNodeLinkHref", () => {
    it("follows notes and addresses, and refuses what Trilium would not open", () => {
        expect(getNodeLinkHref("#root/abc123")).toBe("#root/abc123");
        expect(getNodeLinkHref("https://example.com")).toBe("https://example.com");
        expect(getNodeLinkHref("example.com")).toBe("https://example.com");
        // Schemes Trilium opens are kept as they stand, so a map made elsewhere keeps its links.
        expect(getNodeLinkHref("mailto:someone@example.com")).toBe("mailto:someone@example.com");
        expect(getNodeLinkHref("file:///home/note.pdf")).toBe("file:///home/note.pdf");

        for (const link of [ null, "", "javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "about:blank" ]) {
            expect(getNodeLinkHref(link)).toBeNull();
        }
    });
});

describe("describeExternalLink", () => {
    it("reads an address as its host, and anything else as it stands", () => {
        expect(describeExternalLink("https://example.com/some/page?q=1")).toBe("example.com");
        expect(describeExternalLink("example.com")).toBe("example.com");
        expect(describeExternalLink("mailto:someone@example.com")).toBe("mailto:someone@example.com");
    });
});

describe("renderNodeLinks", () => {
    it("opens a note where the map is, and an address in a tab of its own", () => {
        const nodes = buildNodes("#root/abc123", "https://example.com");

        renderNodeLinks(nodes);

        const [ note, page ] = anchors(nodes);
        expect(note.getAttribute("href")).toBe("#root/abc123");
        expect(note.getAttribute("target")).toBeNull();
        expect(note.rel).toBe("noopener noreferrer");
        // Nothing worth saying about a note that its title would not say better.
        expect(note.getAttribute("title")).toBeNull();

        expect(page.getAttribute("target")).toBe("_blank");
        expect(page.title).toBe("https://example.com");
    });

    it("renders an address it may not follow inert, keeping the node's link visible", () => {
        const nodes = buildNodes("javascript:alert(1)");

        renderNodeLinks(nodes);

        const [ hostile ] = anchors(nodes);
        expect(hostile.getAttribute("href")).toBe("about:blank");
        expect(hostile.textContent).toBe("🔗");
        // Applied again after every layout, so it has to hold up on what it left behind.
        renderNodeLinks(nodes);
        expect(hostile.getAttribute("href")).toBe("about:blank");
    });

    it("gives a bare host the scheme it needs, without touching what the node stores", () => {
        const nodes = buildNodes("example.com");

        renderNodeLinks(nodes);

        expect(anchors(nodes)[0].getAttribute("href")).toBe("https://example.com");
    });
});
