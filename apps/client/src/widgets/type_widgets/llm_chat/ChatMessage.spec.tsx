import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// `ReadOnlyTextContent` pulls in CKEditor + many Trilium hooks; stub it to a div that exposes the
// HTML so we can assert ChatMessage passes the rendered markdown through.
vi.mock("../text/ReadOnlyText.js", () => ({
    ReadOnlyTextContent: ({ html, className }: { html: string; className?: string }) => (
        <div className={`readonly-stub ${className ?? ""}`} data-html={html} />
    )
}));

// `ToolCallCard` is exercised by its own spec; stub it so we only test ChatMessage's branching.
vi.mock("./ToolCallCard.js", () => ({
    default: ({ toolCalls }: { toolCalls: unknown[] }) => (
        <div className="tool-call-card-stub" data-count={toolCalls.length} />
    )
}));

import type { LlmCitation, LlmUsage } from "@triliumnext/commons";

import type { ContentBlock, StoredMessage } from "./llm_chat_types.js";

let container: HTMLDivElement | undefined;

function renderInto(vnode: any) {
    container = document.createElement("div");
    document.body.appendChild(container);
    render(vnode, container);
    return container;
}

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

function makeMessage(overrides: Partial<StoredMessage> = {}): StoredMessage {
    return {
        id: "m1",
        role: "assistant",
        content: "Hello",
        createdAt: "2026-06-05T10:30:00.000Z",
        ...overrides
    };
}

describe("ChatMessage", () => {
    // The component is imported lazily so the hoisted mocks above are wired before module eval.
    async function renderMessage(message: StoredMessage, props: { isStreaming?: boolean; onRetry?: () => void } = {}) {
        const { default: ChatMessage } = await import("./ChatMessage.js");
        return renderInto(<ChatMessage message={message} {...props} />);
    }

    it("renders a plain-string assistant message as markdown via MarkdownContent", async () => {
        const root = await renderMessage(makeMessage({ role: "assistant", content: "**bold** text" }));

        const wrapper = root.querySelector(".llm-chat-message-wrapper-assistant");
        expect(wrapper).not.toBeNull();
        expect(root.querySelector(".llm-chat-message-assistant")).not.toBeNull();

        const stub = root.querySelector(".readonly-stub");
        expect(stub).not.toBeNull();
        // renderMarkdown should have produced a <strong> for the bold text.
        expect(stub?.getAttribute("data-html")).toContain("<strong>");
        // The footer time is always present.
        expect(root.querySelector(".llm-chat-footer-time")).not.toBeNull();
    });

    it("shows a streaming cursor only for streaming assistant string messages", async () => {
        const streaming = await renderMessage(makeMessage({ role: "assistant", content: "x" }), { isStreaming: true });
        expect(streaming.querySelector(".llm-chat-cursor")).not.toBeNull();

        // A streaming user message must NOT get the cursor (role !== assistant).
        if (container) { render(null, container); container.remove(); container = undefined; }
        const userStreaming = await renderMessage(makeMessage({ role: "user", content: "x" }), { isStreaming: true });
        expect(userStreaming.querySelector(".llm-chat-cursor")).toBeNull();
    });

    it("renders thinking messages in a collapsible card with the raw text content", async () => {
        const root = await renderMessage(makeMessage({ type: "thinking", content: "reasoning...", role: "assistant" }), { isStreaming: true });

        expect(root.querySelector(".llm-chat-thinking-card")).not.toBeNull();
        const content = root.querySelector(".llm-chat-thinking-content");
        expect(content?.textContent).toContain("reasoning...");
        // Thinking content is plain text, not markdown-rendered.
        expect(root.querySelector(".readonly-stub")).toBeNull();
        // Streaming cursor present inside thinking content.
        expect(content?.querySelector(".llm-chat-cursor")).not.toBeNull();
    });

    it("renders thinking with block content via getMessageText", async () => {
        const blocks: ContentBlock[] = [
            { type: "text", content: "first " },
            { type: "tool_call", toolCall: { id: "t1", toolName: "search", input: {} } },
            { type: "text", content: "second" }
        ];
        const root = await renderMessage(makeMessage({ type: "thinking", content: blocks, role: "assistant" }));
        const content = root.querySelector(".llm-chat-thinking-content");
        // getMessageText joins only the text blocks.
        expect(content?.textContent).toContain("first second");
    });

    it("renders an error message as a caution admonition with no retry button by default", async () => {
        const root = await renderMessage(makeMessage({ type: "error", content: "boom", role: "assistant" }));
        const admonition = root.querySelector(".admonition.caution.llm-chat-error");
        expect(admonition).not.toBeNull();
        expect(admonition?.textContent).toContain("boom");
        expect(root.querySelector(".llm-chat-error-actions")).toBeNull();
    });

    it("renders a Retry button on an error message and fires onRetry on click", async () => {
        const onRetry = vi.fn();
        const root = await renderMessage(makeMessage({ type: "error", content: "boom", role: "assistant" }), { onRetry });
        const actions = root.querySelector(".llm-chat-error-actions");
        expect(actions).not.toBeNull();
        const button = actions?.querySelector("button");
        expect(button).not.toBeNull();
        button?.click();
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("renders block content: text, image, file, text_file and tool_calls", async () => {
        const blocks: ContentBlock[] = [
            { type: "text", content: "intro" },
            { type: "image", attachmentId: "a1", mime: "image/png", title: "pic", url: "api/img.png" },
            { type: "file", attachmentId: "a2", mime: "application/pdf", title: "doc.pdf", url: "api/doc" },
            { type: "text_file", attachmentId: "a3", mime: "text/plain", title: "notes.txt", url: "api/notes" },
            { type: "tool_call", toolCall: { id: "tc1", toolName: "search", input: {} } },
            { type: "tool_call", toolCall: { id: "tc2", toolName: "search", input: {} } }
        ];
        const root = await renderMessage(makeMessage({ role: "assistant", content: blocks }));

        // Text block rendered via the markdown stub.
        expect(root.querySelector(".readonly-stub")).not.toBeNull();

        // Image link with the SafeImage inside.
        const imageLink = root.querySelector("a.llm-chat-message-image");
        expect(imageLink?.getAttribute("href")).toBe("api/img.png");
        expect(imageLink?.querySelector("img")).not.toBeNull();

        // File + text_file links with distinct icons.
        const fileLinks = root.querySelectorAll("a.llm-chat-message-file");
        expect(fileLinks.length).toBe(2);
        expect(root.querySelector(".bx.bxs-file-pdf")).not.toBeNull();
        expect(root.querySelector(".bx.bxs-file-blank")).not.toBeNull();

        // Consecutive tool_calls grouped into a single ToolCallCard with both calls.
        const toolCard = root.querySelector(".tool-call-card-stub");
        expect(toolCard?.getAttribute("data-count")).toBe("2");
    });

    it("streams the cursor on the last text block only when streaming", async () => {
        const blocks: ContentBlock[] = [
            { type: "text", content: "first" },
            { type: "text", content: "last" }
        ];
        const root = await renderMessage(makeMessage({ role: "assistant", content: blocks }), { isStreaming: true });
        // Exactly one cursor (only the last block).
        expect(root.querySelectorAll(".llm-chat-cursor").length).toBe(1);
    });

    it("renders a citations section with site count, linked and unlinked rows", async () => {
        const citations: LlmCitation[] = [
            { url: "https://www.example.com/a", title: "Example A" },
            { url: "https://example.com/b", title: "Example B" },
            { url: "https://other.org/c" }, // no title -> falls back; provides a second unique site
            { citedText: "a very long cited snippet that should be sliced to eighty characters maximum here and ignored beyond" }, // no url
            { url: "not a valid url::::" } // invalid url -> caught
        ];
        const root = await renderMessage(makeMessage({ role: "assistant", content: "hi", citations }));

        const card = root.querySelector(".llm-chat-citations-card");
        expect(card).not.toBeNull();

        const rows = root.querySelectorAll(".llm-chat-citations-list tr");
        expect(rows.length).toBe(citations.length);

        // First citation is a link.
        const firstLink = rows[0].querySelector("a");
        expect(firstLink?.getAttribute("href")).toBe("https://www.example.com/a");
        // www. is stripped from the displayed domain.
        const firstDomain = rows[0].querySelector(".llm-chat-citation-site");
        expect(firstDomain?.textContent).toBe("example.com");

        // The url-less citation renders a span title and no domain cell.
        const spanRow = Array.from(rows).find(r => r.querySelector("span") && !r.querySelector("a"));
        expect(spanRow).not.toBeNull();
        expect(spanRow?.querySelector(".llm-chat-citation-site")).toBeNull();
    });

    it("does not render a citations section when citations are empty", async () => {
        const root = await renderMessage(makeMessage({ role: "assistant", content: "hi", citations: [] }));
        expect(root.querySelector(".llm-chat-citations-card")).toBeNull();
    });

    it("renders the full usage footer (model, tokens, cost) and shortens token totals", async () => {
        const usage: LlmUsage = {
            promptTokens: 1234,
            completionTokens: 5678,
            totalTokens: 1_500_000,
            cost: 0.123,
            model: "claude-test"
        };
        const root = await renderMessage(makeMessage({ role: "assistant", content: "hi", usage }));

        // The model span carries the model id verbatim (not an i18n string).
        expect(root.querySelector(".llm-chat-usage-model")?.textContent).toBe("claude-test");
        // The tokens span is present (shortenNumber's millions branch was exercised building it).
        expect(root.querySelector(".llm-chat-usage-tokens")).not.toBeNull();
        // The chip icon is rendered inside the tokens span.
        expect(root.querySelector(".llm-chat-usage-tokens .bx.bx-chip")).not.toBeNull();
        // Cost is formatted to 2 decimals (not an i18n string).
        expect(root.querySelector(".llm-chat-usage-cost")?.textContent).toContain("~$0.12");
        // Two separators between model · tokens · cost.
        expect(root.querySelectorAll(".llm-chat-usage-separator").length).toBe(3);
    });

    it("renders usage without model or cost, exercising the thousands branch", async () => {
        const usage: LlmUsage = {
            promptTokens: 10,
            completionTokens: 20,
            totalTokens: 2500
        };
        const root = await renderMessage(makeMessage({ role: "assistant", content: "hi", usage }));

        expect(root.querySelector(".llm-chat-usage-model")).toBeNull();
        expect(root.querySelector(".llm-chat-usage-cost")).toBeNull();
        // Tokens span still rendered; shortenNumber's thousands branch (< 10k, one decimal) ran.
        expect(root.querySelector(".llm-chat-usage-tokens")).not.toBeNull();
        // Only the single separator preceding the tokens span (no model, no cost).
        expect(root.querySelectorAll(".llm-chat-usage-separator").length).toBe(1);
    });

    it("exercises large-thousands and small-number branches of shortenNumber", async () => {
        // >= 10k -> no decimal; the rendered tokens span proves the branch executed.
        const big = await renderMessage(makeMessage({ role: "assistant", content: "hi", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 42000 } }));
        expect(big.querySelector(".llm-chat-usage-tokens")).not.toBeNull();

        if (container) { render(null, container); container.remove(); container = undefined; }

        // < 1000 -> plain toString branch.
        const small = await renderMessage(makeMessage({ role: "assistant", content: "hi", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 999 } }));
        expect(small.querySelector(".llm-chat-usage-tokens")).not.toBeNull();
    });

    it("omits the usage footer when promptTokens is not a number", async () => {
        const root = await renderMessage(makeMessage({ role: "assistant", content: "hi", usage: { totalTokens: 5 } as unknown as LlmUsage }));
        expect(root.querySelector(".llm-chat-usage-tokens")).toBeNull();
        // The footer wrapper still renders with the time.
        expect(root.querySelector(".llm-chat-footer-time")).not.toBeNull();
    });

    it("tags #root/ reference links produced by the chat markdown renderer", async () => {
        const root = await renderMessage(makeMessage({ role: "user", content: "see [My Note](#root/abc123) and [ext](https://x.com)" }));
        const html = root.querySelector(".readonly-stub")?.getAttribute("data-html") ?? "";
        // The custom renderer adds reference-link class to #root/ links only.
        expect(html).toContain('class="reference-link"');
        expect(html).toContain("#root/abc123");
    });

    it("formats `[[noteId]]` wiki-links through the #root/ formatHref callback", async () => {
        const root = await renderMessage(makeMessage({ role: "user", content: "ref [[someNoteId]] here" }));
        const html = root.querySelector(".readonly-stub")?.getAttribute("data-html") ?? "";
        // wikiLink.formatHref turns the id into a #root/<id> href.
        expect(html).toContain("#root/someNoteId");
    });

    it("falls back to empty html when the string content renders to nothing", async () => {
        const root = await renderMessage(makeMessage({ role: "assistant", content: "" }));
        // The MarkdownContent stub still renders; html is the empty fallback.
        const stub = root.querySelector(".readonly-stub");
        expect(stub).not.toBeNull();
        expect(stub?.getAttribute("data-html")).toBe("");
    });
});
