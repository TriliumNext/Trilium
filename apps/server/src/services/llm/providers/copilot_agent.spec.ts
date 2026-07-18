import type { LlmStreamChunk } from "@triliumnext/commons";
import { beforeEach, describe, expect, it, vi } from "vitest";

const errorLogMock = vi.hoisted(() => vi.fn());
vi.mock("@triliumnext/core", () => ({
    getLog: () => ({ info: vi.fn(), error: errorLogMock }),
    // buildSystemPrompt reads the workspace task states; none in this unit test.
    task_states: { getTaskStates: () => [] }
}));

vi.mock("../../data_dir.js", async () => {
    const os = await import("os");
    const path = await import("path");
    return { default: { TRILIUM_DATA_DIR: path.join(os.tmpdir(), "trilium-copilot-agent-spec") } };
});

// BYO binary resolution shells out to the user's `copilot`; stub it.
const resolveCopilotBinaryMock = vi.hoisted(() => vi.fn(async () => "/usr/bin/copilot"));
vi.mock("./copilot_binary.js", () => ({
    resolveCopilotBinaryPath: resolveCopilotBinaryMock,
    needsShell: () => false
}));

// The loopback MCP endpoint opens a real socket; stub it to a fixed URL.
const mcpEndpointMock = vi.hoisted(() => vi.fn(async () => "http://127.0.0.1:12345/mcp-secret"));
vi.mock("./copilot_mcp_endpoint.js", () => ({ getCopilotMcpEndpointUrl: mcpEndpointMock }));

const buildNoteHintMock = vi.hoisted(() => vi.fn((noteId: string): string | null => `NOTE_META(${noteId})`));
vi.mock("./note_hint.js", () => ({ buildNoteHint: buildNoteHintMock }));

const resolveAttachmentPartMock = vi.hoisted(() => vi.fn());
vi.mock("./attachment_content.js", () => ({ resolveAttachmentPart: resolveAttachmentPartMock }));

// A scriptable fake ACP client. `AcpClient.start` returns the active instance;
// each test scripts what `session/prompt` streams via onNotification and what
// it finally resolves to.
class FakeAcpClient {
    onNotification: (method: string, params: unknown) => void;
    onAgentRequest?: (method: string, params: unknown) => unknown;
    requests: { method: string; params: unknown }[] = [];
    notifications: { method: string; params: unknown }[] = [];
    disposed = false;

    static current: FakeAcpClient | undefined;
    static promptScript: (client: FakeAcpClient) => Promise<{ stopReason?: string }> = async () => ({ stopReason: "end_turn" });
    static sessionNewError: Error | undefined;

    constructor(opts: { onNotification: (m: string, p: unknown) => void; onAgentRequest?: (m: string, p: unknown) => unknown }) {
        this.onNotification = opts.onNotification;
        this.onAgentRequest = opts.onAgentRequest;
    }

    static start(_binary: string, opts: { args?: string[]; onNotification: (m: string, p: unknown) => void; onAgentRequest?: (m: string, p: unknown) => unknown }) {
        FakeAcpClient.current = new FakeAcpClient(opts);
        return FakeAcpClient.current;
    }

    async request<T>(method: string, params: unknown): Promise<T> {
        this.requests.push({ method, params });
        if (method === "initialize") return {} as T;
        if (method === "session/new") {
            if (FakeAcpClient.sessionNewError) throw FakeAcpClient.sessionNewError;
            return { sessionId: "sess-1" } as T;
        }
        if (method === "session/set_model") return {} as T;
        if (method === "session/prompt") return (await FakeAcpClient.promptScript(this)) as T;
        return {} as T;
    }

    notify(method: string, params: unknown): void {
        this.notifications.push({ method, params });
    }

    dispose(): void {
        this.disposed = true;
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

const { buildPromptBlocks, CopilotAgentProvider, decidePermission, resetAgentCwdForTests } = await import("./copilot_agent.js");

async function collect(iterable: AsyncIterable<LlmStreamChunk>): Promise<LlmStreamChunk[]> {
    const chunks: LlmStreamChunk[] = [];
    for await (const chunk of iterable) {
        chunks.push(chunk);
    }
    return chunks;
}

const userMessage = (text: string) => ({ role: "user" as const, content: text });

describe("CopilotAgentProvider.chatChunks", () => {
    beforeEach(() => {
        errorLogMock.mockReset();
        resolveAttachmentPartMock.mockReset();
        resetAgentCwdForTests();
        mcpEndpointMock.mockClear();
        FakeAcpClient.current = undefined;
        FakeAcpClient.sessionNewError = undefined;
        FakeAcpClient.promptScript = async () => ({ stopReason: "end_turn" });
    });

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
            { type: "done" }
        ]);
        expect(FakeAcpClient.current?.disposed).toBe(true);
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
        expect(FakeAcpClient.current?.disposed).toBe(true);
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

        expect(chunks).toEqual([{ type: "text", content: "partial" }, { type: "done" }]);
        expect(FakeAcpClient.current?.notifications).toContainEqual({ method: "session/cancel", params: { sessionId: "sess-1" } });
        expect(FakeAcpClient.current?.disposed).toBe(true);

        // The aborted session's real history is unknown, so the next turn must
        // reseed rather than resume it — even though the transcript lines up.
        FakeAcpClient.promptScript = async () => ({ stopReason: "end_turn" });
        await collect(provider.chatChunks(
            [userMessage("hi"), { role: "assistant", content: "partial" }, userMessage("more")],
            { chatNoteId: "chat-abort" }
        ));
        expect(FakeAcpClient.current?.requests.some(r => r.method === "session/load")).toBe(false);
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
});

describe("decidePermission (fail-closed)", () => {
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

    it("emits an image block for a supported image attachment", () => {
        resolveAttachmentPartMock.mockReturnValue({ kind: "image", mime: "image/png", bytes: new Uint8Array([1, 2, 3]) });
        const blocks = buildPromptBlocks([{ type: "image", attachmentId: "a", mime: "image/png" }], "");
        expect(blocks).toEqual([{ type: "image", data: expect.any(String), mimeType: "image/png" }]);
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
