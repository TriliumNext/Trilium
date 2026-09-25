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
