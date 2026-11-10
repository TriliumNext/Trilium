import type { LlmStreamChunk } from "@triliumnext/commons";
import { beforeEach, describe, expect, it, vi } from "vitest";

const infoLogMock = vi.hoisted(() => vi.fn<(message: string) => void>());
vi.mock("@triliumnext/core", () => ({
    getLog: () => ({ info: infoLogMock, error: vi.fn() }),
    task_states: { getTaskStates: () => [] }
}));
vi.mock("../../data_dir.js", () => ({ default: { TRILIUM_DATA_DIR: "/data" } }));

const { AcpAgentProvider, AnnouncedMcpCalls, answerNoteToolCalls, askNoteToolPermission, createUpdateCollector, describeError, mcpArguments } = await import("./acp_agent.js");
const { AcpError } = await import("./acp_client.js");
const { ToolApprovals } = await import("@triliumnext/core/src/services/llm/tool_approval.js");

type PermissionRequest = Parameters<typeof askNoteToolPermission>[0];

/** An agent that keeps every default of the base class: no permission policy and no sign-in. */
class BareAgent extends AcpAgentProvider {
    name = "bare-agent";
    protected readonly logLabel = "Bare agent";
    protected readonly fallbackModels = [];
    protected readonly defaultModelId = "default";
    protected readonly agentDirName = "bare-agent";

    protected async launchSpec() {
        return { binary: "/usr/bin/bare-agent", args: [] };
    }

    protected buildModelList() {
        return [];
    }

    recommendedModelIds() {
        return new Set<string>();
    }

    protected titleModelId() {
        return undefined;
    }

    protected describeFailure(error: unknown) {
        return describeError(error);
    }

    decide(request: PermissionRequest) {
        return this.decidePermission(request);
    }

    signInFailure(error: unknown) {
        return this.describeSignInFailure(error);
    }
}

/** A tool call as `codex-acp` announces a call to an MCP server. */
function mcpCall(toolCallId: string, extra: Record<string, unknown> = {}) {
    return {
        sessionUpdate: "tool_call", toolCallId, title: "mcp.trilium.get_note", status: "in_progress",
        rawInput: { server: "trilium", tool: "get_note", arguments: { noteId: "abc" } }, _meta: { is_mcp_tool_call: true },
        ...extra
    };
}

beforeEach(() => {
    infoLogMock.mockReset();
});

describe("AcpAgentProvider defaults", () => {
    it("denies every permission request, and has no sign-in to explain", () => {
        const agent = new BareAgent();
        expect(agent.decide({
            toolCall: { title: "rm -rf /", kind: "execute" },
            options: [ { optionId: "allow", kind: "allow_once" }, { optionId: "never", kind: "reject_always" } ]
        })).toEqual({ outcome: { outcome: "selected", optionId: "never" } });
        expect(infoLogMock).toHaveBeenCalledWith("Bare agent: denied unapproved tool call \"rm -rf /\" (kind: execute).");

        expect(agent.signInFailure(new AcpError(-32000, "Authentication required"))).toBeUndefined();
    });
});

describe("note tool permissions", () => {
    const allowOnly = [ { optionId: "allow", kind: "allow_once" } ];

    it("cancels a request in a chat turn that names no tool call", async () => {
        await expect(askNoteToolPermission({ options: allowOnly }, "Agent", new ToolApprovals()))
            .resolves.toEqual({ outcome: { outcome: "cancelled" } });
    });

    it("cancels a declined call when the agent offers no one-shot reject", async () => {
        const toolApprovals = new ToolApprovals();
        toolApprovals.onRequest = (asked) => queueMicrotask(() => toolApprovals.answer(asked.toolCallId, false));
        const call = { toolCallId: "c1", server: "trilium", tool: "delete_note", input: { noteId: "abc" } };

        await expect(answerNoteToolCalls({ options: allowOnly }, "Agent", [ call ], toolApprovals))
            .resolves.toEqual({ outcome: { outcome: "cancelled" } });
        expect(infoLogMock).toHaveBeenCalledWith("Agent: the user declined the call to \"delete_note\".");
    });
});

describe("createUpdateCollector", () => {
    it("leaves an MCP call's update to the MCP shape, and shows a result with no text as its raw output", () => {
        const chunks: LlmStreamChunk[] = [];
        const describeBuiltIn = vi.fn(() => ({ toolName: "web_search", toolInput: { query: "notes" } }));
        const collector = createUpdateCollector(chunk => chunks.push(chunk), undefined, describeBuiltIn);
        const rawOutput = { result: { content: [ { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" } ] }, error: null };

        collector.onNotification("session/update", { sessionId: "s1", update: mcpCall("c1") });
        collector.onNotification("session/update", { sessionId: "s1", update: mcpCall("c1", { sessionUpdate: "tool_call_update", status: "completed", rawOutput }) });

        expect(describeBuiltIn).not.toHaveBeenCalled();
        expect(chunks).toEqual([
            { type: "tool_use", toolCallId: "c1", toolName: "get_note", toolInput: { noteId: "abc" } },
            { type: "tool_result", toolCallId: "c1", toolName: "get_note", result: JSON.stringify(rawOutput), isError: false }
        ]);
    });
});

describe("AnnouncedMcpCalls", () => {
    it("tracks the unfinished calls of each session until they complete or fail", () => {
        const calls = new AnnouncedMcpCalls();
        // Neither a session update nor one with parameters announces anything.
        calls.observe("session/cancel", { sessionId: "s1", update: mcpCall("c0") });
        calls.observe("session/update", undefined);
        calls.observe("session/update", { sessionId: "s1", update: mcpCall("c1") });
        calls.observe("session/update", { sessionId: "s1", update: mcpCall("c2") });
        expect(calls.callOf("s1", "c0")).toBeUndefined();

        // A call still running stays tracked; a failed one goes.
        calls.observe("session/update", { sessionId: "s1", update: { sessionUpdate: "tool_call_update", toolCallId: "c1", status: "in_progress" } });
        calls.observe("session/update", { sessionId: "s1", update: { sessionUpdate: "tool_call_update", toolCallId: "c2", status: "failed" } });
        expect(calls.pendingOn("s1", "trilium").map(call => call.toolCallId)).toEqual([ "c1" ]);
        expect(calls.callOf("s1", "c1")).toEqual({ toolCallId: "c1", server: "trilium", tool: "get_note", input: { noteId: "abc" } });

        // A lookup without a session or call id, or in a session with no calls, finds nothing.
        expect(calls.announcementOf(undefined, "c1")).toBeUndefined();
        expect(calls.callOf("s1", undefined)).toBeUndefined();
        expect(calls.pendingOn(undefined, "trilium")).toEqual([]);
        expect(calls.pendingOn("s2", "trilium")).toEqual([]);
    });

    it("reads an MCP call's arguments as an object, whether wrapped or not", () => {
        expect(mcpArguments({ arguments: { noteId: "abc" } })).toEqual({ noteId: "abc" });
        expect(mcpArguments({ noteId: "abc" })).toEqual({ noteId: "abc" });
        expect(mcpArguments(undefined)).toEqual({});
        expect(mcpArguments("noteId=abc")).toEqual({});
    });
});
