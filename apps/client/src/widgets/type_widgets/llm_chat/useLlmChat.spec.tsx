import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { streamChatCompletionMock, getLlmViewContextMock } = vi.hoisted(() => ({
    streamChatCompletionMock: vi.fn(),
    getLlmViewContextMock: vi.fn((_noteId: string): { label: string; text: string } | undefined => undefined)
}));
vi.mock("../../../services/llm_chat.js", () => ({
    streamChatCompletion: streamChatCompletionMock
}));

// The chat picker now reads the user's selected models straight from the
// `llmProviders` option (no server fetch), so stub that service.
const optionsGetJsonMock = vi.hoisted(() => vi.fn());
vi.mock("../../../services/options.js", () => ({
    default: { getJson: optionsGetJsonMock }
}));

// useTriliumEvent subscribes to the app-wide event bus; stub it so the hook
// renders without the full app context.
vi.mock("../../react/hooks.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks.js")>()),
    useTriliumEvent: vi.fn(),
    getLlmViewContext: getLlmViewContextMock
}));

// Uninitialized i18n returns undefined; echo the key so labels are assertable.
vi.mock("../../../services/i18n.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/i18n.js")>()),
    t: (key: string) => key
}));

import { useLlmChat } from "./useLlmChat.js";

type LlmChatApi = ReturnType<typeof useLlmChat>;
type LlmChatOptions = Parameters<typeof useLlmChat>[1];

// Provider configs as stored in the llmProviders option; provider/providerId/
// providerName are applied from the config when the hook flattens selectedModels.
const PROVIDERS = [
    { id: "ca_1", name: "Claude Code", provider: "claude-agent", selectedModels: [
        { id: "sonnet", name: "Sonnet", isDefault: true, isSubscription: true }
    ] },
    { id: "a_1", name: "Anthropic", provider: "anthropic", selectedModels: [
        { id: "opus", name: "Opus", pricing: { input: 3, output: 15 } }
    ] },
    { id: "o_1", name: "OpenAI", provider: "openai", selectedModels: [
        { id: "mini", name: "Mini" }
    ] },
    { id: "ol_1", name: "My Ollama", provider: "ollama", selectedModels: [
        { id: "llama3.2", name: "llama3.2 (3.2B)", pricing: { input: 0, output: 0 } }
    ] }
];

describe("useLlmChat", () => {
    let captured: LlmChatApi | undefined;
    let host: HTMLDivElement | undefined;

    function Harness(props: { options?: LlmChatOptions }) {
        captured = useLlmChat(undefined, props.options);
        return null;
    }

    /** The hook API as of the latest render. */
    function api(): LlmChatApi {
        if (!captured) {
            throw new Error("useLlmChat harness has not rendered");
        }
        return captured;
    }

    async function mountChat(options?: LlmChatOptions) {
        host = document.createElement("div");
        document.body.appendChild(host);
        const target = host;
        // Two act passes: render, then flush the model-fetch promise.
        await act(async () => {
            render(<Harness options={options} />, target);
        });
        await act(async () => {});
    }

    beforeEach(() => {
        optionsGetJsonMock.mockReturnValue(PROVIDERS);
        // Minimal successful stream: finish immediately with no content.
        streamChatCompletionMock.mockImplementation(async (_messages, _options, callbacks) => {
            callbacks.onDone();
        });
    });

    afterEach(() => {
        if (host) {
            render(null, host);
            host.remove();
            host = undefined;
        }
        captured = undefined;
        optionsGetJsonMock.mockReset();
        streamChatCompletionMock.mockReset();
    });

    it("selects the default model with its provider and annotates model costs", async () => {
        await mountChat();

        // The default model's provider (type and config id) is recorded alongside
        // the model, so two providers exposing the same model ID stay distinguishable.
        expect(api().selectedModel).toBe("sonnet");
        expect(api().selectedProvider).toBe("claude-agent");
        expect(api().selectedProviderId).toBe("ca_1");
        expect(api().hasProvider).toBe(true);

        const costById = new Map(api().availableModels.map((m) => [m.id, m.costDescription]));
        expect(costById.get("sonnet")).toBe("llm_chat.model_cost_included"); // subscription → "included" label
        expect(costById.get("opus")).toBe("llm.model_cost_per_mtok"); // metered → per-Mtok price label (key echoed by the i18n mock)
        expect(costById.get("mini")).toBeUndefined(); // unknown pricing — no annotation
        expect(costById.get("llama3.2")).toBe("llm_chat.free"); // locally run (zero-priced) → "free" label
    });

    it("groups models per provider, keeping a provider with no selected models as an empty group", async () => {
        // A config migrated from before selection existed: no selectedModels.
        optionsGetJsonMock.mockReturnValue([
            { id: "a_1", name: "Anthropic", provider: "anthropic", selectedModels: [{ id: "opus", name: "Opus" }] },
            { id: "legacy_1", name: "My OpenAI", provider: "openai" }
        ]);
        await mountChat();

        expect(api().modelGroups.map(g => [g.id, g.models.length])).toEqual([
            ["a_1", 1],
            ["legacy_1", 0] // still present so the dropdown can prompt the user to configure it
        ]);
        // A configured-but-empty provider still counts as "has provider".
        expect(api().hasProvider).toBe(true);
        // The empty group contributes no selectable models.
        expect(api().availableModels.map(m => m.id)).toEqual(["opus"]);
    });

    it("sends with the provider recorded at model selection", async () => {
        await mountChat();
        await act(async () => {
            api().setInput("hello");
        });
        await act(async () => {
            await api().handleSubmit(new Event("submit"));
        });

        expect(streamChatCompletionMock).toHaveBeenCalledTimes(1);
        const options = streamChatCompletionMock.mock.calls[0][1];
        expect(options.model).toBe("sonnet");
        expect(options.provider).toBe("claude-agent");
        expect(options.providerId).toBe("ca_1");
    });

    it("sends what the context note's widget reports as the view context", async () => {
        getLlmViewContextMock.mockReturnValue({ label: "PDF", text: "Showing page 3 of 10." });
        await mountChat({ contextNoteId: "note1" });
        await act(async () => {
            api().setSelectedModel("sonnet", "claude-agent", "ca_1");
            api().setInput("hi");
            await api().handleSubmit(new Event("submit"));
        });
        expect(getLlmViewContextMock).toHaveBeenCalledWith("note1");
        expect(streamChatCompletionMock.mock.calls[0][1]).toMatchObject({ contextNoteId: "note1", viewContext: "Showing page 3 of 10." });

        // Switched off, the report stays back while the note context still goes.
        await act(async () => {
            api().setIncludeViewContext(false);
        });
        await act(async () => {
            api().setInput("more");
            await api().handleSubmit(new Event("submit"));
        });
        expect(streamChatCompletionMock.mock.calls[1][1]).toMatchObject({ contextNoteId: "note1", viewContext: undefined });

        // Without a context note nothing is asked and nothing is sent.
        getLlmViewContextMock.mockClear();
        await act(async () => {
            api().setIncludeViewContext(true);
            api().setContextNoteId(undefined);
        });
        await act(async () => {
            api().setInput("again");
            await api().handleSubmit(new Event("submit"));
        });
        expect(getLlmViewContextMock).not.toHaveBeenCalled();
        expect(streamChatCompletionMock.mock.calls[2][1].viewContext).toBeUndefined();
    });

    it("resolves the provider by model ID for chats saved before selectedProvider existed", async () => {
        await mountChat();
        // A pre-selectedProvider chat: content carries a model but no provider.
        await act(async () => {
            api().loadFromContent({ version: 1, messages: [], selectedModel: "opus", enableWebSearch: false });
        });
        expect(api().selectedModel).toBe("opus");
        expect(api().selectedProvider).toBeUndefined();
        expect(api().enableWebSearch).toBe(false);

        await act(async () => {
            api().setInput("hi");
        });
        await act(async () => {
            await api().handleSubmit(new Event("submit"));
        });
        expect(streamChatCompletionMock.mock.calls[0][1].provider).toBe("anthropic");
        expect(streamChatCompletionMock.mock.calls[0][1].providerId).toBe("a_1");
    });

    it("tracks what the next request will carry: reported usage, a restored transcript, and the unsent draft", async () => {
        streamChatCompletionMock.mockImplementation(async (_messages, _options, callbacks) => {
            callbacks.onUsage({ promptTokens: 1200, completionTokens: 300, totalTokens: 1500 });
            callbacks.onDone();
        });
        await mountChat();

        // The draft is counted before it is ever sent: without it the context indicator
        // could go from hidden straight to critical inside a single send.
        await act(async () => {
            api().setInput("word ".repeat(200));
        });
        expect(api().draftTokens).toBeGreaterThan(0);

        await act(async () => {
            await api().handleSubmit(new Event("submit"));
        });
        // The reply counts towards the *next* prompt, so it is tracked alongside it —
        // prompt tokens alone understate the next request by a whole reply.
        expect(api().lastPromptTokens).toBe(1200);
        expect(api().lastCompletionTokens).toBe(300);

        // Reopening a chat restores both from the most recent message carrying usage,
        // so the indicator is right on the first render rather than after a send.
        await act(async () => {
            api().loadFromContent({
                version: 1,
                messages: [
                    { id: "m1", role: "user", content: "hi", createdAt: "2026-01-01T00:00:00.000Z" },
                    {
                        id: "m2",
                        role: "assistant",
                        content: "hello",
                        createdAt: "2026-01-01T00:00:01.000Z",
                        usage: { promptTokens: 90, completionTokens: 10, totalTokens: 100 }
                    }
                ]
            });
        });
        expect(api().lastPromptTokens).toBe(90);
        expect(api().lastCompletionTokens).toBe(10);

        // Emptying the chat empties the accounting with it — the tokens described a
        // conversation that no longer exists.
        await act(async () => {
            api().clearMessages();
        });
        expect(api().lastPromptTokens).toBe(0);
        expect(api().lastCompletionTokens).toBe(0);
    });

    it("round-trips the selected provider through getContent", async () => {
        await mountChat();

        // Loaded without a provider → saved without one (legacy chats stay byte-stable).
        await act(async () => {
            api().loadFromContent({ version: 1, messages: [], selectedModel: "opus" });
        });
        expect(api().getContent()).toMatchObject({ selectedModel: "opus", selectedProvider: undefined, selectedProviderId: undefined });

        // Re-picking a model records its provider (type and config id) and persists both.
        await act(async () => {
            api().setSelectedModel("mini", "openai", "o_1");
        });
        expect(api().getContent()).toMatchObject({ selectedModel: "mini", selectedProvider: "openai", selectedProviderId: "o_1" });
    });
});
