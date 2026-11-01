import type { LlmStreamChunk } from "@triliumnext/commons";
import { type LanguageModel, simulateReadableStream, tool, type ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { BaseProvider } from "./providers/base_provider.js";
import { streamToChunks } from "./stream.js";
import { TOOL_CALL_DECLINED_REASON, ToolApprovals } from "./tool_approval.js";
import { toolKind, type ToolKind } from "./tools/index.js";

const USAGE = {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 }
};

/** A model that calls `create_note` once, then answers with text. */
function modelCallingTool() {
    return new MockLanguageModelV4({
        doStream: [
            {
                stream: simulateReadableStream({
                    chunks: [
                        { type: "tool-call", toolCallId: "c1", toolName: "create_note", input: JSON.stringify({ title: "New" }) },
                        { type: "finish", usage: USAGE, finishReason: { unified: "tool-calls", raw: undefined } }
                    ]
                })
            },
            {
                stream: simulateReadableStream({
                    chunks: [
                        { type: "text-start", id: "t1" },
                        { type: "text-delta", id: "t1", delta: "Done." },
                        { type: "text-end", id: "t1" },
                        { type: "finish", usage: USAGE, finishReason: { unified: "stop", raw: undefined } }
                    ]
                })
            }
        ]
    });
}

class ScriptedProvider extends BaseProvider {
    name = "scripted";
    protected defaultModel = "mock";
    protected titleModel = "mock";
    readonly execute = vi.fn((_input: unknown) => ({ noteId: "n1" }));

    constructor(private readonly model: MockLanguageModelV4) {
        super("key");
    }

    protected createModel(): LanguageModel {
        return this.model;
    }

    protected override buildTools(): ToolSet {
        return {
            create_note: tool({
                description: "Create a note",
                inputSchema: z.object({ title: z.string() }),
                execute: this.execute
            })
        };
    }
}

/**
 * Run a turn through the AI SDK, answering each approval request with `approve` as soon as it
 * is made, as the user would from the chat.
 */
async function runTurn(approve: boolean) {
    const model = modelCallingTool();
    const provider = new ScriptedProvider(model);
    const toolApprovals = new ToolApprovals();
    const requests: unknown[] = [];
    toolApprovals.onRequest = (request) => {
        requests.push(request);
        queueMicrotask(() => toolApprovals.answer(request.toolCallId, approve));
    };

    const chunks: LlmStreamChunk[] = [];
    for await (const chunk of streamToChunks(provider.chat([ { role: "user", content: "make a note" } ], { toolApprovals }))) {
        chunks.push(chunk);
    }
    return { chunks, requests, execute: provider.execute, model };
}

describe("tool approval through the AI SDK", () => {
    it("runs an approved call and carries on with the turn", async () => {
        const { chunks, requests, execute, model } = await runTurn(true);

        expect(requests).toEqual([ { toolCallId: "c1", toolName: "create_note", toolInput: { title: "New" } } ]);
        expect(execute).toHaveBeenCalledOnce();
        expect(chunks).toContainEqual(expect.objectContaining({ type: "tool_result", toolCallId: "c1", isError: false }));
        expect(chunks).toContainEqual({ type: "text", content: "Done." });
        expect(model.doStreamCalls).toHaveLength(2);
    });

    it("never runs a declined call, and tells the model why before it carries on", async () => {
        const { chunks, execute, model } = await runTurn(false);

        expect(execute).not.toHaveBeenCalled();
        expect(chunks).toContainEqual({
            type: "tool_result",
            toolCallId: "c1",
            toolName: "create_note",
            result: JSON.stringify({ error: TOOL_CALL_DECLINED_REASON }),
            isError: true
        });
        expect(chunks).toContainEqual({ type: "text", content: "Done." });

        const toolMessage = model.doStreamCalls[1]?.prompt.find((message) => message.role === "tool");
        expect(JSON.stringify(toolMessage)).toContain(TOOL_CALL_DECLINED_REASON);
    });
});

describe("ToolApprovals", () => {
    it("declines what waits when the turn is stopped or closed, and every call once stopped", async () => {
        const controller = new AbortController();
        const approvals = new ToolApprovals(controller.signal);
        const stopped = approvals.request({ toolCallId: "c1", toolName: "t", toolInput: {} });
        controller.abort();
        await expect(stopped).resolves.toBe(false);
        await expect(approvals.request({ toolCallId: "c2", toolName: "t", toolInput: {} })).resolves.toBe(false);

        const open = new ToolApprovals();
        const closed = open.request({ toolCallId: "c3", toolName: "t", toolInput: {} });
        open.declineAll();
        await expect(closed).resolves.toBe(false);
        expect(open.answer("c3", true)).toBe(false);
    });
});

describe("ToolApprovals allowed for the chat", () => {
    it("runs a tool allowed for the chat without asking", async () => {
        const approvals = new ToolApprovals(undefined, { allowedTools: [ "rename_note" ] });
        const onRequest = vi.fn();
        approvals.onRequest = onRequest;

        await expect(approvals.request({ toolCallId: "c1", toolName: "rename_note", toolInput: {} })).resolves.toBe(true);
        expect(onRequest).not.toHaveBeenCalled();
        void approvals.request({ toolCallId: "c2", toolName: "delete_note", toolInput: {} });
        expect(onRequest).toHaveBeenCalledOnce();
    });

    it("allows the tool of a call allowed for the chat, for the calls that wait and the ones to come", async () => {
        const approvals = new ToolApprovals();
        const first = approvals.request({ toolCallId: "c1", toolName: "rename_note", toolInput: {} });
        const parallel = approvals.request({ toolCallId: "c2", toolName: "rename_note", toolInput: {} });
        const other = approvals.request({ toolCallId: "c3", toolName: "delete_note", toolInput: {} });

        expect(approvals.answer("c1", true, "chat")).toBe(true);
        await expect(first).resolves.toBe(true);
        await expect(parallel).resolves.toBe(true);
        await expect(approvals.request({ toolCallId: "c4", toolName: "rename_note", toolInput: {} })).resolves.toBe(true);

        // A denial is never remembered, whatever its scope.
        expect(approvals.answer("c3", false, "chat")).toBe(true);
        await expect(other).resolves.toBe(false);
        const asked = vi.fn();
        approvals.onRequest = asked;
        void approvals.request({ toolCallId: "c5", toolName: "delete_note", toolInput: {} });
        expect(asked).toHaveBeenCalledOnce();
    });
});

describe("ToolApprovals permission modes", () => {
    const kindOf = (toolName: string): ToolKind => {
        if (toolName === "load_skill") return "app_content";
        if (toolName === "read_web_page") return "web";
        return toolName === "get_note" ? "read" : "change";
    };
    /** Which of a lookup in Trilium's own content, a web page read, a read and a change ask in `mode`. */
    function asked(mode: "always_ask" | "ask_before_changes" | "dont_ask") {
        const approvals = new ToolApprovals(undefined, { mode, kindOf });
        const requests: string[] = [];
        approvals.onRequest = (request) => requests.push(request.toolName);
        void approvals.request({ toolCallId: "c0", toolName: "load_skill", toolInput: {} });
        void approvals.request({ toolCallId: "c3", toolName: "read_web_page", toolInput: {} });
        void approvals.request({ toolCallId: "c1", toolName: "get_note", toolInput: {} });
        void approvals.request({ toolCallId: "c2", toolName: "delete_note", toolInput: {} });
        approvals.declineAll();
        return requests;
    }

    it("asks about every call, only about changes, or about none, and never about Trilium's own content or the web", async () => {
        expect(asked("always_ask")).toEqual([ "get_note", "delete_note" ]);
        expect(asked("ask_before_changes")).toEqual([ "delete_note" ]);
        expect(asked("dont_ask")).toEqual([]);

        const approvals = new ToolApprovals(undefined, { mode: "always_ask", kindOf });
        await expect(approvals.request({ toolCallId: "c1", toolName: "load_skill", toolInput: {} })).resolves.toBe(true);
    });

    it("tells Trilium's own content, the web, reads and changes apart, and counts anything unknown as a change", () => {
        expect([ "load_skill", "search_icons" ].map(toolKind)).toEqual([ "app_content", "app_content" ]);
        expect([ "get_note", "search_notes" ].map(toolKind)).toEqual([ "read", "read" ]);
        expect([ "web_search", "read_web_page" ].map(toolKind)).toEqual([ "web", "web" ]);
        expect([ "create_note", "delete_attribute", "some_mcp_tool" ].map(toolKind)).toEqual([ "change", "change", "change" ]);
    });
});
