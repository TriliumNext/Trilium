import { beforeEach, describe, expect, it } from "vitest";

import { materializeChatHighlights } from "./chat_highlights_static.js";
import type { HighlightAnchor, StoredMessage } from "./llm_chat_types.js";

/** A rendered preview whose single message carries the given markdown-rendered HTML. */
function buildPreview(html: string) {
    const container = document.createElement("div");
    container.innerHTML = `
        <div class="llm-chat-message-wrapper" data-message-id="m1">
            <div class="llm-chat-message">
                <div class="llm-chat-message-content">
                    <div class="llm-chat-markdown">${html}</div>
                </div>
            </div>
        </div>`;
    return container;
}

function buildMessage(...highlights: HighlightAnchor[]): StoredMessage {
    return {
        id: "m1",
        role: "assistant",
        content: "irrelevant — the anchors resolve against the rendered DOM",
        createdAt: "2026-01-01T00:00:00.000Z",
        highlights
    };
}

/** An anchor over `quotedText`, located by the offsets it was created at. */
function anchor(id: string, start: number, quotedText: string): HighlightAnchor {
    return { id, start, end: start + quotedText.length, quotedText };
}

let container: HTMLElement;

describe("materializeChatHighlights", () => {
    beforeEach(() => {
        container = buildPreview("<p>The quick brown fox</p>");
    });

    it("wraps the highlighted prose in a mark carrying the anchor id", () => {
        materializeChatHighlights(container, [buildMessage(anchor("h1", 4, "quick"))]);

        const marks = container.querySelectorAll("mark.chat-highlight");
        expect(marks).toHaveLength(1);
        expect(marks[0].textContent).toBe("quick");
        expect((marks[0] as HTMLElement).dataset.highlightId).toBe("h1");
        // The surrounding prose is preserved intact.
        expect(container.querySelector("p")?.textContent).toBe("The quick brown fox");
    });

    it("wraps each text node of a highlight that spans element boundaries", () => {
        container = buildPreview("<p>plain <strong>bold</strong> tail</p>");

        // "in bold ta" — starts inside the leading text, crosses <strong>, ends in the trailing text.
        materializeChatHighlights(container, [buildMessage(anchor("h1", 2, "ain bold ta"))]);

        const marks = container.querySelectorAll("mark.chat-highlight");
        expect(marks).toHaveLength(3);
        expect([...marks].map(m => m.textContent)).toEqual(["ain ", "bold", " ta"]);
        // The bold run stays bold: the mark is nested inside it, not wrapped around it.
        expect(container.querySelector("strong > mark.chat-highlight")).not.toBeNull();
        expect(container.querySelector("p")?.textContent).toBe("plain bold tail");
    });

    it("relocates an anchor whose offsets drifted, and drops one whose text is gone", () => {
        // Stale offsets, but the quoted text (with its context) still identifies the run.
        const drifted = { ...anchor("h1", 999, "brown"), prefix: "quick ", suffix: " fox" };
        const orphaned = anchor("h2", 0, "text from a regenerated message");

        materializeChatHighlights(container, [buildMessage(drifted, orphaned)]);

        const marks = container.querySelectorAll("mark.chat-highlight");
        expect(marks).toHaveLength(1);
        expect(marks[0].textContent).toBe("brown");
    });

    it("is idempotent: re-running replaces the marks instead of nesting them", () => {
        const message = buildMessage(anchor("h1", 4, "quick"));

        materializeChatHighlights(container, [message]);
        materializeChatHighlights(container, [message]);

        expect(container.querySelectorAll("mark.chat-highlight")).toHaveLength(1);
        expect(container.querySelector("mark.chat-highlight > mark")).toBeNull();
        expect(container.querySelector("p")?.textContent).toBe("The quick brown fox");
    });

    it("removes the marks when the message no longer has highlights", () => {
        materializeChatHighlights(container, [buildMessage(anchor("h1", 4, "quick"))]);
        materializeChatHighlights(container, [buildMessage()]);

        expect(container.querySelectorAll("mark.chat-highlight")).toHaveLength(0);
        expect(container.querySelector("p")?.textContent).toBe("The quick brown fox");
    });

    it("ignores highlights whose message is not in the preview (e.g. beyond a tooltip's cap)", () => {
        const missing: StoredMessage = { ...buildMessage(anchor("h1", 4, "quick")), id: "not-rendered" };

        expect(() => materializeChatHighlights(container, [missing])).not.toThrow();
        expect(container.querySelectorAll("mark.chat-highlight")).toHaveLength(0);
    });
});
