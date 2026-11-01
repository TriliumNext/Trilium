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
/** The `llmWebSearchProvider` option, unset unless a test picks a search provider. */
const webSearchProvider = vi.hoisted(() => ({ id: undefined as string | undefined }));
/** The `llmPermissionMode` option, and every write to it. */
const permissionModeOption = vi.hoisted(() => ({ value: "", save: vi.fn(async (_name: string, _value: unknown) => {}) }));
vi.mock("../../../services/options.js", () => ({
    default: {
        getJson: optionsGetJsonMock,
        get: (name: string) => (name === "llmPermissionMode" ? permissionModeOption.value : webSearchProvider.id),
        save: permissionModeOption.save
    }
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
        webSearchProvider.id = undefined;
        if (host) {
            render(null, host);
            host.remove();
            host = undefined;
        }
        captured = undefined;
        optionsGetJsonMock.mockReset();
        streamChatCompletionMock.mockReset();
    });

    it("focuses the input at once when it is ready, or as soon as it registers", async () => {
        await mountChat();
        const early = { appendBlockQuote: vi.fn(), focus: vi.fn() };
        api().focusInput();
        api().registerInputEditor(early);
        expect(early.focus).toHaveBeenCalledOnce();

        // The request is spent: registering again does not steal the focus a second time.
        const ready = { appendBlockQuote: vi.fn(), focus: vi.fn() };
        api().registerInputEditor(ready);
        expect(ready.focus).not.toHaveBeenCalled();
        api().focusInput();
        expect(ready.focus).toHaveBeenCalledOnce();
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

    it("sends the chosen search provider, unless the model runs its own agent loop", async () => {
        optionsGetJsonMock.mockReturnValue([ ...PROVIDERS, { id: "s1", name: "Tavily", provider: "tavily", kind: "search" } ]);
        webSearchProvider.id = "s1";
        await mountChat();
        const send = async () => {
            await act(async () => {
                api().setInput("hello");
            });
            await act(async () => {
                await api().handleSubmit(new Event("submit"));
            });
            return streamChatCompletionMock.mock.calls.at(-1)?.[1];
        };

        // The default model is Claude Code, which searches with its own tools.
        expect(await send()).toMatchObject({ enableWebSearch: false, webSearchProviderId: undefined });

        await act(async () => {
            api().setSelectedModel("llama3.2", "ollama", "ol_1");
        });
        expect(await send()).toMatchObject({ enableWebSearch: true, webSearchProviderId: "s1" });
    });

    it("holds back a message whose attachments the model cannot read, until the model changes", async () => {
        optionsGetJsonMock.mockReturnValue([
            { id: "ds_1", name: "DeepSeek", provider: "deepseek", selectedModels: [
                { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", isDefault: true, attachmentKinds: [] }
            ] },
            { id: "a_1", name: "Anthropic", provider: "anthropic", selectedModels: [{ id: "opus", name: "Opus" }] }
        ]);
        await mountChat();
        expect(api().selectedModel).toBe("deepseek-v4-pro");
        await act(async () => {
            api().setInput("Summarize this");
            api().addPendingAttachment({ type: "file", attachmentId: "pdf1", mime: "application/pdf", title: "report.pdf", url: "#" });
        });

        await act(async () => {
            await api().handleSubmit(new Event("submit"));
        });
        expect(streamChatCompletionMock).not.toHaveBeenCalled();
        expect(api().pendingAttachments).toHaveLength(1);

        await act(async () => {
            api().setSelectedModel("opus", "anthropic", "a_1");
        });
        await act(async () => {
            await api().handleSubmit(new Event("submit"));
        });
        expect(streamChatCompletionMock).toHaveBeenCalledOnce();
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

    it("counts no tokens for a turn whose provider reports only the model", async () => {
        const reports = [
            { promptTokens: 1200, completionTokens: 300, totalTokens: 1500 },
            { model: "GPT-5 mini", provider: "copilot-agent" }
        ];
        streamChatCompletionMock.mockImplementation(async (_messages, _options, callbacks) => {
            callbacks.onUsage(reports.shift());
            callbacks.onDone();
        });
        await mountChat();

        for (const text of ["first", "second"]) {
            await act(async () => {
                api().setInput(text);
            });
            await act(async () => {
                await api().handleSubmit(new Event("submit"));
            });
        }
        // The first turn's counts would otherwise stand in for a request they never described.
        expect(api().lastPromptTokens).toBe(0);
        expect(api().lastCompletionTokens).toBe(0);
    });

    it("keeps, saves and sends the reasoning effort, only for a model that has levels", async () => {
        optionsGetJsonMock.mockReturnValue([
            ...PROVIDERS,
            { id: "ag_1", name: "Google Antigravity", provider: "antigravity-agent", selectedModels: [
                { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", reasoningEfforts: [ "low", "medium", "high" ], defaultReasoningEffort: "high" }
            ] }
        ]);
        await mountChat();
        const sentOptions = async () => {
            streamChatCompletionMock.mockClear();
            await act(async () => {
                api().setInput("hi");
            });
            await act(async () => {
                await api().handleSubmit(new Event("submit"));
            });
            return streamChatCompletionMock.mock.calls[0][1];
        };

        await act(async () => {
            api().setSelectedModel("gemini-3.8-flash", "antigravity-agent", "ag_1");
        });
        expect(api().reasoningEffort).toBeUndefined();
        expect((await sentOptions()).reasoningEffort).toBeUndefined();

        await act(async () => {
            api().setReasoningEffort("low");
        });
        expect(api().getContent()).toMatchObject({ reasoningEffort: "low" });
        expect((await sentOptions()).reasoningEffort).toBe("low");

        // A model without levels is sent none.
        await act(async () => {
            api().setSelectedModel("opus", "anthropic", "a_1");
        });
        expect((await sentOptions()).reasoningEffort).toBeUndefined();

        // A saved chat brings its level back.
        await act(async () => {
            api().loadFromContent({ version: 1, messages: [], selectedModel: "gemini-3.8-flash", selectedProvider: "antigravity-agent", selectedProviderId: "ag_1", reasoningEffort: "medium" });
        });
        expect(api().reasoningEffort).toBe("medium");
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

    it("keeps thoughts in stream order inside the reply, and never sends them back", async () => {
        streamChatCompletionMock.mockImplementationOnce(async (_messages, _options, cb) => {
            cb.onThinking("**Reading** the ");
            cb.onThinking("hostname");
            cb.onToolUse("c1", "shell", {});
            cb.onToolResult("c1", "shell", "pc", false);
            cb.onThinking("Got it.");
            cb.onChunk("Your PC is pc.");
            cb.onDone();
        });
        await mountChat();
        await act(async () => {
            api().loadFromContent({
                version: 1,
                messages: [
                    { id: "m1", role: "user", content: "hi", createdAt: "2026-01-01T00:00:00.000Z" },
                    { id: "m2", role: "assistant", type: "thinking", content: "old thoughts", createdAt: "2026-01-01T00:00:01.000Z" },
                    { id: "m3", role: "assistant", content: "hello", createdAt: "2026-01-01T00:00:02.000Z" }
                ]
            });
        });

        for (const text of ["name?", "thanks"]) {
            await act(async () => {
                api().setInput(text);
            });
            await act(async () => {
                await api().handleSubmit(new Event("submit"));
            });
        }

        expect(api().messages[4]).toMatchObject({
            role: "assistant",
            content: [
                { type: "thinking", content: "**Reading** the hostname" },
                { type: "tool_call", toolCall: { id: "c1", result: "pc" } },
                { type: "thinking", content: "Got it." },
                { type: "text", content: "Your PC is pc." }
            ]
        });
        expect(api().messages.filter(m => m.type === "thinking").map(m => m.id)).toEqual(["m2"]);

        const sent = (call: number) => (streamChatCompletionMock.mock.calls[call][0] as { content: unknown }[]).map(m => m.content);
        expect(sent(0)).toEqual(["hi", "hello", "name?"]);
        expect(sent(1)).toEqual(["hi", "hello", "name?", "Your PC is pc.", "thanks"]);
    });

    it("keeps what a turn waits on until the turn ends", async () => {
        let callbacks: { onStatus: (status: string) => void } | undefined;
        let finish: () => void = () => undefined;
        streamChatCompletionMock.mockImplementation(async (_messages, _options, cb) => {
            callbacks = cb;
            await new Promise<void>(resolve => { finish = resolve; });
            cb.onDone();
        });
        await mountChat();

        await act(async () => {
            api().setInput("hi");
        });
        await act(async () => {
            void api().handleSubmit(new Event("submit"));
        });
        await act(async () => {
            callbacks?.onStatus("starting_agent");
        });
        expect(api().streamingStatus).toBe("starting_agent");

        await act(async () => {
            finish();
        });
        expect(api().isStreaming).toBe(false);
        expect(api().streamingStatus).toBeNull();
    });

    it("holds a tool call for the user's answer, sends that answer once, and keeps a denial in the reply", async () => {
        type Answer = (approved: boolean) => Promise<void>;
        let callbacks: {
            onToolApprovalRequest: (request: { toolCallId: string; toolName: string; toolInput: Record<string, unknown> }, answer: Answer) => void;
            onToolResult: (toolCallId: string, toolName: string, result: string, isError?: boolean) => void;
        } | undefined;
        let finish: () => void = () => undefined;
        streamChatCompletionMock.mockImplementation(async (_messages, _options, cb) => {
            callbacks = cb;
            await new Promise<void>(resolve => { finish = resolve; });
            cb.onDone();
        });
        const answers = { c1: vi.fn<Answer>(async () => {}), c2: vi.fn<Answer>(async () => {}) };
        await mountChat();
        await act(async () => {
            api().setInput("tidy up");
        });
        await act(async () => {
            void api().handleSubmit(new Event("submit"));
        });

        // A request can arrive before the `tool_use` of its call, so it brings the call along.
        await act(async () => {
            callbacks?.onToolApprovalRequest({ toolCallId: "c1", toolName: "delete_note", toolInput: { noteId: "a" } }, answers.c1);
            callbacks?.onToolApprovalRequest({ toolCallId: "c2", toolName: "delete_note", toolInput: { noteId: "b" } }, answers.c2);
        });
        expect(api().streamingBlocks).toMatchObject([
            { type: "tool_call", toolCall: { id: "c1", input: { noteId: "a" }, approval: "pending" } },
            { type: "tool_call", toolCall: { id: "c2", approval: "pending" } }
        ]);

        await act(async () => {
            api().answerToolCall("c1", false);
            api().answerToolCall("c1", true);
            callbacks?.onToolResult("c1", "delete_note", JSON.stringify({ error: "declined" }), true);
        });
        expect(answers.c1).toHaveBeenCalledExactlyOnceWith(false, undefined);
        expect(api().streamingBlocks[0]).toMatchObject({ toolCall: { id: "c1", approval: "declined" } });

        // Stopped while waiting: the call that was never answered is no longer waiting.
        await act(async () => {
            finish();
        });
        expect(api().messages.at(-1)?.content).toMatchObject([
            { toolCall: { id: "c1", approval: "declined" } },
            { toolCall: { id: "c2", approval: undefined, result: "[Stopped]" } }
        ]);
        api().answerToolCall("c2", true);
        expect(answers.c2).not.toHaveBeenCalled();
    });

    it("keeps a tool call waiting until the turn receives its answer, so a failed answer can be sent again", async () => {
        type Answer = (approved: boolean, scope?: "chat") => Promise<void>;
        let callbacks: {
            onToolApprovalRequest: (request: { toolCallId: string; toolName: string; toolInput: Record<string, unknown> }, answer: Answer) => void;
        } | undefined;
        let finish: () => void = () => undefined;
        streamChatCompletionMock.mockImplementation(async (_messages, _options, cb) => {
            callbacks = cb;
            await new Promise<void>(resolve => { finish = resolve; });
            cb.onDone();
        });
        let failSend: (error: Error) => void = () => undefined;
        const answers = {
            c1: vi.fn<Answer>()
                .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { failSend = reject; }))
                .mockResolvedValue(undefined),
            c2: vi.fn<Answer>(async () => {})
        };
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        await mountChat();
        await act(async () => {
            api().setInput("rename them");
        });
        await act(async () => {
            void api().handleSubmit(new Event("submit"));
        });
        await act(async () => {
            callbacks?.onToolApprovalRequest({ toolCallId: "c1", toolName: "rename_note", toolInput: {} }, answers.c1);
            callbacks?.onToolApprovalRequest({ toolCallId: "c2", toolName: "rename_note", toolInput: {} }, answers.c2);
        });

        // While the answer is on its way, the call still waits and a second click sends nothing.
        await act(async () => {
            api().answerToolCall("c1", true, "chat");
            api().answerToolCall("c1", true, "chat");
        });
        expect(answers.c1).toHaveBeenCalledOnce();
        expect(api().streamingBlocks).toMatchObject([
            { toolCall: { id: "c1", approval: "pending" } },
            { toolCall: { id: "c2", approval: "pending" } }
        ]);

        await act(async () => {
            failSend(new Error("offline"));
        });
        expect(api().streamingBlocks).toMatchObject([
            { toolCall: { id: "c1", approval: "pending" } },
            { toolCall: { id: "c2", approval: "pending" } }
        ]);
        expect(api().allowedTools).toEqual([]);

        await act(async () => {
            api().answerToolCall("c1", true, "chat");
        });
        expect(answers.c1).toHaveBeenCalledTimes(2);
        expect(answers.c2).not.toHaveBeenCalled();
        expect(api().streamingBlocks).toMatchObject([
            { toolCall: { id: "c1", approval: undefined } },
            { toolCall: { id: "c2", approval: undefined } }
        ]);
        expect(api().allowedTools).toEqual([ "rename_note" ]);

        await act(async () => {
            finish();
        });
        consoleError.mockRestore();
    });

    it("keeps the answers on their way when the reply ends before they arrive", async () => {
        type Answer = (approved: boolean, scope?: "chat") => Promise<void>;
        let callbacks: {
            onToolApprovalRequest: (request: { toolCallId: string; toolName: string; toolInput: Record<string, unknown> }, answer: Answer) => void;
            onToolResult: (toolCallId: string, toolName: string, result: string, isError?: boolean) => void;
        } | undefined;
        let finish: () => void = () => undefined;
        streamChatCompletionMock.mockImplementation(async (_messages, _options, cb) => {
            callbacks = cb;
            await new Promise<void>(resolve => { finish = resolve; });
            cb.onDone();
        });
        const delivered: (() => void)[] = [];
        const answer = vi.fn<Answer>(() => new Promise<void>(resolve => { delivered.push(resolve); }));
        await mountChat();
        await act(async () => {
            api().setInput("tidy up");
        });
        await act(async () => {
            void api().handleSubmit(new Event("submit"));
        });
        await act(async () => {
            callbacks?.onToolApprovalRequest({ toolCallId: "c1", toolName: "delete_note", toolInput: {} }, answer);
            callbacks?.onToolApprovalRequest({ toolCallId: "c2", toolName: "rename_note", toolInput: {} }, answer);
        });

        await act(async () => {
            api().answerToolCall("c1", false);
            api().answerToolCall("c2", true, "chat");
            callbacks?.onToolResult("c1", "delete_note", JSON.stringify({ error: "declined" }), true);
            callbacks?.onToolResult("c2", "rename_note", "renamed");
            finish();
        });
        await act(async () => {
            for (const resolve of delivered) resolve();
        });

        expect(api().allowedTools).toEqual([ "rename_note" ]);
        expect(api().messages.at(-1)?.content).toMatchObject([
            { toolCall: { id: "c1", approval: "declined" } },
            { toolCall: { id: "c2", approval: undefined, result: "renamed" } }
        ]);
    });

    it("allows a tool for the chat: releases its waiting calls, sends and saves the list, and revokes it", async () => {
        type Answer = (approved: boolean, scope?: "chat") => Promise<void>;
        let callbacks: {
            onToolApprovalRequest: (request: { toolCallId: string; toolName: string; toolInput: Record<string, unknown> }, answer: Answer) => void;
        } | undefined;
        let finish: () => void = () => undefined;
        streamChatCompletionMock.mockImplementation(async (_messages, _options, cb) => {
            callbacks = cb;
            await new Promise<void>(resolve => { finish = resolve; });
            cb.onDone();
        });
        const answers = { c1: vi.fn<Answer>(async () => {}), c2: vi.fn<Answer>(async () => {}), c3: vi.fn<Answer>(async () => {}) };
        const send = async (text: string) => {
            await act(async () => {
                api().setInput(text);
            });
            await act(async () => {
                void api().handleSubmit(new Event("submit"));
            });
        };
        await mountChat();
        await send("rename them");
        await act(async () => {
            callbacks?.onToolApprovalRequest({ toolCallId: "c1", toolName: "rename_note", toolInput: {} }, answers.c1);
            callbacks?.onToolApprovalRequest({ toolCallId: "c2", toolName: "rename_note", toolInput: {} }, answers.c2);
            callbacks?.onToolApprovalRequest({ toolCallId: "c3", toolName: "delete_note", toolInput: {} }, answers.c3);
        });

        await act(async () => {
            api().answerToolCall("c1", true, "chat");
        });
        // The turn approves the other calls of the tool itself, so only the first answer is sent.
        expect(answers.c1).toHaveBeenCalledExactlyOnceWith(true, "chat");
        expect(answers.c2).not.toHaveBeenCalled();
        expect(api().streamingBlocks).toMatchObject([
            { toolCall: { id: "c1", approval: undefined } },
            { toolCall: { id: "c2", approval: undefined } },
            { toolCall: { id: "c3", approval: "pending" } }
        ]);
        expect(api().allowedTools).toEqual([ "rename_note" ]);
        expect(api().getContent().allowedTools).toEqual([ "rename_note" ]);

        await act(async () => {
            finish();
        });
        await send("again");
        expect(streamChatCompletionMock.mock.calls.at(-1)?.[1]).toMatchObject({ allowedTools: [ "rename_note" ] });
        await act(async () => {
            finish();
        });

        await act(async () => {
            api().revokeAllowedTool("rename_note");
        });
        expect(api().allowedTools).toEqual([]);
        expect(api().getContent().allowedTools).toBeUndefined();

        await act(async () => {
            api().loadFromContent({ version: 1, messages: [], allowedTools: [ "get_note", 3 as unknown as string ] });
        });
        expect(api().allowedTools).toEqual([ "get_note" ]);
        await act(async () => {
            api().loadFromContent({ version: 1, messages: [] });
        });
        expect(api().allowedTools).toEqual([]);

        // A chat emptied for a new one, as the sidebar's "New chat" does, keeps none of the old chat's grants.
        await act(async () => {
            api().loadFromContent({ version: 1, messages: [], allowedTools: [ "get_note" ], permissionMode: "dont_ask" });
        });
        permissionModeOption.value = "always_ask";
        await act(async () => {
            api().clearMessages();
        });
        expect(api().allowedTools).toEqual([]);
        expect(api().getContent().allowedTools).toBeUndefined();
        expect(api().getContent().permissionMode).toBe("always_ask");
    });
    it("keeps the chat's permission mode, sends it with each turn and saves it, and remembers the last one picked", async () => {
        permissionModeOption.value = "always_ask";
        await mountChat();
        const sentOptions = async () => {
            streamChatCompletionMock.mockClear();
            await act(async () => {
                api().setInput("hi");
            });
            await act(async () => {
                await api().handleSubmit(new Event("submit"));
            });
            return streamChatCompletionMock.mock.calls[0][1];
        };

        // A new chat starts in the mode picked last, in any chat.
        expect(api().permissionMode).toBe("always_ask");
        expect((await sentOptions()).permissionMode).toBe("always_ask");

        await act(async () => {
            api().setPermissionMode("dont_ask");
        });
        expect(api().getContent()).toMatchObject({ permissionMode: "dont_ask" });
        expect((await sentOptions()).permissionMode).toBe("dont_ask");
        expect(permissionModeOption.save).toHaveBeenCalledExactlyOnceWith("llmPermissionMode", "dont_ask");

        await act(async () => {
            api().loadFromContent({ version: 1, messages: [], permissionMode: "always_ask" });
        });
        expect(api().permissionMode).toBe("always_ask");
        // Opening a chat does not change the remembered mode.
        expect(permissionModeOption.save).toHaveBeenCalledOnce();

        // A chat saved before the modes, or with a mode this version does not know, starts in the
        // remembered mode; with none remembered, in "ask_before_changes".
        await act(async () => {
            api().loadFromContent({ version: 1, messages: [], permissionMode: "yolo" as "dont_ask" });
        });
        expect(api().permissionMode).toBe("always_ask");
        permissionModeOption.value = "";
        await act(async () => {
            api().loadFromContent({ version: 1, messages: [] });
        });
        expect(api().permissionMode).toBe("ask_before_changes");
        permissionModeOption.save.mockClear();
    });
});
