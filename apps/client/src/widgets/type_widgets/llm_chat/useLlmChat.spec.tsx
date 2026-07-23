import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const streamChatCompletionMock = vi.hoisted(() => vi.fn());
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
    useTriliumEvent: vi.fn()
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
