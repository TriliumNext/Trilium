import type { LlmStreamChunk } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
const errorLogMock = vi.hoisted(() => vi.fn());

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
vi.mock("../note_hint.js", () => ({ buildNoteHint: buildNoteHintMock }));

// BYO binary resolution shells out to the user's `claude`; stub it so tests
// don't depend on a real install. Resolves a path by default; can be made to
// reject (missing binary) per-test.
const resolveClaudeBinaryMock = vi.hoisted(() => vi.fn(async () => "/usr/bin/claude"));
vi.mock("./claude_binary.js", () => ({ resolveClaudeBinaryPath: resolveClaudeBinaryMock }));

// Attachment resolution reads bytes out of Becca, which the core mock above
// omits — stub it so the multimodal tests drive block construction directly.
const resolveAttachmentPartMock = vi.hoisted(() => vi.fn());
vi.mock("../attachment_content.js", () => ({ resolveAttachmentPart: resolveAttachmentPartMock }));

// The Windows `.cmd` shim delegates to child_process.spawn; the provider never
// spawns otherwise, so mocking the whole module is safe.
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("child_process", () => ({ spawn: spawnMock }));

const { buildSeededPrompt, buildSubscriptionModelList, ClaudeAgentProvider, hashTranscript, resetAgentCwdForTests, resetSubscriptionModelCacheForTests } = await import("./claude_agent.js");

/** Drain the query prompt into the single user message it streams (multimodal path). */
async function drainPrompt(prompt: unknown): Promise<{ role: string; content: unknown[] }> {
    const iterator = (prompt as AsyncIterable<unknown>)?.[Symbol.asyncIterator];
    if (typeof prompt === "string" || typeof iterator !== "function") {
        throw new Error("expected a streamed multimodal prompt, got a plain string");
    }
    const messages: { message: { role: string; content: unknown[] } }[] = [];
    for await (const message of prompt as AsyncIterable<{ message: { role: string; content: unknown[] } }>) {
        messages.push(message);
    }
    expect(messages).toHaveLength(1);
    return messages[0].message;
}

/** Make query() replay the given SDK messages and record its invocation. */
function scriptAgent(messages: unknown[]) {
    queryMock.mockImplementation(() => (async function* () {
        for (const message of messages) {
            yield message;
        }
    })());
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

    it("starts a fresh session with the plain prompt and resumes it when the transcript matches", async () => {
        const provider = new ClaudeAgentProvider();
        const config = { chatNoteId: "note-resume" };

        // Turn 1 — no history, no mapping: plain prompt, no resume.
        scriptAgent([textDelta("first reply"), successResult("sess-A")]);
        await collect(provider.chatChunks([{ role: "user", content: "first question" }], config));

        expect(queryMock).toHaveBeenCalledTimes(1);
        const firstCall = queryMock.mock.calls[0][0];
        expect(firstCall.prompt).toBe("first question");
        expect(firstCall.options.resume).toBeUndefined();

        // Turn 2 — transcript = turn 1 + streamed reply: resume with only the new message.
        scriptAgent([textDelta("second reply"), successResult("sess-A")]);
        await collect(provider.chatChunks([
            { role: "user", content: "first question" },
            { role: "assistant", content: "first reply" },
            { role: "user", content: "second question" }
        ], config));

        const secondCall = queryMock.mock.calls[1][0];
        expect(secondCall.prompt).toBe("second question");
        expect(secondCall.options.resume).toBe("sess-A");
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
        expect(secondCall.prompt).toContain("<conversation_history>");
        expect(secondCall.prompt).toContain("User: edited");
        expect(secondCall.prompt).toContain("Assistant: reply");
        expect(secondCall.prompt).toContain("follow-up");
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
        const prompt = queryMock.mock.calls[0][0].prompt;
        expect(prompt).toBe("NOTE_META(note-abc)\n\nwhat is this note about?");
    });

    it("does not prepend a hint when the context note no longer exists", async () => {
        buildNoteHintMock.mockReturnValueOnce(null);
        scriptAgent([successResult()]);
        const provider = new ClaudeAgentProvider();
        await collect(provider.chatChunks(
            [{ role: "user", content: "hello" }],
            { contextNoteId: "gone" }
        ));

        expect(queryMock.mock.calls[0][0].prompt).toBe("hello");
    });

    it("keeps the note hint out of the session hash so a later turn still resumes", async () => {
        const provider = new ClaudeAgentProvider();
        const config = { contextNoteId: "note-abc", chatNoteId: "note-hint-resume" };

        scriptAgent([textDelta("first reply"), successResult("sess-H")]);
        await collect(provider.chatChunks([{ role: "user", content: "q1" }], config));

        // Turn 2: transcript matches turn 1 (unhinted) → resume, and the new
        // message still carries the freshly-built hint.
        scriptAgent([textDelta("second reply"), successResult("sess-H")]);
        await collect(provider.chatChunks([
            { role: "user", content: "q1" },
            { role: "assistant", content: "first reply" },
            { role: "user", content: "q2" }
        ], config));

        const secondCall = queryMock.mock.calls[1][0];
        expect(secondCall.options.resume).toBe("sess-H");
        expect(secondCall.prompt).toBe("NOTE_META(note-abc)\n\nq2");
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

        const message = await drainPrompt(queryMock.mock.calls[0][0].prompt);
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

        const message = await drainPrompt(queryMock.mock.calls[0][0].prompt);
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

        const prompt = queryMock.mock.calls[0][0].prompt;
        expect(typeof prompt).toBe("string");
        expect(prompt).toBe("read this\n\n<file name=\"d.svg\">\n<svg/>\n</file>");
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

        const message = await drainPrompt(queryMock.mock.calls[0][0].prompt);
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
        expect(queryMock.mock.calls[0][0].prompt).toBe("line one\nline two");
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

    it("evicts the oldest chat-note mapping once the session cap is exceeded", async () => {
        const provider = new ClaudeAgentProvider();

        scriptAgent([textDelta("r"), successResult("sess-victim")]);
        await collect(provider.chatChunks([{ role: "user", content: "q" }], { chatNoteId: "victim" }));

        // 200 further distinct chat notes push "victim" past the cap.
        for (let i = 0; i < 200; i++) {
            scriptAgent([textDelta("r"), successResult(`sess-${i}`)]);
            await collect(provider.chatChunks([{ role: "user", content: "q" }], { chatNoteId: `filler-${i}` }));
        }

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

describe("buildSubscriptionModelList", () => {
    const curated = [
        { id: "claude-sonnet-5", name: "Claude Sonnet 5", pricing: { input: 0, output: 0 }, contextWindow: 1000000, isDefault: true, isSubscription: true },
        { id: "claude-opus-4-6", name: "Claude Opus 4.6", pricing: { input: 0, output: 0 }, contextWindow: 1000000, isLegacy: true, isSubscription: true },
        { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", pricing: { input: 0, output: 0 }, contextWindow: 200000, isSubscription: true }
    ];

    it("resolves aliases to canonical ids, dedupes, and keeps curated metadata", () => {
        const merged = buildSubscriptionModelList([
            { value: "sonnet", resolvedModel: "claude-sonnet-5", displayName: "Sonnet 5" },
            { value: "claude-sonnet-5", displayName: "Sonnet 5 (again)" }, // dup of the resolved alias → dropped
            { value: "claude-opus-4-6", displayName: "Opus 4.6" }
        ], curated);

        expect(merged.map(m => m.id)).toEqual(["claude-sonnet-5", "claude-opus-4-6"]);
        // The CLI's display name wins; curated flags/context window survive.
        expect(merged[0]).toMatchObject({ name: "Sonnet 5", isDefault: true, isSubscription: true, contextWindow: 1000000, pricing: { input: 0, output: 0 } });
        expect(merged[1]).toMatchObject({ id: "claude-opus-4-6", isLegacy: true });
        // Haiku is curated but absent from the live catalog → dropped.
        expect(merged.some(m => m.id === "claude-haiku-4-5-20251001")).toBe(false);
    });

    it("passes through unknown models with subscription invariants and no pricing/context window", () => {
        const merged = buildSubscriptionModelList([
            { value: "sonnet", resolvedModel: "claude-sonnet-5", displayName: "Sonnet 5" },
            { value: "claude-fable-9", displayName: "Claude Fable 9" }
        ], curated);

        const fable = merged.find(m => m.id === "claude-fable-9");
        expect(fable).toEqual({ id: "claude-fable-9", name: "Claude Fable 9", contextWindow: undefined, isSubscription: true, pricing: { input: 0, output: 0 } });
    });
});

describe("ClaudeAgentProvider.listModels", () => {
    function scriptSupportedModels(models: unknown[] | (() => Promise<unknown[]>)) {
        queryMock.mockReturnValue({
            supportedModels: typeof models === "function" ? models : async () => models
        });
    }

    beforeEach(() => {
        queryMock.mockReset();
        resetSubscriptionModelCacheForTests();
        resolveClaudeBinaryMock.mockClear();
    });

    it("probes the live catalog without running a chat turn", async () => {
        scriptSupportedModels([
            { value: "sonnet", resolvedModel: "claude-sonnet-5", displayName: "Sonnet 5" },
            { value: "claude-fable-9", displayName: "Claude Fable 9" }
        ]);
        const provider = new ClaudeAgentProvider();
        const models = await provider.listModels();

        expect(models.map(m => m.id)).toEqual(["claude-sonnet-5", "claude-fable-9"]);
        expect(models.every(m => m.isSubscription)).toBe(true);
        // Curated models the CLI didn't report are gone (unlike getAvailableModels).
        expect(models.some(m => m.id === "claude-haiku-4-5-20251001")).toBe(false);

        // The probe uses a streaming prompt that yields nothing — never a string,
        // so no user turn (and no tokens) is sent — capped at a single turn.
        const { prompt, options } = queryMock.mock.calls[0][0];
        expect(typeof prompt).not.toBe("string");
        expect(prompt[Symbol.asyncIterator]).toBeTypeOf("function");
        expect(options.maxTurns).toBe(1);
    });

    it("serves the cached list on the next call without re-spawning", async () => {
        scriptSupportedModels([{ value: "claude-sonnet-5", displayName: "Sonnet 5" }]);
        const provider = new ClaudeAgentProvider();
        const first = await provider.listModels();
        // A fresh instance still hits the shared module-level cache.
        const second = await new ClaudeAgentProvider().listModels();

        expect(second).toBe(first);
        expect(queryMock).toHaveBeenCalledTimes(1);
    });

    it("deduplicates concurrent probes into a single spawn", async () => {
        scriptSupportedModels([{ value: "claude-sonnet-5", displayName: "Sonnet 5" }]);
        const provider = new ClaudeAgentProvider();
        // The second call arrives while the first probe is still in flight and
        // shares its promise instead of spawning a second CLI subprocess.
        const [a, b] = await Promise.all([provider.listModels(), provider.listModels()]);

        expect(a).toBe(b);
        expect(queryMock).toHaveBeenCalledTimes(1);
    });

    it("propagates the probe failure so the modal can surface it (e.g. not authenticated)", async () => {
        scriptSupportedModels(async () => {
            throw new Error("Claude Code is not authenticated");
        });
        const provider = new ClaudeAgentProvider();
        await expect(provider.listModels()).rejects.toThrow("not authenticated");
    });

    it("times out when the init handshake never surfaces the catalog", async () => {
        vi.useFakeTimers();
        try {
            // supportedModels() never resolves → the 15s timeout wins the race.
            scriptSupportedModels(() => new Promise<never>(() => {}));
            const provider = new ClaudeAgentProvider();
            const promise = provider.listModels();
            // Surface the rejection now so it isn't reported as unhandled while
            // we advance the clock; assert on it after the timer fires.
            const settled = promise.then(() => "resolved", (e: Error) => e.message);
            await vi.advanceTimersByTimeAsync(15_000);
            expect(await settled).toMatch(/Timed out reading the Claude Code model catalog/);
        } finally {
            vi.useRealTimers();
        }
    });

    it("propagates when Claude Code isn't installed, without spawning a probe", async () => {
        resolveClaudeBinaryMock.mockRejectedValueOnce(new Error("Claude Code CLI not found"));
        const provider = new ClaudeAgentProvider();

        await expect(provider.listModels()).rejects.toThrow("not found");
        expect(queryMock).not.toHaveBeenCalled();
    });

    it("feeds query() a no-input prompt that stays open until teardown, then finishes once aborted", async () => {
        // The probe hands query() a prompt whose iterator never yields a user
        // message — it registers a teardown listener and only resolves `done`
        // once the probe aborts. Drive that iterator here (the mock never would).
        let probeIterator: AsyncIterator<unknown> | undefined;
        let firstPull: Promise<IteratorResult<unknown>> | undefined;
        queryMock.mockImplementation((opts: { prompt: AsyncIterable<unknown> }) => {
            probeIterator = opts.prompt[Symbol.asyncIterator]();
            // Pull once while the probe's controller is still un-aborted: this
            // runs the iterator body and registers the abort ("finish") listener.
            firstPull = probeIterator.next();
            return { supportedModels: async () => [{ value: "claude-sonnet-5", displayName: "Sonnet 5" }] };
        });

        await new ClaudeAgentProvider().listModels();

        // The probe's teardown aborted the controller, resolving the pending pull.
        expect(firstPull).toBeDefined();
        await expect(firstPull).resolves.toEqual({ done: true, value: undefined });

        // A later pull sees the already-aborted signal and finishes immediately.
        expect(probeIterator).toBeDefined();
        await expect(probeIterator?.next()).resolves.toEqual({ done: true, value: undefined });
    });
});

describe("Windows .cmd spawn shim", () => {
    const realPlatform = process.platform;

    function setPlatform(value: string) {
        Object.defineProperty(process, "platform", { value, configurable: true });
    }

    beforeEach(() => {
        queryMock.mockReset();
        spawnMock.mockReset();
    });
    afterEach(() => {
        setPlatform(realPlatform);
        // Restore the default binary path the other suites depend on.
        resolveClaudeBinaryMock.mockReset();
        resolveClaudeBinaryMock.mockImplementation(async () => "/usr/bin/claude");
    });

    it("wraps the CLI spawn in a shell for a .cmd shim on Windows", async () => {
        // Node's spawn() can't execute a .cmd batch file (the npm shim) directly,
        // so the provider installs a spawn override that delegates via a shell.
        setPlatform("win32");
        resolveClaudeBinaryMock.mockResolvedValue("C:\\Users\\me\\claude.cmd");
        scriptAgent([successResult()]);
        await collect(new ClaudeAgentProvider().chatChunks([{ role: "user", content: "hi" }], {}));

        const spawnClaudeCodeProcess = queryMock.mock.calls[0][0].options.spawnClaudeCodeProcess;
        expect(spawnClaudeCodeProcess).toBeTypeOf("function");

        const fakeChild = { pid: 123 };
        spawnMock.mockReturnValue(fakeChild);
        const child = spawnClaudeCodeProcess({ command: "claude.cmd", args: ["--print"], cwd: "/tmp", env: { A: "1" }, signal: undefined });

        expect(spawnMock).toHaveBeenCalledWith(
            "claude.cmd",
            ["--print"],
            expect.objectContaining({ shell: true, stdio: "pipe", cwd: "/tmp", env: { A: "1" } })
        );
        expect(child).toBe(fakeChild);
    });

    it("installs no spawn override on non-Windows hosts", async () => {
        setPlatform("linux");
        resolveClaudeBinaryMock.mockResolvedValue("/usr/bin/claude");
        scriptAgent([successResult()]);
        await collect(new ClaudeAgentProvider().chatChunks([{ role: "user", content: "hi" }], {}));

        expect(queryMock.mock.calls[0][0].options.spawnClaudeCodeProcess).toBeUndefined();
    });

    it("installs no spawn override for a non-.cmd binary on Windows", async () => {
        setPlatform("win32");
        resolveClaudeBinaryMock.mockResolvedValue("C:\\Users\\me\\claude.exe");
        scriptAgent([successResult()]);
        await collect(new ClaudeAgentProvider().chatChunks([{ role: "user", content: "hi" }], {}));

        expect(queryMock.mock.calls[0][0].options.spawnClaudeCodeProcess).toBeUndefined();
    });
});

describe("ClaudeAgentProvider.recommendedModelIds", () => {
    it("applies Anthropic's per-family newest-version rule, not the generic default", () => {
        // The subscription catalog shares Anthropic's id shape, so it recommends
        // one model per family rather than every non-preview, non-legacy model.
        const ids = new ClaudeAgentProvider().recommendedModelIds(
            ["claude-fable-5", "claude-opus-4-8", "claude-opus-4-7", "claude-sonnet-5", "claude-haiku-4-5-20251001"]
                .map(id => ({ id, name: id }))
        );
        expect([...ids].sort()).toEqual([
            "claude-fable-5", "claude-haiku-4-5-20251001", "claude-opus-4-8", "claude-sonnet-5"
        ]);
    });
});
