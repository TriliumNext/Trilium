import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../services/i18n.js", () => ({
    t: (key: string, options?: { total?: string; prompt?: string; completion?: string }) => {
        if (options?.total) return `${key}(${options.total})`;
        if (options?.completion) return `${key}(${options.prompt}/${options.completion})`;
        return key;
    }
}));
const mocks = vi.hoisted(() => ({ triggerEvent: vi.fn() }));
vi.mock("../../../components/app_context.js", () => ({ default: { triggerEvent: mocks.triggerEvent } }));
vi.mock("../text/ReadOnlyText.js", () => ({
    ReadOnlyTextContent: ({ html }: { html: string }) => <div className="markdown-stub">{html}</div>
}));

import ChatMessage from "./ChatMessage.js";
import type { StoredMessage } from "./llm_chat_types.js";

let host: HTMLElement | undefined;

afterEach(() => {
    if (host) {
        render(null, host);
        host.remove();
        host = undefined;
    }
});

function renderFooter(usage: StoredMessage["usage"]) {
    host = document.body.appendChild(document.createElement("div"));
    const target = host;
    const message: StoredMessage = { id: "m1", role: "assistant", content: "hello", createdAt: "2026-01-01T00:00:00.000Z", usage };
    act(() => render(<ChatMessage message={message} />, target));
    const footer = target.querySelector(".llm-chat-footer");
    expect(footer).not.toBeNull();
    return footer;
}

describe("ChatMessage footer", () => {
    it("names the model, and adds the tokens and cost when the provider reports them", () => {
        const full = renderFooter({ promptTokens: 1200, completionTokens: 300, totalTokens: 1500, cost: 0.5, model: "Claude Sonnet 5", provider: "anthropic" });
        expect(full?.querySelector(".llm-chat-usage-model")?.textContent).toBe("Sonnet 5");
        expect(full?.querySelector(".llm-chat-usage-tokens")?.textContent).toBe("llm_chat.total_tokens(1.5k)");
        expect(full?.querySelector(".llm-chat-usage-cost")?.textContent).toBe("~$0.50");
    });

    it("names the model of a provider that reports no tokens (the ACP agents)", () => {
        const footer = renderFooter({ model: "Gemini 3.8 Flash (Medium)", provider: "antigravity-agent" });
        expect(footer?.querySelector(".llm-chat-usage-model")?.textContent).toBe("Gemini 3.8 Flash (Medium)");
        expect(footer?.querySelector(".llm-chat-usage-tokens")).toBeNull();
    });

    it("counts the prompt as the total when a provider reports only that, and names no model it did not report", () => {
        const footer = renderFooter({ promptTokens: 800 });
        expect(footer?.querySelector(".llm-chat-usage-model")).toBeNull();
        const tokens = footer?.querySelector(".llm-chat-usage-tokens");
        expect(tokens?.textContent).toBe("llm_chat.total_tokens(800)");
        expect(tokens?.getAttribute("title")).toBe("llm_chat.tokens_detail(800/0)");
    });
});

function renderMessage(content: StoredMessage["content"], options: { type?: StoredMessage["type"]; isStreaming?: boolean } = {}) {
    host ??= document.body.appendChild(document.createElement("div"));
    const target = host;
    const message: StoredMessage = { id: "m1", role: "assistant", type: options.type, createdAt: "2026-01-01T00:00:00.000Z", content };
    act(() => render(<ChatMessage message={message} isStreaming={options.isStreaming} />, target));
    return target;
}

describe("ChatMessage thinking", () => {
    it("folds each finished thought to its title or first line, in stream order between the tool calls", () => {
        const target = renderMessage([
            { type: "thinking", content: "**Retrieving PC hostname with command**\n\nI'll read `/etc/hostname`." },
            { type: "tool_call", toolCall: { id: "c1", toolName: "shell", input: {}, result: "pc" } },
            { type: "thinking", content: "The file holds **the** `name`.\n\nNothing else to check." },
            { type: "text", content: "Your PC is called pc." }
        ]);

        const blocks = [...(target.querySelector(".llm-chat-message-content")?.children ?? [])];
        expect(blocks.map(el => el.classList.contains("llm-chat-thinking"))).toEqual([true, false, true, false]);

        const [titled, untitled] = target.querySelectorAll(".llm-chat-thinking");
        expect(titled instanceof HTMLDetailsElement && !titled.open).toBe(true);
        expect(titled.querySelector(".expandable-section-label")?.textContent).toBe("Retrieving PC hostname with command");
        const body = titled.querySelector(".llm-chat-thinking-content .markdown-stub")?.textContent;
        expect(body).toContain("<code>/etc/hostname</code>");
        expect(body).not.toContain("Retrieving PC hostname");
        expect(untitled.querySelector(".expandable-section-label")?.textContent).toBe("The file holds the name.");
        const untitledBody = untitled.querySelector(".llm-chat-thinking-content .markdown-stub")?.textContent;
        expect(untitledBody).toContain("Nothing else to check.");
        expect(untitledBody).not.toContain("holds");
    });

    it("opens a thought with nothing under its label only when the label is cut off", () => {
        const scrollWidth = vi.spyOn(Element.prototype, "scrollWidth", "get").mockReturnValue(100);
        const clientWidth = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
        try {
            const content = [
                { type: "thinking" as const, content: "I should look up who maintains it." },
                { type: "thinking" as const, content: "\n\n**Acknowledging uncertainty on contentPreview meaning**" }
            ];
            let thoughts = [...renderMessage(content).querySelectorAll(".llm-chat-thinking")];
            expect(thoughts.map(el => el.querySelector(".llm-chat-thinking-label")?.textContent)).toEqual([
                "I should look up who maintains it.",
                "Acknowledging uncertainty on contentPreview meaning"
            ]);
            for (const thought of thoughts) {
                expect(thought instanceof HTMLDetailsElement).toBe(true);
                expect(thought.classList.contains("llm-chat-thinking-fits")).toBe(true);
                expect(thought.querySelector(".llm-chat-thinking-content")).toBeNull();
            }

            host && render(null, host);
            scrollWidth.mockReturnValue(250);
            thoughts = [...renderMessage(content).querySelectorAll(".llm-chat-thinking")];
            for (const thought of thoughts) {
                expect(thought.classList.contains("llm-chat-thinking-fits")).toBe(false);
            }
        } finally {
            scrollWidth.mockRestore();
            clientWidth.mockRestore();
        }
    });

    it("shows the thought being generated under a spinner and its latest title, and folds it once the turn moves on", () => {
        const thought = { type: "thinking" as const, content: "**Reading the hostname**\n\nFirst.\n\n**Checking the network**\n\nSecond." };
        let target = renderMessage([thought], { isStreaming: true });
        let card = target.querySelector(".llm-chat-thinking");
        expect(card?.classList.contains("llm-chat-thinking-live")).toBe(true);
        expect(card?.querySelector("details")).toBeNull();
        expect(card?.querySelector(".bx-spin")).not.toBeNull();
        expect(card?.querySelector(".llm-chat-thinking-title")?.textContent).toBe("Checking the network");
        expect(card?.querySelector(".llm-chat-thinking-content .markdown-stub")?.textContent).toContain("Second.");

        target = renderMessage([thought, { type: "tool_call", toolCall: { id: "c1", toolName: "shell", input: {} } }], { isStreaming: true });
        card = target.querySelector(".llm-chat-thinking");
        expect(card?.classList.contains("llm-chat-thinking-live")).toBe(false);
        expect(card instanceof HTMLDetailsElement && !card.open).toBe(true);
        expect(card?.querySelector(".expandable-section-label")?.textContent).toBe("Reading the hostname");
    });

    it("renders a stored thinking message from before thoughts moved into the reply", () => {
        const target = renderMessage("**Retrieving PC hostname with command**\n\nI'll read `/etc/hostname`.", { type: "thinking" });
        const card = target.querySelector(".llm-chat-thinking");
        expect(card?.querySelector(".expandable-section-label")?.textContent).toBe("Retrieving PC hostname with command");
        expect(card?.querySelector(".llm-chat-thinking-content .markdown-stub")?.textContent).toContain("<code>/etc/hostname</code>");
    });

    it("marks only the text after the last thought or tool call as the reply", () => {
        const target = renderMessage([
            { type: "thinking", content: "**Inspecting available tool names**" },
            { type: "text", content: "I'll add a French pangram." },
            { type: "tool_call", toolCall: { id: "c1", toolName: "create_note", input: {}, result: "{}" } },
            { type: "text", content: "Added the French pangram." }
        ]);
        const replies = [...target.querySelectorAll(".llm-chat-reply")];
        expect(replies.map(el => el.textContent)).toEqual([ "Added the French pangram." ]);

        const plain = renderMessage([{ type: "text", content: "Hello." }]);
        expect(plain.querySelector(".llm-chat-reply")).toBeNull();
    });
});

describe("ChatMessage attachments", () => {
    it("opens a PDF in the lightbox and any other file through its link", () => {
        const target = renderMessage([
            { type: "file", attachmentId: "pdf1", mime: "application/pdf", title: "report.pdf", url: "#root/n1?attachmentId=pdf1" },
            { type: "text_file", attachmentId: "txt1", mime: "text/plain", title: "notes.txt", url: "#root/n1?attachmentId=txt1" }
        ]);
        const [ pdf, text ] = [ ...target.querySelectorAll<HTMLAnchorElement>("a.llm-chat-message-file") ];
        expect(pdf?.querySelector(".bxs-file-pdf")).not.toBeNull();
        act(() => pdf?.click());
        expect(mocks.triggerEvent).toHaveBeenCalledExactlyOnceWith("showLightbox", { src: "/api/attachments/pdf1/open", kind: "pdf", title: "report.pdf" });

        expect(text?.getAttribute("href")).toBe("#root/n1?attachmentId=txt1");
        expect(text?.querySelector(".bxs-file-blank")).not.toBeNull();
        act(() => text?.click());
        expect(mocks.triggerEvent).toHaveBeenCalledOnce();
    });
});
