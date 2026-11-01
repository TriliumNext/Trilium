import { createRef, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../services/i18n.js", () => ({
    t: (key: string) => key
}));
vi.mock("../text/ReadOnlyText.js", () => ({
    ReadOnlyTextContent: ({ html }: { html: string }) => <div className="markdown-stub">{html}</div>
}));

import ChatMessageList from "./ChatMessageList.js";
import type { ContentBlock } from "./llm_chat_types.js";
import type { UseLlmChatReturn } from "./useLlmChat.js";

let host: HTMLElement | undefined;

afterEach(() => {
    if (host) {
        render(null, host);
        host.remove();
        host = undefined;
    }
});

let chat: UseLlmChatReturn | undefined;

/** Render the list for a streaming turn with nothing stored yet. */
function renderStreamingTurn(streamingBlocks: ContentBlock[], streamingStatus: string | null = "starting_agent") {
    host = document.body.appendChild(document.createElement("div"));
    const target = host;
    chat = {
        messages: [],
        isStreaming: true,
        streamingStatus,
        streamingBlocks,
        pendingCitations: [],
        retryLast: () => undefined,
        scrollContainerRef: createRef(),
        messagesEndRef: createRef(),
        bottomSpacerRef: createRef(),
        showScrollToBottom: false,
        scrollToBottom: () => undefined
    } as unknown as UseLlmChatReturn;
    act(() => render(<ChatMessageList chat={chat as UseLlmChatReturn} emptyStateText="empty" />, target));
    return target;
}

/** Render the turn `renderStreamingTurn` started again, with the blocks it has streamed since. */
function rerenderStreamingTurn(streamingBlocks: ContentBlock[]) {
    const target = host;
    if (!target || !chat) throw new Error("No streaming turn rendered");
    chat = { ...chat, streamingBlocks };
    act(() => render(<ChatMessageList chat={chat as UseLlmChatReturn} emptyStateText="empty" />, target));
}

describe("ChatMessageList stream status", () => {
    it("names what the turn waits on until the reply's first content replaces it", () => {
        const waiting = renderStreamingTurn([]);
        expect(waiting.querySelector(".chat-stream-status")?.textContent).toBe("llm_chat.stream_status.starting_agent");
        render(null, waiting);
        waiting.remove();

        const replying = renderStreamingTurn([ { type: "text", content: "Hello" } ]);
        expect(replying.querySelector(".markdown-stub")?.textContent).toContain("Hello");
        expect(replying.querySelector(".chat-stream-status")).toBeNull();
    });

    it("says it waits for the reply when the server names nothing slower", () => {
        const row = renderStreamingTurn([], null).querySelector(".chat-stream-status");
        expect(row?.textContent).toBe("llm_chat.stream_status.waiting_for_reply");
        // The delayed fade-in keeps a quick reply from flashing the row.
        expect(row?.classList.contains("chat-stream-status-waiting")).toBe(true);
    });
});

describe("ChatMessageList idle stream", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const idleRow = (target: HTMLElement) => target.querySelector(".llm-chat-stream-idle");

    it("says it is still working once the reply stops changing, until it moves again", () => {
        const target = renderStreamingTurn([ { type: "text", content: "Hello" } ], null);
        act(() => { vi.advanceTimersByTime(1900); });
        expect(idleRow(target)).toBeNull();

        act(() => { vi.advanceTimersByTime(100); });
        // A line of the reply itself, shaped like the streaming thought and the tool calls above it.
        const row = target.querySelector(".llm-chat-message-content > .expandable-line.llm-chat-stream-idle > .expandable-line-header");
        expect(row?.textContent).toBe("llm_chat.stream_status.still_working");
        expect(row?.firstElementChild?.classList.contains("bx-spin")).toBe(true);

        rerenderStreamingTurn([ { type: "text", content: "Hello there" } ]);
        expect(idleRow(target)).toBeNull();
    });

    it("leaves a thought or a running tool to show its own spinner", () => {
        const thinking = renderStreamingTurn([ { type: "thinking", content: "Hmm" } ], null);
        act(() => { vi.advanceTimersByTime(5000); });
        expect(thinking.querySelector(".llm-chat-thinking-live")).not.toBeNull();
        expect(idleRow(thinking)).toBeNull();

        rerenderStreamingTurn([ { type: "tool_call", toolCall: { id: "1", toolName: "web_search", input: { query: "x" } } } ]);
        act(() => { vi.advanceTimersByTime(5000); });
        expect(thinking.querySelector(".llm-chat-tool-call")).not.toBeNull();
        expect(idleRow(thinking)).toBeNull();
    });
});
