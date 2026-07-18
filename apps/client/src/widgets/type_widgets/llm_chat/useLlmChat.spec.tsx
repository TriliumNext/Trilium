import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAvailableModelsMock = vi.hoisted(() => vi.fn());
const streamChatCompletionMock = vi.hoisted(() => vi.fn());
const executeToolCallMock = vi.hoisted(() => vi.fn());
vi.mock("../../../services/llm_chat.js", () => ({
    getAvailableModels: getAvailableModelsMock,
    streamChatCompletion: streamChatCompletionMock,
    executeToolCall: executeToolCallMock
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

const MODELS = [
    { id: "sonnet", name: "Sonnet", provider: "claude-agent", isDefault: true, isSubscription: true },
    { id: "opus", name: "Opus", provider: "anthropic", costMultiplier: 5 },
    { id: "mini", name: "Mini", provider: "openai" }
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
        getAvailableModelsMock.mockResolvedValue(MODELS);
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
        getAvailableModelsMock.mockReset();
        streamChatCompletionMock.mockReset();
        executeToolCallMock.mockReset();
    });

    it("selects the default model with its provider and annotates model costs", async () => {
        await mountChat();

        // The default model's provider is recorded alongside the model, so two
        // providers exposing the same model ID stay distinguishable.
        expect(api().selectedModel).toBe("sonnet");
        expect(api().selectedProvider).toBe("claude-agent");
        expect(api().hasProvider).toBe(true);

        const costById = new Map(api().availableModels.map((m) => [m.id, m.costDescription]));
        expect(costById.get("sonnet")).toBe("llm_chat.model_cost_included"); // subscription → "included" label
        expect(costById.get("opus")).toBe("5x"); // metered multiplier
        expect(costById.get("mini")).toBeUndefined(); // baseline cost — no annotation
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
    });

    it("round-trips the selected provider through getContent", async () => {
        await mountChat();

        // Loaded without a provider → saved without one (legacy chats stay byte-stable).
        await act(async () => {
            api().loadFromContent({ version: 1, messages: [], selectedModel: "opus" });
        });
        expect(api().getContent()).toMatchObject({ selectedModel: "opus", selectedProvider: undefined });

        // Re-picking a model records its provider and persists it.
        await act(async () => {
            api().setSelectedModel("mini", "openai");
        });
        expect(api().getContent()).toMatchObject({ selectedModel: "mini", selectedProvider: "openai" });
    });
});

describe("useLlmChat tool approval", () => {
    let captured: LlmChatApi | undefined;
    let host: HTMLDivElement | undefined;

    function Harness() {
        captured = useLlmChat(undefined, {});
        return null;
    }

    function api(): LlmChatApi {
        if (!captured) throw new Error("harness not rendered");
        return captured;
    }

    async function mountChat() {
        host = document.createElement("div");
        document.body.appendChild(host);
        const target = host;
        await act(async () => { render(<Harness />, target); });
        await act(async () => {});
    }

    function pendingApprovalContent() {
        return {
            version: 1 as const,
            messages: [{
                id: "m1",
                role: "assistant" as const,
                content: [{
                    type: "tool_call" as const,
                    toolCall: { id: "tc1", toolName: "create_note", input: { title: "T" }, requiresApproval: true }
                }],
                createdAt: new Date().toISOString()
            }]
        };
    }

    function firstToolCall() {
        const [msg] = api().messages;
        const blocks = msg.content as Array<{ type: string; toolCall: { id: string; result?: string; isError?: boolean; rejected?: boolean } }>;
        return blocks[0].toolCall;
    }

    beforeEach(() => {
        getAvailableModelsMock.mockResolvedValue(MODELS);
    });

    afterEach(() => {
        if (host) {
            render(null, host);
            host.remove();
            host = undefined;
        }
        captured = undefined;
        getAvailableModelsMock.mockReset();
        executeToolCallMock.mockReset();
    });

    it("approveToolCall executes the tool server-side and stores its result", async () => {
        executeToolCallMock.mockResolvedValue({ result: '{"ok":true}', isError: undefined });
        await mountChat();
        await act(async () => { api().loadFromContent(pendingApprovalContent()); });

        await act(async () => { await api().approveToolCall("tc1"); });

        expect(executeToolCallMock).toHaveBeenCalledWith("create_note", { title: "T" });
        expect(firstToolCall().result).toBe('{"ok":true}');
    });

    it("ignores a second approval while the first request is in flight", async () => {
        let resolveExec!: (v: unknown) => void;
        executeToolCallMock.mockReturnValue(new Promise((r) => { resolveExec = r; }));
        await mountChat();
        await act(async () => { api().loadFromContent(pendingApprovalContent()); });

        await act(async () => {
            const first = api().approveToolCall("tc1");
            const second = api().approveToolCall("tc1");
            resolveExec({ result: "done" });
            await Promise.all([first, second]);
        });

        expect(executeToolCallMock).toHaveBeenCalledTimes(1);
    });

    it("rejectToolCall marks the call rejected without executing anything", async () => {
        await mountChat();
        await act(async () => { api().loadFromContent(pendingApprovalContent()); });

        await act(async () => { api().rejectToolCall("tc1"); });

        expect(firstToolCall().rejected).toBe(true);
        expect(executeToolCallMock).not.toHaveBeenCalled();
    });

    it("persists the tool permission mode and sends it with the stream", async () => {
        streamChatCompletionMock.mockImplementation(async (_m, _o, callbacks) => { callbacks.onDone(); });
        await mountChat();

        // Non-default mode is persisted; the default "ask" is omitted.
        await act(async () => { api().setToolPermissionMode("auto"); });
        expect(api().getContent().toolPermissionMode).toBe("auto");

        await act(async () => { api().setInput("hi"); });
        await act(async () => { await api().handleSubmit(new Event("submit")); });
        expect(streamChatCompletionMock.mock.calls[0][1].toolPermissionMode).toBe("auto");

        await act(async () => { api().setToolPermissionMode("ask"); });
        expect(api().getContent().toolPermissionMode).toBeUndefined();

        // Saved chats restore their mode; missing flag falls back to "ask".
        await act(async () => { api().loadFromContent({ version: 1, messages: [], toolPermissionMode: "auto" }); });
        expect(api().toolPermissionMode).toBe("auto");
        await act(async () => { api().loadFromContent({ version: 1, messages: [] }); });
        expect(api().toolPermissionMode).toBe("ask");
    });
});
