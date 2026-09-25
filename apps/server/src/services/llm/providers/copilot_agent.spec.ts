import type { LlmStreamChunk } from "@triliumnext/commons";
import fs from "fs";
import os from "os";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const errorLogMock = vi.hoisted(() => vi.fn());
const infoLogMock = vi.hoisted(() => vi.fn());
vi.mock("@triliumnext/core", () => ({
    getLog: () => ({ info: infoLogMock, error: errorLogMock }),
    // buildSystemPrompt reads the workspace task states; none in this unit test.
    task_states: { getTaskStates: () => [] }
}));

vi.mock("../../data_dir.js", async () => {
    const os = await import("os");
    const path = await import("path");
    return { default: { TRILIUM_DATA_DIR: path.join(os.tmpdir(), "trilium-copilot-agent-spec") } };
});

/** The directory the provider derives from the mocked data dir above. */
const AGENT_CWD = path.resolve(os.tmpdir(), "trilium-copilot-agent-spec", "copilot-agent");

// BYO binary resolution shells out to the user's `copilot`; stub it.
const resolveCopilotBinaryMock = vi.hoisted(() => vi.fn(async () => "/usr/bin/copilot"));
vi.mock("./copilot_binary.js", () => ({
    resolveCopilotBinaryPath: resolveCopilotBinaryMock,
    needsShell: () => false
}));

// The loopback MCP endpoint opens a real socket; stub it to a fixed URL.
const mcpEndpointMock = vi.hoisted(() => vi.fn(async () => "http://127.0.0.1:12345/mcp-secret"));
vi.mock("./acp_mcp_endpoint.js", () => ({ getAcpMcpEndpointUrl: mcpEndpointMock }));

const buildNoteHintMock = vi.hoisted(() => vi.fn((noteId: string): string | null => `NOTE_META(${noteId})`));
vi.mock("@triliumnext/core/src/services/llm/note_hint.js", () => ({ buildNoteHint: buildNoteHintMock }));

const resolveAttachmentPartMock = vi.hoisted(() => vi.fn());
vi.mock("@triliumnext/core/src/services/llm/attachment_content.js", () => ({ resolveAttachmentPart: resolveAttachmentPartMock }));

// A scriptable fake ACP client. `AcpClient.start` returns the active instance;
// each test scripts what `session/prompt` streams via onNotification and what
// it finally resolves to.
class FakeAcpClient {
    onNotification: (method: string, params: unknown) => void;
    onAgentRequest?: (method: string, params: unknown) => unknown;
    onExit?: (error: Error) => void;
    requests: { method: string; params: unknown }[] = [];
    notifications: { method: string; params: unknown }[] = [];
    disposed = false;

    static current: FakeAcpClient | undefined;
    static promptScript: (client: FakeAcpClient) => Promise<{ stopReason?: string }> = async () => ({ stopReason: "end_turn" });
    static initializeError: Error | undefined;
    /** What `initialize` answers with. */
    static initializeResult: unknown = {};
    static sessionCloseError: Error | undefined;
    static sessionNewError: Error | undefined;
    static sessionLoadError: Error | undefined;
    static setModelError: Error | undefined;
    /** Id handed out by the next `session/new` (the real CLI never reuses one). */
    static newSessionId = "sess-1";
    /**
     * The `models` block `session/new` answers with. Shaped like the real CLI's
     * (see the ACP model-selection state), including the `_meta` extensions
     * Copilot hangs its premium-request accounting off.
     */
    static sessionModels: unknown = undefined;

    constructor(opts: { onNotification: (m: string, p: unknown) => void; onAgentRequest?: (m: string, p: unknown) => unknown; onExit?: (e: Error) => void }) {
        this.onNotification = opts.onNotification;
        this.onAgentRequest = opts.onAgentRequest;
        this.onExit = opts.onExit;
    }

    static start(_binary: string, opts: { args?: string[]; onNotification: (m: string, p: unknown) => void; onAgentRequest?: (m: string, p: unknown) => unknown; onExit?: (e: Error) => void }) {
        FakeAcpClient.current = new FakeAcpClient(opts);
        return FakeAcpClient.current;
    }

    async request<T>(method: string, params: unknown): Promise<T> {
        this.requests.push({ method, params });
        if (method === "initialize") {
            if (FakeAcpClient.initializeError) throw FakeAcpClient.initializeError;
            return FakeAcpClient.initializeResult as T;
        }
        if (method === "session/new") {
            if (FakeAcpClient.sessionNewError) throw FakeAcpClient.sessionNewError;
            return { sessionId: FakeAcpClient.newSessionId, models: FakeAcpClient.sessionModels } as T;
        }
        if (method === "session/load") {
            if (FakeAcpClient.sessionLoadError) throw FakeAcpClient.sessionLoadError;
            // A real load replays the session's history as notifications.
            this.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "REPLAY" } });
            return {} as T;
        }
        if (method === "session/set_model") {
            if (FakeAcpClient.setModelError) throw FakeAcpClient.setModelError;
            return {} as T;
        }
        if (method === "session/prompt") return (await FakeAcpClient.promptScript(this)) as T;
        if (method === "session/close" && FakeAcpClient.sessionCloseError) throw FakeAcpClient.sessionCloseError;
        return {} as T;
    }

    notify(method: string, params: unknown): void {
        this.notifications.push({ method, params });
    }

    dispose(): void {
        this.disposed = true;
    }

    /** Like the real client, the pool reuses only a live subprocess. */
    get alive(): boolean {
        return !this.disposed;
    }

    /** Simulate the subprocess dying on its own, as the real client reports it. */
    die(message = "The ACP agent exited unexpectedly (SIGKILL)."): void {
        this.disposed = true;
        this.onExit?.(new Error(message));
    }

    /** Forget the recorded requests, so a test spanning several turns asserts on one. */
    clearRequests(): void {
        this.requests = [];
    }

    /** Fire a session/update notification as the agent would. */
    update(update: Record<string, unknown>, sessionId = "sess-1"): void {
        this.onNotification("session/update", { sessionId, update });
    }
}

class FakeAcpError extends Error {
    constructor(public readonly code: number, message: string) {
        super(message);
    }
}

vi.mock("./acp_client.js", () => ({ AcpClient: FakeAcpClient, AcpError: FakeAcpError }));

const { buildPromptBlocks, createUpdateCollector, denyPermission, MAX_TITLES_PER_SESSION } = await import("./acp_agent.js");
const { IDLE_TIMEOUT_MS } = await import("./acp_client_pool.js");
const { buildCopilotModelList, CopilotAgentProvider, resetModelCatalogCacheForTests } = await import("./copilot_agent.js");

const decidePermission = (request: Parameters<typeof denyPermission>[0]) => denyPermission(request, "Copilot Agent provider");

/** The reply chunks of a turn, without the status that precedes a cold start (see {@link collectAll}). */
async function collect(iterable: AsyncIterable<LlmStreamChunk>): Promise<LlmStreamChunk[]> {
    return (await collectAll(iterable)).filter(chunk => chunk.type !== "status");
}

async function collectAll(iterable: AsyncIterable<LlmStreamChunk>): Promise<LlmStreamChunk[]> {
    const chunks: LlmStreamChunk[] = [];
    for await (const chunk of iterable) {
        chunks.push(chunk);
    }
    return chunks;
}

const userMessage = (text: string) => ({ role: "user" as const, content: text });
/** What a turn on the default model reports when the CLI names no model of its own. */
const AUTO_USAGE = { type: "usage", usage: { model: "Auto", provider: "copilot-agent" } };
const assistantMessage = (text: string) => ({ role: "assistant" as const, content: text });

function resetFakes() {
    errorLogMock.mockReset();
    infoLogMock.mockReset();
    resolveAttachmentPartMock.mockReset();
    resetModelCatalogCacheForTests();
    mcpEndpointMock.mockClear();
    resolveCopilotBinaryMock.mockClear();
    FakeAcpClient.sessionModels = undefined;
    FakeAcpClient.current = undefined;
    FakeAcpClient.initializeError = undefined;
    FakeAcpClient.initializeResult = {};
    FakeAcpClient.sessionCloseError = undefined;
    FakeAcpClient.sessionNewError = undefined;
    FakeAcpClient.sessionLoadError = undefined;
    FakeAcpClient.setModelError = undefined;
    FakeAcpClient.newSessionId = "sess-1";
    FakeAcpClient.promptScript = async () => ({ stopReason: "end_turn" });
}

describe("CopilotAgentProvider metadata", () => {
    beforeEach(resetFakes);

    it("answers synchronously with the ids it names itself, and refuses the AI-SDK chat entry point", () => {
        const provider = new CopilotAgentProvider();

        // The chat resolves a default and a title model without waiting on a
        // probe, so both must be answerable offline.
        expect(provider.getAvailableModels().map(m => m.id)).toEqual(["auto", "gpt-5-mini"]);
        expect(provider.getAvailableModels().filter(m => m.isDefault).map(m => m.id)).toEqual(["auto"]);
        expect(provider.getModelPricing("gpt-5-mini")).toEqual({ input: 0, output: 0 });
        expect(provider.getModelPricing("gpt-4-turbo")).toBeUndefined();
        expect(() => provider.chat()).toThrow(/chatChunks/);
    });
});

/**
 * The catalog the CLI actually reports, trimmed to the cases that matter:
 * the pickerless `auto`, a 1x model, a sub-1x model, two the account is
 * charged a premium multiple for, and one its policy has switched off.
 */
const CLI_MODELS = [
    { modelId: "auto", name: "Auto", description: "Let Copilot pick the best model" },
    { modelId: "claude-sonnet-5", name: "Claude Sonnet 5", _meta: { copilotUsage: "1x", copilotEnablement: "enabled" } },
    { modelId: "claude-haiku-4.5", name: "Claude Haiku 4.5", _meta: { copilotUsage: "0.33x", copilotEnablement: "enabled" } },
    { modelId: "claude-opus-5", name: "Claude Opus 5", _meta: { copilotUsage: "15x", copilotEnablement: "enabled" } },
    { modelId: "gemini-3.6-flash", name: "Gemini 3.6 Flash", _meta: { copilotUsage: "14x", copilotEnablement: "enabled" } },
    { modelId: "gpt-5-mini", name: "GPT-5 mini", _meta: { copilotUsage: "0x", copilotEnablement: "enabled" } },
    { modelId: "policy-blocked", name: "Blocked", _meta: { copilotUsage: "1x", copilotEnablement: "disabled" } }
];

describe("CopilotAgentProvider.listModels", () => {
    beforeEach(resetFakes);

    it("reads the account's catalog off session/new, keeping the CLI's own order", async () => {
        FakeAcpClient.sessionModels = { availableModels: CLI_MODELS, currentModelId: "claude-sonnet-5" };

        const models = await new CopilotAgentProvider().listModels();

        // The CLI's order survives — it is the picker GitHub shows, already
        // ordered for a human — and the disabled model is gone.
        expect(models.map(m => m.id)).toEqual([
            "auto", "claude-sonnet-5", "claude-haiku-4.5", "claude-opus-5", "gemini-3.6-flash", "gpt-5-mini"
        ]);
        // Every model is plan-covered, so the picker says "Subscription" rather
        // than a per-token price, and `auto` stays the default the chat falls to.
        expect(models.every(m => m.isSubscription && m.pricing?.input === 0 && m.pricing?.output === 0)).toBe(true);
        expect(models.filter(m => m.isDefault).map(m => m.id)).toEqual(["auto"]);
        // Discovered models price as free too, not as unknown ids.
        expect(new CopilotAgentProvider().getModelPricing("gemini-3.6-flash")).toEqual({ input: 0, output: 0 });
    });

    it("pre-selects everything except the models billed above one premium request", async () => {
        FakeAcpClient.sessionModels = { availableModels: CLI_MODELS };

        const provider = new CopilotAgentProvider();
        const models = await provider.listModels();

        // Opus (15x) and Gemini Flash (14x) would each spend a fortnight's worth
        // of a small allowance in a handful of turns, so they stay one tick away;
        // `auto` reports no rate at all and is kept.
        expect([...provider.recommendedModelIds(models)].sort())
            .toEqual(["auto", "claude-haiku-4.5", "claude-sonnet-5", "gpt-5-mini"]);
    });

    it("treats a premium rate it cannot read like no rate at all", async () => {
        FakeAcpClient.sessionModels = { availableModels: [
            { modelId: "mystery", name: "Mystery", _meta: { copilotUsage: "varies", copilotEnablement: "enabled" } }
        ] };

        const provider = new CopilotAgentProvider();
        expect([...provider.recommendedModelIds(await provider.listModels())]).toContain("mystery");
    });

    it("probes once, then serves the cached catalog without respawning the CLI", async () => {
        FakeAcpClient.sessionModels = { availableModels: CLI_MODELS };
        const provider = new CopilotAgentProvider();

        const [first, second] = await Promise.all([provider.listModels(), provider.listModels()]);
        const third = await provider.listModels();

        expect(second).toBe(first);
        expect(third).toBe(first);
        expect(resolveCopilotBinaryMock).toHaveBeenCalledTimes(1);
        // The probe opens a session to read the catalog and sends no prompt, so
        // it costs no premium request — and it tears the CLI down after.
        const methods = FakeAcpClient.current?.requests.map(r => r.method);
        expect(methods).toEqual(["initialize", "session/new"]);
        expect(FakeAcpClient.current?.disposed).toBe(true);
    });

    it("surfaces why the probe failed instead of masking it with the fallback list", async () => {
        resolveCopilotBinaryMock.mockRejectedValueOnce(new Error("Copilot CLI not found"));

        await expect(new CopilotAgentProvider().listModels()).rejects.toThrow(/Copilot CLI not found/);
        // A later call retries rather than serving a cached failure.
        FakeAcpClient.sessionModels = { availableModels: CLI_MODELS };
        expect((await new CopilotAgentProvider().listModels()).length).toBe(6);
    });

    it("falls back to the curated list when the CLI reports no usable models", async () => {
        // An older CLI omits the block entirely; a locked-down account can also
        // report a list with nothing enabled in it.
        for (const models of [undefined, { availableModels: [] }, { availableModels: [CLI_MODELS[6]] }]) {
            resetModelCatalogCacheForTests();
            FakeAcpClient.sessionModels = models;

            const listed = await new CopilotAgentProvider().listModels();
            expect(listed).toEqual(new CopilotAgentProvider().getAvailableModels());
        }
    });
});

describe("buildCopilotModelList", () => {
    it("names unnamed models and marks a default even when auto is not on offer", () => {
        const curated = [{ id: "claude-sonnet-5", name: "Claude Sonnet 5", isSubscription: true }];
        const models = buildCopilotModelList(
            [{ modelId: "claude-sonnet-5" }, { modelId: "future-model-9" }],
            curated
        );

        expect(models.map(m => ({ id: m.id, name: m.name, isDefault: m.isDefault ?? false }))).toEqual([
            // The curated name fills in for a model the CLI left unnamed; an
            // unknown id falls back to itself rather than rendering blank.
            { id: "claude-sonnet-5", name: "Claude Sonnet 5", isDefault: true },
            { id: "future-model-9", name: "future-model-9", isDefault: false }
        ]);
    });
});

describe("CopilotAgentProvider.chatChunks", () => {
    beforeEach(resetFakes);

    it("maps message, thought, and tool updates to chunks and ends with done", async () => {
        FakeAcpClient.promptScript = async client => {
            client.update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hmm" } });
            client.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello " } });
            client.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "world" } });
            client.update({ sessionUpdate: "tool_call", toolCallId: "t1", title: "search_notes", rawInput: { query: "x" } });
            client.update({ sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", rawOutput: "3 results" });
            return { stopReason: "end_turn" };
        };

        const provider = new CopilotAgentProvider();
        const chunks = await collect(provider.chatChunks([userMessage("hi")], {}));

        expect(chunks).toEqual([
            { type: "thinking", content: "hmm" },
            { type: "text", content: "Hello " },
            { type: "text", content: "world" },
            { type: "tool_use", toolCallId: "t1", toolName: "search_notes", toolInput: { query: "x" } },
            { type: "tool_result", toolCallId: "t1", toolName: "search_notes", result: "3 results", isError: false },
            AUTO_USAGE,
            { type: "done" }
        ]);
        // The agent process stays running for the next turn.
        expect(FakeAcpClient.current?.disposed).toBe(false);
    });

    it("wires the loopback MCP server into session/new when note tools are enabled", async () => {
        const provider = new CopilotAgentProvider();
        await collect(provider.chatChunks([userMessage("hi")], { enableNoteTools: true }));

        const sessionNew = FakeAcpClient.current?.requests.find(r => r.method === "session/new");
        expect(sessionNew?.params).toMatchObject({
            mcpServers: [{ name: "trilium", type: "http", url: "http://127.0.0.1:12345/mcp-secret" }]
        });
    });

    it("omits MCP servers when note tools are disabled", async () => {
        const provider = new CopilotAgentProvider();
        await collect(provider.chatChunks([userMessage("hi")], { enableNoteTools: false }));

        const sessionNew = FakeAcpClient.current?.requests.find(r => r.method === "session/new");
        expect(sessionNew?.params).toMatchObject({ mcpServers: [] });
        expect(mcpEndpointMock).not.toHaveBeenCalled();
    });

    // A caller with no opinion gets no note access, the same reading `base_provider` gives an
    // absent flag — so what a request leaves unsaid means one thing across every provider. This
    // used to go the other way here, handing the whole tree to anything that simply did not ask.
    it("omits MCP servers when the chat says nothing about note tools", async () => {
        const provider = new CopilotAgentProvider();
        await collect(provider.chatChunks([userMessage("hi")], {}));

        const sessionNew = FakeAcpClient.current?.requests.find(r => r.method === "session/new");
        expect(sessionNew?.params).toMatchObject({ mcpServers: [] });
        expect(mcpEndpointMock).not.toHaveBeenCalled();
    });

    it("spawns the CLI with the note-tool allow-list and built-in tool denials", async () => {
        const startSpy = vi.spyOn(FakeAcpClient, "start");
        const provider = new CopilotAgentProvider();
        await collect(provider.chatChunks([userMessage("hi")], {}));

        const args = startSpy.mock.calls[0][1].args ?? [];
        expect(args).toContain("--allow-tool=trilium");
        expect(args).toContain("--deny-tool=shell");
        expect(args).toContain("--deny-tool=write");
        startSpy.mockRestore();
    });

    it("selects a non-default model via session/set_model", async () => {
        const provider = new CopilotAgentProvider();
        await collect(provider.chatChunks([userMessage("hi")], { model: "gpt-5.4" }));

        const setModel = FakeAcpClient.current?.requests.find(r => r.method === "session/set_model");
        expect(setModel?.params).toMatchObject({ sessionId: "sess-1", modelId: "gpt-5.4" });
    });

    it("reports the model the turn ran on, by the CLI's name for it", async () => {
        FakeAcpClient.sessionModels = { availableModels: CLI_MODELS, currentModelId: "claude-sonnet-5" };
        const provider = new CopilotAgentProvider();
        const usageFor = async (config: Record<string, unknown>) => {
            const chunks = await collect(provider.chatChunks([userMessage("hi")], config));
            return chunks.find(c => c.type === "usage");
        };

        expect(await usageFor({ model: "gpt-5-mini" }))
            .toEqual({ type: "usage", usage: { model: "GPT-5 mini", provider: "copilot-agent" } });
        // "auto" runs on whatever the session starts on.
        expect(await usageFor({}))
            .toEqual({ type: "usage", usage: { model: "Claude Sonnet 5", provider: "copilot-agent" } });
        // A model the CLI refuses leaves the session on its own.
        FakeAcpClient.setModelError = new Error("unknown model");
        expect(await usageFor({ model: "gpt-5-mini" }))
            .toEqual({ type: "usage", usage: { model: "Claude Sonnet 5", provider: "copilot-agent" } });
    });

    it("does not call session/set_model for the default 'auto' model", async () => {
        const provider = new CopilotAgentProvider();
        await collect(provider.chatChunks([userMessage("hi")], {}));

        expect(FakeAcpClient.current?.requests.some(r => r.method === "session/set_model")).toBe(false);
    });

    it("surfaces a non-terminal stop reason as an error chunk before done", async () => {
        FakeAcpClient.promptScript = async () => ({ stopReason: "refusal" });

        const provider = new CopilotAgentProvider();
        const chunks = await collect(provider.chatChunks([userMessage("hi")], {}));

        expect(chunks).toContainEqual({ type: "error", error: expect.stringContaining("declined") });
        expect(chunks.at(-1)).toEqual({ type: "done" });
    });

    it("maps an authentication AcpError to an actionable message", async () => {
        FakeAcpClient.sessionNewError = new FakeAcpError(-32000, "not logged in");

        const provider = new CopilotAgentProvider();
        const chunks = await collect(provider.chatChunks([userMessage("hi")], {}));

        expect(chunks).toEqual([{ type: "error", error: expect.stringContaining("copilot login") }]);
        // A failed session leaves the process running, so the turn after `copilot login` needs no respawn.
        expect(FakeAcpClient.current?.disposed).toBe(false);
    });

    it("rejects a transcript whose last message is not from the user", async () => {
        const provider = new CopilotAgentProvider();
        const chunks = await collect(provider.chatChunks([{ role: "assistant", content: "hi" }], {}));

        expect(chunks).toEqual([{ type: "error", error: expect.stringContaining("last message must be a user message") }]);
    });

    it("does nothing when the abort signal is already aborted", async () => {
        const provider = new CopilotAgentProvider();
        const chunks = await collect(provider.chatChunks([userMessage("hi")], {}, AbortSignal.abort()));

        expect(chunks).toEqual([]);
        expect(FakeAcpClient.current).toBeUndefined();
    });

    it("cancels the session on mid-stream abort", async () => {
        const controller = new AbortController();
        FakeAcpClient.promptScript = async client => {
            client.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "partial" } });
            controller.abort();
            return { stopReason: "cancelled" };
        };

        const provider = new CopilotAgentProvider();
        const chunks = await collect(provider.chatChunks([userMessage("hi")], {}, controller.signal));

        expect(chunks).toContainEqual({ type: "text", content: "partial" });
        // A "cancelled" stop reason must not surface as an error.
        expect(chunks.some(c => c.type === "error")).toBe(false);
        expect(FakeAcpClient.current?.notifications).toContainEqual({ method: "session/cancel", params: { sessionId: "sess-1" } });
    });

    it("ends the turn on abort even when the agent never answers the cancel", async () => {
        const controller = new AbortController();
        FakeAcpClient.promptScript = client => {
            client.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "partial" } });
            setTimeout(() => controller.abort(), 0);
            // Never settles: only the abort can end this turn.
            return new Promise<{ stopReason?: string }>(() => {});
        };

        const provider = new CopilotAgentProvider();
        const chunks = await collect(provider.chatChunks([userMessage("hi")], { chatNoteId: "chat-abort" }, controller.signal));

        expect(chunks).toEqual([{ type: "text", content: "partial" }, AUTO_USAGE, { type: "done" }]);
        expect(FakeAcpClient.current?.notifications).toContainEqual({ method: "session/cancel", params: { sessionId: "sess-1" } });
        // Other chats share the process, so cancelling one turn leaves it running.
        expect(FakeAcpClient.current?.disposed).toBe(false);

        // The aborted session's real history is unknown, so the next turn must
        // reseed rather than resume it — even though the transcript lines up.
        FakeAcpClient.current?.clearRequests();
        FakeAcpClient.promptScript = async () => ({ stopReason: "end_turn" });
        await collect(provider.chatChunks(
            [userMessage("hi"), { role: "assistant", content: "partial" }, userMessage("more")],
            { chatNoteId: "chat-abort" }
        ));
        expect(FakeAcpClient.current?.requests.map(r => r.method)).toEqual(["session/new", "session/prompt"]);
    });

    it("flattens both wrapped and direct tool-result content blocks", async () => {
        FakeAcpClient.promptScript = async client => {
            client.update({ sessionUpdate: "tool_call", toolCallId: "t1", title: "search_notes" });
            client.update({
                sessionUpdate: "tool_call_update",
                toolCallId: "t1",
                status: "completed",
                content: [
                    { type: "content", content: { type: "text", text: "wrapped" } },
                    { type: "text", text: "direct" }
                ]
            });
            return { stopReason: "end_turn" };
        };

        const provider = new CopilotAgentProvider();
        const chunks = await collect(provider.chatChunks([userMessage("hi")], {}));

        expect(chunks).toContainEqual(expect.objectContaining({ type: "tool_result", result: "wrapped\ndirect" }));
    });

    it("prepends the note-metadata hint to a fresh session's prompt", async () => {
        const provider = new CopilotAgentProvider();
        await collect(provider.chatChunks([userMessage("hi")], { contextNoteId: "note123" }));

        const prompt = FakeAcpClient.current?.requests.find(r => r.method === "session/prompt");
        const blocks = (prompt?.params as { prompt: { type: string; text: string }[] }).prompt;
        expect(blocks[0].text).toContain("NOTE_META(note123)");
    });

    it("flags attachments to the note hint and leads the prompt blocks with the prefix", async () => {
        resolveAttachmentPartMock.mockReturnValue(undefined);

        const provider = new CopilotAgentProvider();
        await collect(provider.chatChunks([{
            role: "user",
            content: [
                { type: "text", text: "what is this?" },
                { type: "file", attachmentId: "p", mime: "application/pdf", filename: "doc.pdf" }
            ]
        }], { contextNoteId: "note123" }));

        expect(buildNoteHintMock).toHaveBeenCalledWith("note123", true);
        const prompt = FakeAcpClient.current?.requests.find(r => r.method === "session/prompt");
        const blocks = (prompt?.params as { prompt: { type: string; text: string }[] }).prompt;
        expect(blocks[0].text).toContain("NOTE_META(note123)");
        expect(blocks.at(-1)).toEqual({ type: "text", text: "[attached file: doc.pdf]" });
    });

    it("prompts a session its process still holds, and reseeds once the transcript diverges", async () => {
        const provider = new CopilotAgentProvider();
        FakeAcpClient.promptScript = async client => {
            client.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "answer" } });
            return { stopReason: "end_turn" };
        };
        await collect(provider.chatChunks([userMessage("hi")], { chatNoteId: "chat-resume" }));

        // Same transcript, and the pooled process still holds the session: the
        // turn is a bare session/prompt, without instructions or history replay.
        FakeAcpClient.current?.clearRequests();
        FakeAcpClient.promptScript = async () => ({ stopReason: "end_turn" });
        const resumed = await collect(provider.chatChunks(
            [userMessage("hi"), assistantMessage("answer"), userMessage("more")],
            { chatNoteId: "chat-resume" }
        ));

        expect(FakeAcpClient.current?.requests.map(r => r.method)).toEqual(["session/prompt"]);
        expect(resumed).toEqual([AUTO_USAGE, { type: "done" }]);
        const prompt = FakeAcpClient.current?.requests.find(r => r.method === "session/prompt");
        const blocks = (prompt?.params as { prompt: { type: string; text: string }[] }).prompt;
        expect(blocks[0].text).toBe("more");

        // An edited history no longer hashes to the mapped session, so the next
        // turn must reseed rather than resume.
        FakeAcpClient.current?.clearRequests();
        await collect(provider.chatChunks(
            [userMessage("rewritten"), assistantMessage("answer"), userMessage("more")],
            { chatNoteId: "chat-resume" }
        ));
        expect(FakeAcpClient.current?.requests.some(r => r.method === "session/load")).toBe(false);
        expect(FakeAcpClient.current?.requests.some(r => r.method === "session/new")).toBe(true);
    });

    it("loads a mapped session into a new process, dropping the replay", async () => {
        const provider = new CopilotAgentProvider();
        FakeAcpClient.promptScript = async client => {
            client.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "answer" } });
            return { stopReason: "end_turn" };
        };
        await collect(provider.chatChunks([userMessage("hi")], { chatNoteId: "chat-reload" }));

        // The session exists only in the process that created it.
        FakeAcpClient.current?.die();
        FakeAcpClient.promptScript = async () => ({ stopReason: "end_turn" });
        const resumed = await collect(provider.chatChunks(
            [userMessage("hi"), assistantMessage("answer"), userMessage("more")],
            { chatNoteId: "chat-reload" }
        ));

        expect(FakeAcpClient.current?.requests.map(r => r.method)).toEqual(["initialize", "session/load", "session/prompt"]);
        expect(FakeAcpClient.current?.requests.find(r => r.method === "session/load")?.params)
            .toMatchObject({ sessionId: "sess-1", cwd: AGENT_CWD });
        // The fake load replays "REPLAY", which must not reach the chat.
        expect(resumed).toEqual([AUTO_USAGE, { type: "done" }]);
        const prompt = FakeAcpClient.current?.requests.find(r => r.method === "session/prompt");
        const blocks = (prompt?.params as { prompt: { type: string; text: string }[] }).prompt;
        expect(blocks[0].text).toBe("more");
    });

    it("reseeds a fresh session when session/load fails", async () => {
        const provider = new CopilotAgentProvider();
        await collect(provider.chatChunks([userMessage("hi")], { chatNoteId: "chat-load-fail", enableNoteTools: true }));

        FakeAcpClient.current?.die();
        FakeAcpClient.sessionLoadError = new Error("unknown session");
        FakeAcpClient.newSessionId = "sess-2";
        mcpEndpointMock.mockClear();
        const chunks = await collect(provider.chatChunks(
            [userMessage("hi"), assistantMessage(""), userMessage("more")],
            { chatNoteId: "chat-load-fail", enableNoteTools: true }
        ));
        // The failed load and the new session share one MCP server list.
        expect(mcpEndpointMock).toHaveBeenCalledTimes(1);

        expect(FakeAcpClient.current?.requests.map(r => r.method))
            .toEqual(["initialize", "session/load", "session/new", "session/prompt"]);
        expect(infoLogMock).toHaveBeenCalledWith(expect.stringContaining("session/load failed (unknown session)"));
        expect(chunks).toEqual([AUTO_USAGE, { type: "done" }]);
        // A reseeded session is told everything again: instructions + replay.
        const prompt = FakeAcpClient.current?.requests.find(r => r.method === "session/prompt");
        const blocks = (prompt?.params as { prompt: { type: string; text: string }[] }).prompt;
        expect(blocks[0].text).toContain("<system_instructions>");
        expect(blocks[0].text).toContain("<conversation_history>");
    });

    it("continues with the agent's default model when session/set_model fails", async () => {
        FakeAcpClient.setModelError = new Error("model unavailable");

        const provider = new CopilotAgentProvider();
        const chunks = await collect(provider.chatChunks([userMessage("hi")], { model: "gpt-5.4" }));

        expect(errorLogMock).toHaveBeenCalledWith(expect.stringContaining(`failed to select model "gpt-5.4"`));
        expect(chunks).toEqual([AUTO_USAGE, { type: "done" }]);
    });

    it("disposes the client and reports the failure when the initialize handshake fails", async () => {
        FakeAcpClient.initializeError = new Error("handshake rejected");

        const provider = new CopilotAgentProvider();
        const chunks = await collect(provider.chatChunks([userMessage("hi")], {}));

        expect(chunks).toEqual([{ type: "error", error: "handshake rejected" }]);
        expect(FakeAcpClient.current?.disposed).toBe(true);
        expect(FakeAcpClient.current?.requests.some(r => r.method === "session/new")).toBe(false);
    });

    it("maps prompt failures to actionable messages", async () => {
        const provider = new CopilotAgentProvider();

        FakeAcpClient.promptScript = async () => { throw new Error("the agent crashed"); };
        expect(await collect(provider.chatChunks([userMessage("hi")], {})))
            .toEqual([{ type: "error", error: "the agent crashed" }]);

        // Non-Error rejections are stringified rather than dropped.
        FakeAcpClient.promptScript = () => Promise.reject("plain rejection");
        expect(await collect(provider.chatChunks([userMessage("hi")], {})))
            .toEqual([{ type: "error", error: "plain rejection" }]);

        // A spawn failure names the CLI that could not start.
        FakeAcpClient.sessionNewError = new Error("spawn copilot ENOENT");
        expect(await collect(provider.chatChunks([userMessage("hi")], {})))
            .toEqual([{ type: "error", error: "Failed to start the GitHub Copilot CLI: spawn copilot ENOENT" }]);

        // Auth problems are recognized by wording too, not only by error code.
        FakeAcpClient.sessionNewError = new FakeAcpError(-32603, "authentication required");
        expect(await collect(provider.chatChunks([userMessage("hi")], {})))
            .toEqual([{ type: "error", error: expect.stringContaining("copilot login") }]);
    });

    it("describes early and unknown stop reasons", async () => {
        const provider = new CopilotAgentProvider();
        const errorFor = async (stopReason: string) => {
            FakeAcpClient.promptScript = async () => ({ stopReason });
            const chunks = await collect(provider.chatChunks([userMessage("hi")], {}));
            return chunks.find(c => c.type === "error");
        };

        expect(await errorFor("max_tokens")).toEqual({ type: "error", error: expect.stringContaining("max tokens") });
        expect(await errorFor("max_turn_requests")).toEqual({ type: "error", error: expect.stringContaining("max turn requests") });
        expect(await errorFor("something_new")).toEqual({ type: "error", error: "Agent stopped: something_new" });
    });

    it("answers the permission callback and refuses every other agent request", async () => {
        const provider = new CopilotAgentProvider();
        await collect(provider.chatChunks([userMessage("hi")], {}));

        const onAgentRequest = FakeAcpClient.current?.onAgentRequest;
        expect(onAgentRequest?.("session/request_permission", {
            toolCall: { toolCallId: "toolu_x", title: "Echo hello", kind: "execute" },
            options: [{ optionId: "reject_once", kind: "reject_once" }]
        })).toEqual({ outcome: { outcome: "selected", optionId: "reject_once" } });
        expect(() => onAgentRequest?.("fs/read_text_file", {})).toThrow(`Trilium does not support "fs/read_text_file".`);
    });

    it("creates the agent cwd with a .git marker so enclosing repo config is not inherited", async () => {
        fs.rmSync(AGENT_CWD, { recursive: true, force: true });

        const provider = new CopilotAgentProvider();
        await collect(provider.chatChunks([userMessage("hi")], {}));

        expect(fs.readFileSync(path.join(AGENT_CWD, ".git", "HEAD"), "utf8")).toBe("ref: refs/heads/main\n");
        expect(fs.existsSync(path.join(AGENT_CWD, ".git", "objects"))).toBe(true);
        expect(fs.existsSync(path.join(AGENT_CWD, ".git", "refs"))).toBe(true);
    });

    it("evicts the oldest mapping once more chat notes are tracked than the limit", async () => {
        const provider = new CopilotAgentProvider();
        // One more than MAX_TRACKED_SESSIONS (200), so "lru-0" falls out.
        for (let i = 0; i <= 200; i++) {
            await collect(provider.chatChunks([userMessage("hi")], { chatNoteId: `lru-${i}` }));
        }

        const followUp = [userMessage("hi"), assistantMessage(""), userMessage("more")];
        FakeAcpClient.current?.clearRequests();
        await collect(provider.chatChunks(followUp, { chatNoteId: "lru-0" }));
        expect(FakeAcpClient.current?.requests.map(r => r.method)).toEqual(["session/new", "session/prompt"]);

        FakeAcpClient.current?.clearRequests();
        await collect(provider.chatChunks(followUp, { chatNoteId: "lru-200" }));
        expect(FakeAcpClient.current?.requests.map(r => r.method)).toEqual(["session/prompt"]);
    });
});

describe("CopilotAgentProvider keep-alive", () => {
    beforeEach(resetFakes);

    it("says the agent is starting before a turn that has to start it, and only then", async () => {
        const provider = new CopilotAgentProvider();
        const starting = { type: "status", status: "starting_agent" };

        expect((await collectAll(provider.chatChunks([userMessage("hi")], {})))[0]).toEqual(starting);
        expect(await collectAll(provider.chatChunks([userMessage("hi")], {}))).not.toContainEqual(starting);

        FakeAcpClient.current?.die();
        expect((await collectAll(provider.chatChunks([userMessage("hi")], {})))[0]).toEqual(starting);
    });

    it("reuses one agent process across turns, chats and titles, starting it once", async () => {
        const startSpy = vi.spyOn(FakeAcpClient, "start").mockClear();
        const provider = new CopilotAgentProvider();

        await collect(provider.chatChunks([userMessage("hi")], { chatNoteId: "chat-a" }));
        const first = FakeAcpClient.current;
        FakeAcpClient.newSessionId = "sess-b";
        await collect(provider.chatChunks([userMessage("hi")], { chatNoteId: "chat-b" }));
        await provider.generateTitle("hi");

        expect(FakeAcpClient.current).toBe(first);
        expect(startSpy).toHaveBeenCalledTimes(1);
        const methods = FakeAcpClient.current?.requests.map(r => r.method) ?? [];
        expect(methods.filter(m => m === "initialize")).toHaveLength(1);
        expect(methods.filter(m => m === "session/new")).toHaveLength(3);
        startSpy.mockRestore();
    });

    it("shares a single spawn between turns that start concurrently", async () => {
        const startSpy = vi.spyOn(FakeAcpClient, "start").mockClear();
        FakeAcpClient.promptScript = async () => {
            await new Promise(resolve => setTimeout(resolve, 5));
            return { stopReason: "end_turn" };
        };
        const provider = new CopilotAgentProvider();

        await Promise.all([
            collect(provider.chatChunks([userMessage("one")], { chatNoteId: "chat-1" })),
            collect(provider.chatChunks([userMessage("two")], { chatNoteId: "chat-2" }))
        ]);

        expect(startSpy).toHaveBeenCalledTimes(1);
        startSpy.mockRestore();
    });

    it("keeps each turn's updates to its own session", async () => {
        FakeAcpClient.promptScript = async client => {
            client.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "mine" } }, "sess-1");
            client.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "theirs" } }, "sess-other");
            client.onNotification("session/update", {});
            return { stopReason: "end_turn" };
        };

        const chunks = await collect(new CopilotAgentProvider().chatChunks([userMessage("hi")], {}));

        expect(chunks).toEqual([{ type: "text", content: "mine" }, AUTO_USAGE, { type: "done" }]);
    });

    it("starts a replacement process after the pooled one dies", async () => {
        const provider = new CopilotAgentProvider();
        await collect(provider.chatChunks([userMessage("hi")], {}));

        const dead = FakeAcpClient.current;
        dead?.die();
        const chunks = await collect(provider.chatChunks([userMessage("hi again")], {}));

        expect(FakeAcpClient.current).not.toBe(dead);
        expect(FakeAcpClient.current?.requests.map(r => r.method)).toEqual(["initialize", "session/new", "session/prompt"]);
        expect(chunks).toEqual([AUTO_USAGE, { type: "done" }]);
        expect(infoLogMock).toHaveBeenCalledWith(expect.stringContaining("agent process #1 ended"));
    });

    it("starts a new session when the chat's note access changes", async () => {
        const provider = new CopilotAgentProvider();
        await collect(provider.chatChunks([userMessage("hi")], { chatNoteId: "chat-tools", enableNoteTools: true }));

        FakeAcpClient.current?.clearRequests();
        FakeAcpClient.newSessionId = "sess-2";
        await collect(provider.chatChunks(
            [userMessage("hi"), assistantMessage(""), userMessage("more")],
            { chatNoteId: "chat-tools", enableNoteTools: false }
        ));

        expect(FakeAcpClient.current?.requests.find(r => r.method === "session/new")?.params).toMatchObject({ mcpServers: [] });
    });

    it("stops the process once no turn has used it for the idle timeout", async () => {
        vi.useFakeTimers();
        try {
            const provider = new CopilotAgentProvider();
            await collect(provider.chatChunks([userMessage("hi")], {}));
            const client = FakeAcpClient.current;

            vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1);
            expect(client?.disposed).toBe(false);
            // A turn in between restarts the wait.
            await collect(provider.chatChunks([userMessage("hi")], {}));
            vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1);
            expect(client?.disposed).toBe(false);

            vi.advanceTimersByTime(1);
            expect(client?.disposed).toBe(true);
            expect(infoLogMock).toHaveBeenCalledWith(expect.stringContaining("reaping the idle agent process"));
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("CopilotAgentProvider.generateTitle", () => {
    beforeEach(resetFakes);

    it("accumulates the streamed title on the cheap model, trimming quotes and capping length", async () => {
        const longTitle = "Weekly planning notes".padEnd(120, "!");
        FakeAcpClient.promptScript = async client => {
            client.onNotification("session/idle", {});
            client.update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "thinking" } });
            client.update({ sessionUpdate: "agent_message_chunk", content: { type: "image", data: "x", mimeType: "image/png" } });
            client.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `  "${longTitle.slice(0, 30)}` } });
            client.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: `${longTitle.slice(30)}"  ` } });
            return { stopReason: "end_turn" };
        };

        const title = await new CopilotAgentProvider().generateTitle("plan my week");

        expect(title).toBe(longTitle.substring(0, 100));
        expect(FakeAcpClient.current?.requests.find(r => r.method === "session/set_model")?.params)
            .toMatchObject({ modelId: "gpt-5-mini" });
        expect(FakeAcpClient.current?.requests.find(r => r.method === "session/new")?.params)
            .toMatchObject({ mcpServers: [] });
        expect(FakeAcpClient.current?.disposed).toBe(false);
    });

    it("names chats in one shared session on the process, one title at a time", async () => {
        const provider = new CopilotAgentProvider();
        let prompts = 0;
        let concurrent = 0;
        let maxConcurrent = 0;
        FakeAcpClient.promptScript = async client => {
            concurrent++;
            maxConcurrent = Math.max(maxConcurrent, concurrent);
            prompts++;
            const title = `Title ${prompts}`;
            await new Promise(resolve => setTimeout(resolve, 5));
            client.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: title } });
            concurrent--;
            return { stopReason: "end_turn" };
        };

        expect(await Promise.all([provider.generateTitle("a"), provider.generateTitle("b"), provider.generateTitle("c")]))
            .toEqual(["Title 1", "Title 2", "Title 3"]);
        expect(maxConcurrent).toBe(1);
        const methods = FakeAcpClient.current?.requests.map(r => r.method);
        expect(methods).toEqual(["initialize", "session/new", "session/set_model", "session/prompt", "session/prompt", "session/prompt"]);
        const prompt = FakeAcpClient.current?.requests.find(r => r.method === "session/prompt")?.params as { prompt: { text: string }[] };
        expect(prompt.prompt[0].text).toContain("earlier messages in this conversation do not apply");
    });

    it("replaces the title session when it is full, failed, or its process ended, closing it where the agent can", async () => {
        const provider = new CopilotAgentProvider();
        FakeAcpClient.initializeResult = { agentCapabilities: { sessionCapabilities: { close: {} } } };
        const newSessions = () => FakeAcpClient.current?.requests.filter(r => r.method === "session/new").length ?? 0;
        const closed = () => FakeAcpClient.current?.requests.filter(r => r.method === "session/close").map(r => r.params);

        // Full: the next title opens a new session and closes the old one.
        for (let i = 0; i <= MAX_TITLES_PER_SESSION; i++) {
            FakeAcpClient.newSessionId = `sess-title-${newSessions()}`;
            await provider.generateTitle("hi");
        }
        expect(newSessions()).toBe(2);
        expect(closed()).toEqual([{ sessionId: "sess-title-0" }]);

        // Failed: the session is closed, and the next title opens another.
        FakeAcpClient.promptScript = async () => { throw new Error("prompt failed"); };
        expect(await provider.generateTitle("hi")).toBe("");
        expect(closed()).toEqual([{ sessionId: "sess-title-0" }, { sessionId: "sess-title-1" }]);
        FakeAcpClient.promptScript = async () => ({ stopReason: "end_turn" });
        FakeAcpClient.newSessionId = "sess-title-2";
        await provider.generateTitle("hi");
        expect(newSessions()).toBe(3);

        // A refused close is logged and changes nothing else.
        FakeAcpClient.sessionCloseError = new Error("unknown session");
        FakeAcpClient.promptScript = async () => { throw new Error("prompt failed"); };
        await provider.generateTitle("hi");
        expect(infoLogMock).toHaveBeenCalledWith(expect.stringContaining("session/close failed (unknown session)"));

        // Ended: the new process gets a session of its own, with no close sent to the old one.
        FakeAcpClient.sessionCloseError = undefined;
        FakeAcpClient.promptScript = async () => ({ stopReason: "end_turn" });
        await provider.generateTitle("hi");
        FakeAcpClient.current?.die();
        await provider.generateTitle("hi");
        expect(FakeAcpClient.current?.requests.map(r => r.method)).toEqual(["initialize", "session/new", "session/set_model", "session/prompt"]);
    });

    it("keeps using a session on an agent that cannot close one", async () => {
        const provider = new CopilotAgentProvider();
        FakeAcpClient.promptScript = async () => { throw new Error("prompt failed"); };
        await provider.generateTitle("hi");
        FakeAcpClient.promptScript = async () => ({ stopReason: "end_turn" });
        for (let i = 0; i <= MAX_TITLES_PER_SESSION; i++) {
            await provider.generateTitle("hi");
        }
        expect(FakeAcpClient.current?.requests.some(r => r.method === "session/close")).toBe(false);
    });

    it("still produces a title when the cheap model cannot be selected", async () => {
        FakeAcpClient.setModelError = new Error("model unavailable");
        FakeAcpClient.promptScript = async client => {
            client.update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Fallback title" } });
            return { stopReason: "end_turn" };
        };

        expect(await new CopilotAgentProvider().generateTitle("hi")).toBe("Fallback title");
    });

    it("returns an empty title and logs when the agent fails", async () => {
        FakeAcpClient.sessionNewError = new Error("spawn copilot ENOENT");

        expect(await new CopilotAgentProvider().generateTitle("hi")).toBe("");
        expect(errorLogMock).toHaveBeenCalledWith(expect.stringContaining("Failed to start the GitHub Copilot CLI"));
        expect(FakeAcpClient.current?.disposed).toBe(false);

        // A process that fails its handshake is not kept.
        resetModelCatalogCacheForTests();
        FakeAcpClient.initializeError = new Error("handshake rejected");
        expect(await new CopilotAgentProvider().generateTitle("hi")).toBe("");
        expect(FakeAcpClient.current?.disposed).toBe(true);
    });
});

describe("denyPermission (fail-closed)", () => {
    // Note tools are pre-approved via --allow-tool and never reach the callback;
    // anything that does is denied. Payload shapes mirror the real CLI 1.0.71
    // permission request captured live (opaque toolCallId, kind "execute").
    it("rejects a built-in shell tool, preferring a persistent reject_always", () => {
        const decision = decidePermission({
            toolCall: { toolCallId: "toolu_011pPt1cC28vErGNDqhwut15", title: "Echo hello", kind: "execute" },
            options: [
                { optionId: "allow_once", kind: "allow_once" },
                { optionId: "allow_always", kind: "allow_always" },
                { optionId: "reject_always", kind: "reject_always" },
                { optionId: "reject_once", kind: "reject_once" }
            ]
        });
        expect(decision).toEqual({ outcome: { outcome: "selected", optionId: "reject_always" } });
    });

    it("falls back to reject_once when no reject_always is offered (real CLI 1.0.71 shape)", () => {
        const decision = decidePermission({
            toolCall: { toolCallId: "toolu_x", title: "Echo hello", kind: "execute" },
            options: [
                { optionId: "allow_once", kind: "allow_once" },
                { optionId: "allow_always", kind: "allow_always" },
                { optionId: "reject_once", kind: "reject_once" }
            ]
        });
        expect(decision).toEqual({ outcome: { outcome: "selected", optionId: "reject_once" } });
    });

    it("cancels the turn when only allow options are offered (never allows)", () => {
        const decision = decidePermission({ toolCall: { toolCallId: "toolu_y" }, options: [{ optionId: "a", kind: "allow_once" }] });
        expect(decision).toEqual({ outcome: { outcome: "cancelled" } });
        // ...and when the request carries no tool call or options at all.
        expect(decidePermission({})).toEqual({ outcome: { outcome: "cancelled" } });
    });
});

describe("createUpdateCollector", () => {
    type UpdateCollector = ReturnType<typeof createUpdateCollector>;

    const notify = (collector: UpdateCollector, update: Record<string, unknown>, sessionId = "sess-1") =>
        collector.onNotification("session/update", { sessionId, update });

    /** A collector already bound to "sess-1", collecting into the returned array. */
    function boundCollector(): { collector: UpdateCollector; chunks: LlmStreamChunk[] } {
        const chunks: LlmStreamChunk[] = [];
        const collector = createUpdateCollector(chunk => chunks.push(chunk));
        collector.sessionId = "sess-1";
        return { collector, chunks };
    }

    it("ignores other methods, empty updates, and stray sessions", () => {
        const chunks: LlmStreamChunk[] = [];
        const collector = createUpdateCollector(chunk => chunks.push(chunk));
        const message = { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "nope" } };

        collector.onNotification("session/idle", {});
        collector.onNotification("session/update", { sessionId: "sess-1" });
        collector.sessionId = "sess-1";
        notify(collector, message, "sess-other");

        expect(chunks).toEqual([]);
    });

    it("drops message and thought chunks that carry no text, and unknown update kinds", () => {
        const { collector, chunks } = boundCollector();

        notify(collector, { sessionUpdate: "agent_message_chunk" });
        notify(collector, { sessionUpdate: "agent_message_chunk", content: { type: "image", data: "x", mimeType: "image/png" } });
        notify(collector, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "" } });
        notify(collector, { sessionUpdate: "plan", entries: [] });

        expect(chunks).toEqual([]);
    });

    it("ignores malformed, duplicate, and unannounced tool calls", () => {
        const { collector, chunks } = boundCollector();

        notify(collector, { sessionUpdate: "tool_call", title: "missing id" });
        notify(collector, { sessionUpdate: "tool_call_update", status: "completed" });
        notify(collector, { sessionUpdate: "tool_call_update", toolCallId: "never-announced", status: "completed" });
        expect(chunks).toEqual([]);

        // A re-announcement keeps the first registration (untitled → "tool").
        notify(collector, { sessionUpdate: "tool_call", toolCallId: "t1" });
        notify(collector, { sessionUpdate: "tool_call", toolCallId: "t1", title: "re-announced" });
        // Progress without a terminal status is not a result yet.
        notify(collector, { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "in_progress" });

        expect(chunks).toEqual([{ type: "tool_use", toolCallId: "t1", toolName: "tool", toolInput: {} }]);
    });

    it("reports a failed tool call and falls back to rawOutput for the result text", () => {
        const { collector, chunks } = boundCollector();

        notify(collector, { sessionUpdate: "tool_call", toolCallId: "t1", title: "create_note" });
        notify(collector, { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "failed", rawOutput: { error: "denied" } });
        notify(collector, { sessionUpdate: "tool_call", toolCallId: "t2", title: "read_note" });
        // No usable text in the blocks and no rawOutput → an empty result.
        notify(collector, { sessionUpdate: "tool_call_update", toolCallId: "t2", status: "completed", content: [null, { type: "image" }] });

        expect(chunks).toEqual([
            { type: "tool_use", toolCallId: "t1", toolName: "create_note", toolInput: {} },
            { type: "tool_result", toolCallId: "t1", toolName: "create_note", result: `{"error":"denied"}`, isError: true },
            { type: "tool_use", toolCallId: "t2", toolName: "read_note", toolInput: {} },
            { type: "tool_result", toolCallId: "t2", toolName: "read_note", result: "", isError: false }
        ]);
    });
});

describe("buildPromptBlocks", () => {
    beforeEach(() => resolveAttachmentPartMock.mockReset());

    it("joins the prefix with plain string content in a single text block", () => {
        expect(buildPromptBlocks("hello", "PREFIX")).toEqual([{ type: "text", text: "PREFIX\n\nhello" }]);
    });

    it("returns the content verbatim when there is no prefix", () => {
        expect(buildPromptBlocks("hello", "")).toEqual([{ type: "text", text: "hello" }]);
    });

    it("emits an image block for a supported image attachment, led by the prefix", () => {
        resolveAttachmentPartMock.mockReturnValue({ kind: "image", mime: "image/png", bytes: new Uint8Array([1, 2, 3]) });
        const blocks = buildPromptBlocks([{ type: "image", attachmentId: "a", mime: "image/png" }], "PREFIX");
        expect(blocks).toEqual([
            { type: "text", text: "PREFIX" },
            { type: "image", data: expect.any(String), mimeType: "image/png" }
        ]);
    });

    it("inlines text attachments and placeholders unsupported ones", () => {
        resolveAttachmentPartMock.mockImplementation((part?: { type: string }) =>
            part?.type === "text_attachment" ? { kind: "text", text: "inlined source" } : undefined);
        const blocks = buildPromptBlocks([
            { type: "text", text: "look:" },
            { type: "text_attachment", attachmentId: "t", filename: "a.md" },
            { type: "file", attachmentId: "p", mime: "application/pdf", filename: "doc.pdf" }
        ], "");
        expect(blocks).toEqual([
            { type: "text", text: "look:" },
            { type: "text", text: "inlined source" },
            { type: "text", text: "[attached file: doc.pdf]" }
        ]);
    });
});
