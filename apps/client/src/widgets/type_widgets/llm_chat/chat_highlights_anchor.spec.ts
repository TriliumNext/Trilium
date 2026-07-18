import { describe, expect, it } from "vitest";

import { buildProseProjection, resolveAnchorIndices, resolveAnchorRange } from "./chat_highlights_anchor.js";
import type { HighlightAnchor } from "./llm_chat_types.js";

function anchor(partial: Partial<HighlightAnchor>): HighlightAnchor {
    return { id: "a", start: 0, end: 0, quotedText: "", ...partial };
}

/** Build a message content root (`.llm-chat-message-content`) wrapping rendered markdown. */
function contentRoot(markdownHtml: string, extraHtml = ""): HTMLElement {
    const root = document.createElement("div");
    root.className = "llm-chat-message-content";
    root.innerHTML = `<div class="llm-chat-markdown">${markdownHtml}</div>${extraHtml}`;
    return root;
}

describe("resolveAnchorIndices", () => {
    const text = "the quick brown fox jumps over the lazy dog";

    it("uses the stored offsets when they still frame the quoted text", () => {
        expect(resolveAnchorIndices(text, anchor({ start: 4, end: 9, quotedText: "quick" }))).toEqual({ start: 4, end: 9 });
    });

    it("relocates when the offsets have drifted but the text is unique", () => {
        // Offsets point at the wrong place; there is only one "brown" so it relocates unambiguously.
        expect(resolveAnchorIndices(text, anchor({ start: 0, end: 5, quotedText: "brown" }))).toEqual({ start: 10, end: 15 });
    });

    it("disambiguates repeated text by surrounding context", () => {
        const repeated = "pick the red apple then pick the red cherry";
        const first = resolveAnchorIndices(repeated, anchor({ start: -1, end: -1, quotedText: "red", prefix: "pick the ", suffix: " apple" }));
        const second = resolveAnchorIndices(repeated, anchor({ start: -1, end: -1, quotedText: "red", prefix: "pick the ", suffix: " cherry" }));
        expect(repeated.slice(first?.start, first?.end)).toBe("red");
        expect(repeated.slice(second?.start, second?.end)).toBe("red");
        expect(first?.start).toBe(9);
        expect(second?.start).toBe(33);
    });

    it("returns null when the quoted text is gone (e.g. a regenerated message)", () => {
        expect(resolveAnchorIndices(text, anchor({ start: 4, end: 9, quotedText: "elephant" }))).toBeNull();
    });

    it("returns null for an empty quote", () => {
        expect(resolveAnchorIndices(text, anchor({ quotedText: "" }))).toBeNull();
    });
});

describe("buildProseProjection", () => {
    it("concatenates prose while skipping code, math, and non-markdown text", () => {
        const root = contentRoot(
            `<p>Hello <code>skip()</code> world</p><pre>ignored block</pre><p>bye</p>`,
            `<div class="tool-card">tool noise</div>`
        );
        expect(buildProseProjection(root).text).toBe("Hello  worldbye");
    });

    it("produces a range that reads back the quoted prose", () => {
        const root = contentRoot(`<p>alpha beta gamma</p>`);
        const range = resolveAnchorRange(root, anchor({ start: 6, end: 10, quotedText: "beta" }));
        expect(range?.toString()).toBe("beta");
    });

    it("relocates a drifted anchor to the right prose via its quote", () => {
        const root = contentRoot(`<p>alpha beta gamma</p>`);
        const range = resolveAnchorRange(root, anchor({ start: 999, end: 1000, quotedText: "gamma" }));
        expect(range?.toString()).toBe("gamma");
    });
});
