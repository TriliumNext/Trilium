import type { LlmStreamChunk } from "@triliumnext/commons";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
const errorLogMock = vi.hoisted(() => vi.fn());
/** Streaming-input-only Query controls the session pool drives. */
const setModelMock = vi.hoisted(() => vi.fn());
const closeMock = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
    query: queryMock
}));

vi.mock("@triliumnext/core", () => ({
    getLog: () => ({ info: vi.fn(), error: errorLogMock }),
    // buildSystemPrompt (reached via composeSystemPrompt) reads the workspace
    // task states; no custom states in this unit test.
    task_states: { getTaskStates: () => [] }
}));

// In-process MCP: the provider hands the agent Trilium's own MCP server
// instance; stub the factory so tests don't build the real tool registry.
const createMcpServerMock = vi.hoisted(() => vi.fn(() => ({ mcpServerInstance: true })));
vi.mock("../../mcp/mcp_server.js", () => ({ createMcpServer: createMcpServerMock }));

vi.mock("../../data_dir.js", async () => {
    const os = await import("os");
    const path = await import("path");
    return { default: { TRILIUM_DATA_DIR: path.join(os.tmpdir(), "trilium-claude-agent-spec") } };
});

vi.mock("../../port.js", () => ({ default: 8080 }));

const buildNoteHintMock = vi.hoisted(() => vi.fn((noteId: string): string | null => `NOTE_META(${noteId})`));
vi.mock("./note_hint.js", () => ({ buildNoteHint: buildNoteHintMock }));

// BYO binary resolution shells out to the user's `claude`; stub it so tests
// don't depend on a real install. Resolves a path by default; can be made to
// reject (missing binary) per-test.
const resolveClaudeBinaryMock = vi.hoisted(() => vi.fn(async () => "/usr/bin/claude"));
vi.mock("./claude_binary.js", () => ({ resolveClaudeBinaryPath: resolveClaudeBinaryMock }));

// Attachment resolution reads bytes out of Becca, which the core mock above
// omits — stub it so the multimodal tests drive block construction directly.
const resolveAttachmentPartMock = vi.hoisted(() => vi.fn());
vi.mock("./attachment_content.js", () => ({ resolveAttachmentPart: resolveAttachmentPartMock }));

const { buildSeededPrompt, ClaudeAgentProvider, hashTranscript, resetAgentCwdForTests } = await import("./claude_agent.js");
const { resetClaudeSessionPoolForTests } = await import("./claude_session_pool.js");
type PushablePrompt = { pending: readonly { message: { role: string; content: unknown[] } }[] };

/**
 * Every turn now feeds the session's streaming input, so the `prompt` option is
 * always a Pushable and the turn's own message is what was pushed onto it.
 */
function pushedMessages(prompt: unknown): { message: { role: string; content: unknown[] } }[] {
    const pending = (prompt as PushablePrompt)?.pending;
    if (!Array.isArray(pending)) {
        throw new Error("expected the prompt to be a streaming-input Pushable");
    }
    return [...pending];
}

/** The single user message a turn streamed (multimodal path). */
function drainPrompt(prompt: unknown): { role: string; content: unknown[] } {
    const messages = pushedMessages(prompt);
    expect(messages).toHaveLength(1);
    return messages[0].message;
}

/** The plain text a turn pushed, for the non-multimodal path. */
function promptText(prompt: unknown): string {
    return drainPrompt(prompt).content
        .map(block => (block && typeof block === "object" && "text" in block ? String(block.text) : ""))
        .join("");
}

/**
 * One long-lived query stream serving several turns, as a warm session does:
 * the provider consumes up to each turn's `result` and resumes from there on
 * the next turn instead of starting a new query.
 */
function scriptAgentSession(turns: unknown[][]) {
    queryMock.mockImplementation(() => makeQuery(turns.flat()));
}

/** Make query() replay the given SDK messages and record its invocation. */
function scriptAgent(messages: unknown[]) {
    queryMock.mockImplementation(() => makeQuery(messages));
}

/**
 * A stand-in for the SDK's Query: an async generator plus the control methods
 * that only exist in streaming input mode, which the pool drives.
 */
function makeQuery(messages: unknown[]) {
    const generator = (async function* () {
        for (const message of messages) {
            yield message;
        }
    })();
    return Object.assign(generator, { setModel: setModelMock, close: closeMock });
}

async function collect(iterable: AsyncIterable<LlmStreamChunk>): Promise<LlmStreamChunk[]> {
    const chunks: LlmStreamChunk[] = [];
    for await (const chunk of iterable) {
        chunks.push(chunk);
    }
    return chunks;
}

function textDelta(text: string) {
    return {
        type: "stream_event",
        parent_tool_use_id: null,
        session_id: "sess-1",
        event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }
    };
}

function successResult(sessionId = "sess-1") {
    return {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "ok",
        session_id: sessionId,
        total_cost_usd: 0.05,
        usage: { input_tokens: 100, output_tokens: 40 }
    };
}

describe("ClaudeAgentProvider.chatChunks", () => {
    beforeEach(() => {
        queryMock.mockReset();
        errorLogMock.mockReset();
        createMcpServerMock.mockClear(); // clear calls, keep the instance impl
        resolveAttachmentPartMock.mockReset();
        // Sessions outlive a turn now, so each test must start from a cold
        // pool. Reset it *before* clearing the mocks: tearing down a leftover
        // session calls close() and would otherwise count against this test.
        resetClaudeSessionPoolForTests();
        setModelMock.mockClear();
        closeMock.mockClear();
    });

    it("maps stream events, tool calls, results, and usage to chunks in order", async () => {
        scriptAgent([
            { type: "system", subtype: "init", session_id: "sess-1" },
            textDelta("Hello "),
            {
                type: "stream_event",
                parent_tool_use_id: null,
                session_id: "sess-1",
                event: {
                    type: "content_block_start",
                    index: 1,
                    content_block: { type: "tool_use", id: "toolu_1", name: "mcp__trilium__search_notes" }
                }
            },
            {
                type: "stream_event",
                parent_tool_use_id: null,
                session_id: "sess-1",
                event: { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"query":' } }
            },
            {
                type: "assistant",
                parent_tool_use_id: null,
                session_id: "sess-1",
                message: {
                    content: [
                        { type: "text", text: "Hello " },
                        { type: "tool_use", id: "toolu_1", name: "mcp__trilium__search_notes", input: { query: "x" } }
                    ]
                }
            },
            {
                type: "user",
                parent_tool_use_id: null,
                session_id: "sess-1",
                message: {
                    content: [
                        { type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: "3 notes found" }] },
                        // A result for an unknown (e.g. replayed) tool call must be dropped.
                        { type: "tool_result", tool_use_id: "toolu_stale", content: "old" }
                    ]
                }
            },
            textDelta("world"),
            successResult()
        ]);

        const provider = new ClaudeAgentProvider();
        const chunks = await collect(provider.chatChunks([{ role: "user", content: "hi" }], {}));

        expect(chunks).toEqual([
            { type: "text", content: "Hello " },
            { type: "tool_input_start", toolCallId: "toolu_1", toolName: "search_notes" },
            { type: "tool_input_delta", toolCallId: "toolu_1", delta: '{"query":' },
            { type: "tool_use", toolCallId: "toolu_1", toolName: "search_notes", toolInput: { query: "x" } },
            { type: "tool_result", toolCallId: "toolu_1", toolName: "search_notes", result: "3 notes found", isError: false },
            { type: "text", content: "world" },
            {
                type: "usage",
                // No cost even though the SDK result carries total_cost_usd: usage is
                // covered by the subscription, so a per-turn dollar figure isn't shown.
                usage: { promptTokens: 100, completionTokens: 40, totalTokens: 140, model: "Claude Sonnet 5" }
            },
            { type: "done" }
        ]);
    });

    it("reports the friendly model name in usage, falling back to the raw ID for unknown models", async () => {
        const provider = new ClaudeAgentProvider();
        const usageModel = async (config: { model?: string }) => {
            scriptAgent([successResult()]);
            const chunks = await collect(provider.chatChunks([{ role: "user", content: "hi" }], config));
            const usage = chunks.find(c => c.type === "usage");
            return usage?.type === "usage" ? usage.usage.model : undefined;
        };

        // A known model ID is mapped to its display name (the chat pane renders it verbatim).
        expect(await usageModel({ model: "claude-fable-5" })).toBe("Claude Fable 5");
        // An unrecognized ID passes through unchanged rather than becoming undefined.
        expect(await usageModel({ model: "some-unknown-model" })).toBe("some-unknown-model");
    });

    it("ignores subagent traffic (non-null parent_tool_use_id)", async () => {
        scriptAgent([
            { ...textDelta("subagent text"), parent_tool_use_id: "toolu_parent" },
            successResult()
        ]);

        const provider = new ClaudeAgentProvider();
        const chunks = await collect(provider.chatChunks([{ role: "user", content: "hi" }], {}));

        expect(chunks.filter(c => c.type === "text")).toEqual([]);
    });

    it("keeps one warm session across turns, pushing the next message onto its streaming input", async () => {
        const provider = new ClaudeAgentProvider();
        const config = { chatNoteId: "note-resume" };

        scriptAgentSession([
            [textDelta("first reply"), successResult("sess-A")],
            [textDelta("second reply"), successResult("sess-A")]
        ]);

        // Turn 1 — no history, no mapping: plain prompt, no resume.
        await collect(provider.chatChunks([{ role: "user", content: "first question" }], config));

        expect(queryMock).toHaveBeenCalledTimes(1);
        const call = queryMock.mock.calls[0][0];
        expect(call.options.resume).toBeUndefined();

        // Turn 2 — the transcript still matches, so the live subprocess is
        // reused: no second query(), just another message on the same input.
        const second = await collect(provider.chatChunks([
            { role: "user", content: "first question" },
            { role: "assistant", content: "first reply" },
            { role: "user", content: "second question" }
        ], config));

        expect(queryMock).toHaveBeenCalledTimes(1);
        expect(second).toContainEqual({ type: "text", content: "second reply" });
        const pushed = pushedMessages(call.prompt).map(m => (m.message.content[0] as { text: string }).text);
        expect(pushed).toEqual(["first question", "second question"]);
    });

    it("reseeds a fresh session from the transcript when the history diverged", async () => {
        const provider = new ClaudeAgentProvider();
        const config = { chatNoteId: "note-diverged" };

        scriptAgent([textDelta("reply"), successResult("sess-B")]);
        await collect(provider.chatChunks([{ role: "user", content: "original" }], config));

        // The user edited the first message — the stored hash no longer matches.
        scriptAgent([textDelta("re-reply"), successResult("sess-C")]);
        await collect(provider.chatChunks([
            { role: "user", content: "edited" },
            { role: "assistant", content: "reply" },
            { role: "user", content: "follow-up" }
        ], config));

        const secondCall = queryMock.mock.calls[1][0];
        expect(secondCall.options.resume).toBeUndefined();
        expect(promptText(secondCall.prompt)).toContain("<conversation_history>");
        expect(promptText(secondCall.prompt)).toContain("User: edited");
        expect(promptText(secondCall.prompt)).toContain("Assistant: reply");
        expect(promptText(secondCall.prompt)).toContain("follow-up");
    });

    it("prepends the current-note metadata hint to the user message when contextNoteId is set", async () => {
        buildNoteHintMock.mockClear();
        scriptAgent([successResult()]);
        const provider = new ClaudeAgentProvider();
        await collect(provider.chatChunks(
            [{ role: "user", content: "what is this note about?" }],
            { contextNoteId: "note-abc" }
        ));

        expect(buildNoteHintMock).toHaveBeenCalledWith("note-abc", false);
        expect(promptText(queryMock.mock.calls[0][0].prompt)).toBe("NOTE_META(note-abc)\n\nwhat is this note about?");
    });

    it("does not prepend a hint when the context note no longer exists", async () => {
        buildNoteHintMock.mockReturnValueOnce(null);
        scriptAgent([successResult()]);
        const provider = new ClaudeAgentProvider();
        await collect(provider.chatChunks(
            [{ role: "user", content: "hello" }],
            { contextNoteId: "gone" }
        ));

        expect(promptText(queryMock.mock.calls[0][0].prompt)).toBe("hello");
    });

    it("keeps the note hint out of the session hash so a later turn still resumes", async () => {
        const provider = new ClaudeAgentProvider();
        const config = { contextNoteId: "note-abc", chatNoteId: "note-hint-resume" };

        scriptAgentSession([
            [textDelta("first reply"), successResult("sess-H")],
            [textDelta("second reply"), successResult("sess-H")]
        ]);
        await collect(provider.chatChunks([{ role: "user", content: "q1" }], config));

        // Turn 2: transcript matches turn 1 (unhinted), so the warm session is
        // reused, and the new message still carries the freshly-built hint.
        await collect(provider.chatChunks([
            { role: "user", content: "q1" },
            { role: "assistant", content: "first reply" },
            { role: "user", content: "q2" }
        ], config));

        expect(queryMock).toHaveBeenCalledTimes(1);
        const pushed = pushedMessages(queryMock.mock.calls[0][0].prompt);
        expect((pushed[1].message.content[0] as { text: string }).text).toBe("NOTE_META(note-abc)\n\nq2");
    });

    it("sends a supported image as a base64 block via a one-message stream", async () => {
        resolveAttachmentPartMock.mockReturnValue({ kind: "image", bytes: new Uint8Array([1, 2, 3]), mime: "image/png" });
        scriptAgent([textDelta("I see it"), successResult()]);
        const provider = new ClaudeAgentProvider();
        await collect(provider.chatChunks([
            { role: "user", content: [
                { type: "text", text: "what is this?" },
                { type: "image", attachmentId: "att-1", mime: "image/png" }
            ] }
        ], {}));

        const message = drainPrompt(queryMock.mock.calls[0][0].prompt);
        expect(message.role).toBe("user");
        expect(message.content).toEqual([
            { type: "text", text: "what is this?" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "AQID" } }
        ]);
    });

    it("sends a PDF as a document block and leads with the note hint", async () => {
        resolveAttachmentPartMock.mockReturnValue({ kind: "file", bytes: new Uint8Array([37, 80, 68, 70]), mime: "application/pdf", filename: "report.pdf" });
        scriptAgent([textDelta("summary"), successResult()]);
        const provider = new ClaudeAgentProvider();
        await collect(provider.chatChunks([
            { role: "user", content: [{ type: "file", attachmentId: "att-2", mime: "application/pdf", filename: "report.pdf" }] }
        ], { contextNoteId: "note-abc" }));

        const message = drainPrompt(queryMock.mock.calls[0][0].prompt);
        expect(message.content).toEqual([
            { type: "text", text: "NOTE_META(note-abc)" },
            { type: "document", title: "report.pdf", source: { type: "base64", media_type: "application/pdf", data: "JVBERg==" } }
        ]);
    });

    it("degrades unsupported attachments to text and keeps the plain string prompt", async () => {
        // An SVG resolves to inlined text; the string path (not the stream) is used.
        resolveAttachmentPartMock.mockReturnValue({ kind: "text", text: "<file name=\"d.svg\">\n<svg/>\n</file>" });
        scriptAgent([textDelta("ok"), successResult()]);
        const provider = new ClaudeAgentProvider();
        await collect(provider.chatChunks([
            { role: "user", content: [
                { type: "text", text: "read this" },
                { type: "image", attachmentId: "att-3", mime: "image/svg+xml" }
            ] }
        ], {}));

        // Degrades to a single text block rather than image/document blocks.
        const message = drainPrompt(queryMock.mock.calls[0][0].prompt);
        expect(message.content).toEqual([
            { type: "text", text: "read this\n\n<file name=\"d.svg\">\n<svg/>\n</file>" }
        ]);
    });

    it("wires Trilium's in-process MCP server instance and disables built-in tools", async () => {
        scriptAgent([successResult()]);
        const provider = new ClaudeAgentProvider();
        await collect(provider.chatChunks([{ role: "user", content: "hi" }], {}));

        const options = queryMock.mock.calls[0][0].options;
        expect(options.tools).toEqual([]);
        expect(options.allowedTools).toEqual(["mcp__trilium"]);
        // In-process (sdk) transport, not an HTTP endpoint — the instance is
        // Trilium's own createMcpServer(), tunneled over the SDK control channel.
        expect(options.mcpServers.trilium.type).toBe("sdk");
        expect(options.mcpServers.trilium.instance).toEqual({ mcpServerInstance: true });
        expect(createMcpServerMock).toHaveBeenCalled();
        expect(options.permissionMode).toBe("dontAsk");
        expect(options.settingSources).toEqual([]);
    });

    it("enables adaptive extended thinking when the turn requests it", async () => {
        scriptAgent([successResult()]);
        const provider = new ClaudeAgentProvider();
        await collect(provider.chatChunks([{ role: "user", content: "hi" }], { enableExtendedThinking: true }));

        expect(queryMock.mock.calls[0][0].options.thinking).toEqual({ type: "adaptive", display: "summarized" });
    });

    it("disables extended thinking by default", async () => {
        scriptAgent([successResult()]);
        const provider = new ClaudeAgentProvider();
        await collect(provider.chatChunks([{ role: "user", content: "hi" }], {}));

        expect(queryMock.mock.calls[0][0].options.thinking).toEqual({ type: "disabled" });
    });

    it("drives the user's resolved claude binary (bring-your-own-binary)", async () => {
        resolveClaudeBinaryMock.mockResolvedValueOnce("/opt/homebrew/bin/claude");
        scriptAgent([successResult()]);
        const provider = new ClaudeAgentProvider();
        await collect(provider.chatChunks([{ role: "user", content: "hi" }], {}));

        expect(queryMock.mock.calls[0][0].options.pathToClaudeCodeExecutable).toBe("/opt/homebrew/bin/claude");
    });

    it("surfaces a friendly error (and never spawns) when Claude Code isn't installed", async () => {
        resolveClaudeBinaryMock.mockRejectedValueOnce(
            new Error("Claude Code CLI not found. Install it and run `claude /login`...")
        );
        const provider = new ClaudeAgentProvider();
        const chunks = await collect(provider.chatChunks([{ role: "user", content: "hi" }], {}));

        expect(queryMock).not.toHaveBeenCalled();
        const errors = chunks.filter(c => c.type === "error");
        expect(errors).toHaveLength(1);
        expect(errors[0].error).toContain("Claude Code CLI not found");
    });

    it("uses Trilium's shared system prompt (skill/link/markdown guidance) when note tools are live", async () => {
        scriptAgent([successResult()]);
        const provider = new ClaudeAgentProvider();
        await collect(provider.chatChunks([{ role: "user", content: "hi" }], { enableNoteTools: true }));

        const systemPrompt = queryMock.mock.calls[0][0].options.systemPrompt;
        // Parity with the AI-SDK providers: the shared buildSystemPrompt content.
        expect(systemPrompt).toContain("load_skill");
        expect(systemPrompt).toContain("wiki-link format [[noteId]]");
        expect(systemPrompt).toContain("Mermaid diagrams");
        // Note tools ARE live, so no "turned off" degradation notice.
        expect(systemPrompt).not.toContain("MCP server is turned off");
    });

    it("isolates the agent cwd from enclosing projects with a .git marker", async () => {
        scriptAgent([successResult()]);
        const provider = new ClaudeAgentProvider();
        await collect(provider.chatChunks([{ role: "user", content: "hi" }], {}));

        const path = await import("path");
        const fs = await import("fs");
        const cwd = queryMock.mock.calls[0][0].options.cwd;
        // Absolute cwd (TRILIUM_DATA_DIR may be relative in dev runs) with a
        // .git marker so Claude Code never resolves an enclosing repo as the
        // agent's project — that would apply the repo's disabledMcpjsonServers
        // list (silently disabling the "trilium" server by name), CLAUDE.md,
        // and auto-memory to note chats.
        expect(path.isAbsolute(cwd)).toBe(true);
        expect(fs.existsSync(path.join(cwd, ".git", "HEAD"))).toBe(true);
    });

    it("omits note-tools wiring (and its prompt guidance) when the chat disables note tools, and enables web search", async () => {
        scriptAgent([successResult()]);
        const provider = new ClaudeAgentProvider();
        await collect(provider.chatChunks([{ role: "user", content: "hi" }], { enableNoteTools: false, enableWebSearch: true }));

        const options = queryMock.mock.calls[0][0].options;
        expect(options.mcpServers).toBeUndefined();
        expect(createMcpServerMock).not.toHaveBeenCalled();
        expect(options.tools).toEqual(["WebSearch", "WebFetch"]);
        expect(options.allowedTools).toEqual(["WebSearch", "WebFetch"]);
        // Prompt matches the wiring: no note-tools guidance when they're off.
        expect(options.systemPrompt).not.toContain("load_skill");
        expect(options.systemPrompt).toContain("do not have access to the user's notes");
    });

    it("logs a diagnostic when the in-process MCP bridge fails to connect", async () => {
        scriptAgent([
            { type: "system", subtype: "init", session_id: "s", mcp_servers: [{ name: "trilium", status: "failed" }] },
            successResult()
        ]);
        const provider = new ClaudeAgentProvider();
        await collect(provider.chatChunks([{ role: "user", content: "hi" }], {}));

        expect(errorLogMock).toHaveBeenCalledWith(expect.stringContaining("failed to connect"));
    });

    it("does not log a bridge diagnostic on a healthy connected init", async () => {
        scriptAgent([
            { type: "system", subtype: "init", session_id: "s", mcp_servers: [{ name: "trilium", status: "connected" }] },
            successResult()
        ]);
        const provider = new ClaudeAgentProvider();
        await collect(provider.chatChunks([{ role: "user", content: "hi" }], {}));

        expect(errorLogMock).not.toHaveBeenCalled();
    });

    it("surfaces authentication failures with a login hint", async () => {
        scriptAgent([
            {
                type: "assistant",
                parent_tool_use_id: null,
                session_id: "sess-1",
                error: "authentication_failed",
                message: { content: [] }
            },
            { ...successResult(), subtype: "error_during_execution", is_error: true, errors: ["auth failed"] }
        ]);

        const provider = new ClaudeAgentProvider();
        const chunks = await collect(provider.chatChunks([{ role: "user", content: "hi" }], {}));

        const errors = chunks.filter(c => c.type === "error");
        expect(errors[0].error).toContain("claude /login");
    });

    it("emits an error chunk when the agent subprocess fails", async () => {
        queryMock.mockImplementation(() => (async function* () {
            yield textDelta("partial");
            throw new Error("spawn claude ENOENT");
        })());

        const provider = new ClaudeAgentProvider();
        const chunks = await collect(provider.chatChunks([{ role: "user", content: "hi" }], {}));

        const errors = chunks.filter(c => c.type === "error");
        expect(errors).toHaveLength(1);
        expect(errors[0].error).toContain("Failed to start Claude Code");
    });

    it("forwards a mid-stream abort to the agent's abort controller", async () => {
        scriptAgent([textDelta("partial"), successResult()]);
        const controller = new AbortController();
        const provider = new ClaudeAgentProvider();
        const stream = provider.chatChunks([{ role: "user", content: "hi" }], {}, controller.signal);

        const chunks: LlmStreamChunk[] = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
            // Fire the abort after the first chunk; the mocked SDK stream keeps
            // yielding, proving the listener path itself doesn't break the loop.
            controller.abort();
        }
        expect(chunks.some(c => c.type === "text")).toBe(true);
    });

    it("does not spawn the agent when the signal is already aborted at entry", async () => {
        // An abort listener alone would never fire for a pre-aborted signal —
        // the provider must bail out before spawning the subprocess.
        const controller = new AbortController();
        controller.abort();

        const provider = new ClaudeAgentProvider();
        const chunks = await collect(provider.chatChunks([{ role: "user", content: "hi" }], {}, controller.signal));

        expect(chunks).toEqual([]);
        expect(queryMock).not.toHaveBeenCalled();
    });

    it("rejects a conversation that does not end with a user message (or is empty)", async () => {
        const provider = new ClaudeAgentProvider();
        const expected = [{ type: "error", error: "The last message must be a user message." }];
        expect(await collect(provider.chatChunks([{ role: "assistant", content: "hi" }], {}))).toEqual(expected);
        expect(await collect(provider.chatChunks([], {}))).toEqual(expected);
        expect(queryMock).not.toHaveBeenCalled();
    });

    it("exposes the subscription model list, zero pricing, and no chat() implementation", () => {
        const provider = new ClaudeAgentProvider();
        const models = provider.getAvailableModels();
        expect(models.some(m => m.id === "claude-sonnet-5" && m.isDefault)).toBe(true);
        expect(provider.getModelPricing("claude-sonnet-5")).toEqual(expect.objectContaining({ input: 0, output: 0 }));
        expect(provider.getModelPricing("no-such-model")).toBeUndefined();
        expect(() => provider.chat()).toThrow(/chatChunks/);
    });

    it("streams thinking deltas as thinking chunks", async () => {
        scriptAgent([
            {
                type: "stream_event",
                parent_tool_use_id: null,
                session_id: "sess-1",
                event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "pondering…" } }
            },
            successResult()
        ]);
        const provider = new ClaudeAgentProvider();
        const chunks = await collect(provider.chatChunks([{ role: "user", content: "hi" }], {}));
        expect(chunks).toContainEqual({ type: "thinking", content: "pondering…" });
    });

    it("ignores stream noise: non-tool block starts, unknown deltas, unmapped tool indexes, other events", async () => {
        scriptAgent([
            // content_block_start for a plain text block — no chunk.
            {
                type: "stream_event",
                parent_tool_use_id: null,
                session_id: "sess-1",
                event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }
            },
            // A delta type the provider doesn't map — no chunk.
            {
                type: "stream_event",
                parent_tool_use_id: null,
                session_id: "sess-1",
                event: { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } }
            },
            // input_json_delta for a block index that never had a tool_use start.
            {
                type: "stream_event",
                parent_tool_use_id: null,
                session_id: "sess-1",
                event: { type: "content_block_delta", index: 9, delta: { type: "input_json_delta", partial_json: "{}" } }
            },
            // A stream event that is neither block start nor delta.
            {
                type: "stream_event",
                parent_tool_use_id: null,
                session_id: "sess-1",
                event: { type: "message_start" }
            },
            // An SDK message type the provider doesn't know (and no session_id).
            { type: "diagnostic" },
            successResult()
        ]);
        const provider = new ClaudeAgentProvider();
        const chunks = await collect(provider.chatChunks([{ role: "user", content: "hi" }], {}));
        expect(chunks.map(c => c.type)).toEqual(["usage", "done"]);
    });

    it("ignores assistant/user messages from subagents and non-array user content", async () => {
        scriptAgent([
            {
                type: "assistant",
                parent_tool_use_id: "toolu_parent",
                session_id: "sess-1",
                message: { content: [{ type: "tool_use", id: "toolu_sub", name: "sub_tool", input: {} }] }
            },
            {
                type: "user",
                parent_tool_use_id: "toolu_parent",
                session_id: "sess-1",
                message: { content: [{ type: "tool_result", tool_use_id: "toolu_sub", content: "sub result" }] }
            },
            {
                type: "user",
                parent_tool_use_id: null,
                session_id: "sess-1",
                message: { content: "a plain string user echo" }
            },
            successResult()
        ]);
        const provider = new ClaudeAgentProvider();
        const chunks = await collect(provider.chatChunks([{ role: "user", content: "hi" }], {}));
        expect(chunks.map(c => c.type)).toEqual(["usage", "done"]);
    });

    it("flattens tool results of every content shape and skips non-result blocks", async () => {
        // No `input` field — exercises the `block.input ?? {}` fallback on the tool_use chunk.
        const toolUse = (id: string) => ({ type: "tool_use", id, name: `mcp__trilium__t_${id}` });
        scriptAgent([
            {
                type: "assistant",
                parent_tool_use_id: null,
                session_id: "sess-1",
                message: { content: [toolUse("t1"), toolUse("t2"), toolUse("t3"), toolUse("t4")] }
            },
            {
                type: "user",
                parent_tool_use_id: null,
                session_id: "sess-1",
                message: {
                    content: [
                        // A non-result block and an id-less result must both be skipped.
                        { type: "text", text: "interleaved commentary" },
                        { type: "tool_result", content: "no id" },
                        { type: "tool_result", tool_use_id: "t1", content: "plain string" },
                        { type: "tool_result", tool_use_id: "t2" }, // no content
                        { type: "tool_result", tool_use_id: "t3", content: [{ type: "image" }] },
                        { type: "tool_result", tool_use_id: "t4", content: { odd: true } }
                    ]
                }
            },
            successResult()
        ]);
        const provider = new ClaudeAgentProvider();
        const chunks = await collect(provider.chatChunks([{ role: "user", content: "hi" }], {}));

        const results = chunks.filter(c => c.type === "tool_result");
        expect(results.map(r => [r.toolName, r.result])).toEqual([
            ["t_t1", "plain string"],
            ["t_t2", ""],
            ["t_t3", ""], // array without text blocks flattens to nothing
            ["t_t4", '{"odd":true}']
        ]);
    });

    it("reports a stop reason when the agent fails without an error list", async () => {
        scriptAgent([
            { ...successResult(), subtype: "error_max_turns", is_error: true }
        ]);
        const provider = new ClaudeAgentProvider();
        const chunks = await collect(provider.chatChunks([{ role: "user", content: "hi" }], {}));
        const errors = chunks.filter(c => c.type === "error");
        expect(errors).toEqual([{ type: "error", error: "Agent stopped: error_max_turns" }]);
    });

    it("maps oauth failures to the login hint and other assistant errors to a generic message", async () => {
        scriptAgent([
            {
                type: "assistant",
                parent_tool_use_id: null,
                session_id: "sess-1",
                error: "oauth_org_not_allowed",
                message: { content: [] }
            },
            {
                type: "assistant",
                parent_tool_use_id: null,
                session_id: "sess-1",
                error: "billing_issue",
                message: { content: [] }
            },
            successResult()
        ]);
        const provider = new ClaudeAgentProvider();
        const chunks = await collect(provider.chatChunks([{ role: "user", content: "hi" }], {}));
        const errors = chunks.filter(c => c.type === "error").map(c => c.error);
        expect(errors[0]).toContain("claude /login");
        expect(errors[1]).toBe("Claude Agent error: billing_issue");
    });

    it("stringifies non-Error throws from the SDK", async () => {
        queryMock.mockImplementation(() => {
            throw "subprocess exploded";
        });
        const provider = new ClaudeAgentProvider();
        const chunks = await collect(provider.chatChunks([{ role: "user", content: "hi" }], {}));
        expect(chunks).toContainEqual({ type: "error", error: "subprocess exploded" });
    });

    it("ignores non-init system messages and inits without a trilium MCP entry", async () => {
        scriptAgent([
            { type: "system", subtype: "compact_boundary", session_id: "s" },
            { type: "system", subtype: "init", session_id: "s" }, // no mcp_servers at all
            { type: "system", subtype: "init", session_id: "s", mcp_servers: [{ name: "other", status: "failed" }] },
            successResult()
        ]);
        const provider = new ClaudeAgentProvider();
        await collect(provider.chatChunks([{ role: "user", content: "hi" }], {}));
        expect(errorLogMock).not.toHaveBeenCalled();
    });

    it("degrades unresolved and natively-unsupported attachments to placeholders around real blocks", async () => {
        resolveAttachmentPartMock
            .mockReturnValueOnce({ kind: "image", bytes: new Uint8Array([1]), mime: "image/png" })
            .mockReturnValueOnce(null) // missing/protected attachment
            .mockReturnValueOnce({ kind: "image", bytes: new Uint8Array([2]), mime: "image/tiff" })
            .mockReturnValueOnce({ kind: "file", bytes: new Uint8Array([3]), mime: "application/zip", filename: "a.zip" });
        scriptAgent([successResult()]);
        const provider = new ClaudeAgentProvider();
        await collect(provider.chatChunks([
            { role: "user", content: [
                { type: "image", attachmentId: "png", mime: "image/png" },
                { type: "image", attachmentId: "gone", mime: "image/png" },
                { type: "image", attachmentId: "tiff", mime: "image/tiff" },
                { type: "file", attachmentId: "zip", mime: "application/zip", filename: "a.zip" }
            ] }
        ], {}));

        const message = drainPrompt(queryMock.mock.calls[0][0].prompt);
        expect(message.content).toEqual([
            { type: "image", source: { type: "base64", media_type: "image/png", data: "AQ==" } },
            { type: "text", text: "[attached image]" },
            { type: "text", text: "[attached image]" },
            { type: "text", text: "[attached file: a.zip]" }
        ]);
    });

    it("keeps the plain string prompt for parts-form content without attachments", async () => {
        scriptAgent([successResult()]);
        const provider = new ClaudeAgentProvider();
        await collect(provider.chatChunks([
            { role: "user", content: [{ type: "text", text: "line one" }, { type: "text", text: "line two" }] }
        ], {}));
        expect(promptText(queryMock.mock.calls[0][0].prompt)).toBe("line one\nline two");
    });

    it("creates the isolating .git marker only when it is absent", async () => {
        const path = await import("path");
        const fs = await import("fs");
        const os = await import("os");
        const agentDir = path.join(os.tmpdir(), "trilium-claude-agent-spec", "claude-agent");

        resetAgentCwdForTests();
        fs.rmSync(agentDir, { recursive: true, force: true });
        scriptAgent([successResult()]);
        const provider = new ClaudeAgentProvider();
        await collect(provider.chatChunks([{ role: "user", content: "hi" }], {}));
        expect(fs.existsSync(path.join(agentDir, ".git", "HEAD"))).toBe(true);

        // Second initialization finds the marker in place and leaves it alone.
        const headBefore = fs.statSync(path.join(agentDir, ".git", "HEAD")).mtimeMs;
        resetAgentCwdForTests();
        scriptAgent([successResult()]);
        await collect(provider.chatChunks([{ role: "user", content: "hi" }], {}));
        expect(fs.statSync(path.join(agentDir, ".git", "HEAD")).mtimeMs).toBe(headBefore);
    });

    it("switches models on the live session instead of respawning it", async () => {
        const provider = new ClaudeAgentProvider();
        const config = { chatNoteId: "note-model" };
        scriptAgentSession([
            [textDelta("a"), successResult("sess-M")],
            [textDelta("b"), successResult("sess-M")]
        ]);

        await collect(provider.chatChunks([{ role: "user", content: "q1" }], { ...config, model: "claude-sonnet-5" }));
        await collect(provider.chatChunks([
            { role: "user", content: "q1" },
            { role: "assistant", content: "a" },
            { role: "user", content: "q2" }
        ], { ...config, model: "claude-haiku-4-5-20251001" }));

        // setModel is a streaming-input-only control: it is why a model change
        // costs ~0 ms instead of a cold start.
        expect(queryMock).toHaveBeenCalledTimes(1);
        expect(setModelMock).toHaveBeenCalledExactlyOnceWith("claude-haiku-4-5-20251001");
    });

    it("starts a new session when an option fixed at construction changes", async () => {
        const provider = new ClaudeAgentProvider();
        const config = { chatNoteId: "note-fixed" };
        scriptAgent([textDelta("a"), successResult("sess-F")]);
        await collect(provider.chatChunks([{ role: "user", content: "q1" }], { ...config, enableNoteTools: true }));

        // Note tools are wired into query()'s options and can't be changed on a
        // live session, so this must build a new one (and retire the old).
        scriptAgent([textDelta("b"), successResult("sess-F2")]);
        await collect(provider.chatChunks([
            { role: "user", content: "q1" },
            { role: "assistant", content: "a" },
            { role: "user", content: "q2" }
        ], { ...config, enableNoteTools: false }));

        expect(queryMock).toHaveBeenCalledTimes(2);
        expect(closeMock).toHaveBeenCalled();
    });

    it("closes the session after an aborted turn rather than reusing a half-finished one", async () => {
        const controller = new AbortController();
        const provider = new ClaudeAgentProvider();
        const config = { chatNoteId: "note-abort" };

        // The turn is cancelled mid-stream, so the session's real state is
        // unknown — it must not be handed to the next turn.
        queryMock.mockImplementation(() => makeQuery([textDelta("partial"), successResult("sess-X")]));
        const chunks = await collect(provider.chatChunks(
            [{ role: "user", content: "q" }],
            config,
            (controller.abort(), controller.signal)
        ));

        expect(chunks).toEqual([]);
        expect(closeMock).not.toHaveBeenCalled(); // nothing was started to close

        // A later turn starts a fresh session rather than resuming.
        scriptAgent([textDelta("ok"), successResult("sess-Y")]);
        await collect(provider.chatChunks([{ role: "user", content: "q" }], config));
        expect(queryMock).toHaveBeenCalledTimes(1);
    });

    it("evicts the oldest chat-note mapping once the session cap is exceeded", async () => {
        const provider = new ClaudeAgentProvider();

        scriptAgent([textDelta("r"), successResult("sess-victim")]);
        await collect(provider.chatChunks([{ role: "user", content: "q" }], { chatNoteId: "victim" }));

        // 200 further distinct chat notes push "victim" past the cap.
        for (let i = 0; i < 200; i++) {
            scriptAgent([textDelta("r"), successResult(`sess-${i}`)]);
            await collect(provider.chatChunks([{ role: "user", content: "q" }], { chatNoteId: `filler-${i}` }));
        }

        // This test is about the chat-note → session-id map, not the warm
        // subprocess pool; drop the warm sessions so both follow-ups have to
        // start a query and reveal what they would resume.
        resetClaudeSessionPoolForTests();

        // Despite a perfectly matching transcript, the victim can no longer resume.
        scriptAgent([successResult()]);
        await collect(provider.chatChunks([
            { role: "user", content: "q" },
            { role: "assistant", content: "r" },
            { role: "user", content: "q2" }
        ], { chatNoteId: "victim" }));
        const lastCall = queryMock.mock.calls[queryMock.mock.calls.length - 1][0];
        expect(lastCall.options.resume).toBeUndefined();

        // A recent filler still resumes — only the oldest entry was dropped.
        scriptAgent([successResult()]);
        await collect(provider.chatChunks([
            { role: "user", content: "q" },
            { role: "assistant", content: "r" },
            { role: "user", content: "q2" }
        ], { chatNoteId: "filler-199" }));
        const fillerCall = queryMock.mock.calls[queryMock.mock.calls.length - 1][0];
        expect(fillerCall.options.resume).toBe("sess-199");
    });
});

describe("generateTitle", () => {
    beforeEach(() => {
        queryMock.mockReset();
    });

    it("returns the agent's one-shot result with surrounding quotes stripped", async () => {
        scriptAgent([{ ...successResult(), result: '"Meeting Notes Summary"' }]);
        const provider = new ClaudeAgentProvider();
        await expect(provider.generateTitle("summarize my meeting notes")).resolves.toBe("Meeting Notes Summary");

        const options = queryMock.mock.calls[0][0].options;
        expect(options.maxTurns).toBe(1);
        expect(options.persistSession).toBe(false);
    });

    it("returns an empty string when the agent fails", async () => {
        queryMock.mockImplementation(() => (async function* () {
            throw new Error("not logged in");
            yield undefined;
        })());
        const provider = new ClaudeAgentProvider();
        await expect(provider.generateTitle("hello")).resolves.toBe("");
    });

    it("skips non-result messages and returns empty on a non-success result", async () => {
        scriptAgent([textDelta("streamed noise"), { ...successResult(), result: "The Title" }]);
        const provider = new ClaudeAgentProvider();
        await expect(provider.generateTitle("hello")).resolves.toBe("The Title");

        scriptAgent([{ ...successResult(), subtype: "error_during_execution", is_error: true, errors: [] }]);
        await expect(provider.generateTitle("hello")).resolves.toBe("");
    });
});

describe("transcript helpers", () => {
    it("hashTranscript is stable across content shapes and sensitive to edits", () => {
        const stringForm = hashTranscript([{ role: "user", content: "hello" }]);
        const partsForm = hashTranscript([{ role: "user", content: [{ type: "text", text: "hello" }] }]);
        expect(stringForm).toBe(partsForm);
        expect(hashTranscript([{ role: "user", content: "hello!" }])).not.toBe(stringForm);
        // Attachment parts flatten to stable placeholders, so re-sent bytes don't break resume.
        const withImage = hashTranscript([{ role: "user", content: [{ type: "image", attachmentId: "a", mime: "image/png" }] }]);
        expect(withImage).toBe(hashTranscript([{ role: "user", content: "[attached image]" }]));
    });

    it("buildSeededPrompt replays the transcript with role labels", () => {
        const prompt = buildSeededPrompt(
            [
                { role: "user", content: "q1" },
                { role: "assistant", content: "a1" }
            ],
            "q2"
        );
        expect(prompt).toContain("User: q1");
        expect(prompt).toContain("Assistant: a1");
        expect(prompt.endsWith("q2")).toBe(true);
    });
});
