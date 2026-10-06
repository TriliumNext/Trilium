import type { LlmStreamChunk } from "@triliumnext/commons";
import fs from "fs";
import os from "os";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@triliumnext/core", () => ({
    getLog: () => ({ info: vi.fn(), error: vi.fn() }),
    // buildSystemPrompt reads the workspace task states; none in this unit test.
    task_states: { getTaskStates: () => [] }
}));

const DATA_DIR = path.join(os.tmpdir(), "trilium-codex-agent-spec");
vi.mock("../../data_dir.js", async () => {
    const os = await import("os");
    const path = await import("path");
    return { default: { TRILIUM_DATA_DIR: path.join(os.tmpdir(), "trilium-codex-agent-spec") } };
});

vi.mock("./codex_binary.js", () => ({
    resolveCodexBinaryPath: async () => "/usr/bin/codex",
    resolveCodexAcpScript: () => "/opt/trilium/assets/codex-acp.mjs"
}));
const getAcpHookEndpointUrlMock = vi.hoisted(() => vi.fn(async (_name: string, _handler: (payload: unknown) => unknown) => "http://127.0.0.1:12345/hook-secret/codex"));
vi.mock("./acp_mcp_endpoint.js", () => ({
    getAcpMcpEndpointUrl: async () => "http://127.0.0.1:12345/mcp-secret",
    getAcpHookEndpointUrl: getAcpHookEndpointUrlMock
}));
vi.mock("./acp_hook.js", async (importOriginal) => ({
    ...await importOriginal<typeof import("./acp_hook.js")>(),
    resolveCurlPath: async () => "/usr/bin/curl"
}));
vi.mock("@triliumnext/core/src/services/llm/note_hint.js", () => ({ buildNoteHint: () => null }));
vi.mock("@triliumnext/core/src/services/llm/attachment_content.js", async (importOriginal) => ({
    ...await importOriginal<typeof import("@triliumnext/core/src/services/llm/attachment_content.js")>(),
    resolveAttachmentPart: vi.fn()
}));

class FakeAcpError extends Error {
    constructor(public readonly code: number, message: string) {
        super(message);
    }
}

type StartOptions = {
    args?: string[];
    env?: Record<string, string>;
    cwd: string;
    onAgentRequest?: (m: string, p: unknown) => unknown;
    onNotification?: (m: string, p: unknown) => void;
};

/** Answers like `codex-acp`: `session/new` fails until `authenticate` has run, when `signedIn` is false. */
class FakeAcpClient {
    static current: FakeAcpClient | undefined;
    static lastStart: { worker: boolean; binary: string; opts: { args?: string[]; env?: Record<string, string>; cwd: string } } | undefined;
    static signedIn = true;
    /** How many `session/new` calls after `authenticate` still find no account, as Codex's can lag a completed sign-in. */
    static accountLag = 0;
    static lagLeft = 0;
    /** An error `session/new` fails with, when set. */
    static sessionFailure: Error | undefined;
    /** Runs while session/prompt is answered, as the agent's own notifications and requests do. */
    static onPrompt: ((client: FakeAcpClient) => Promise<void>) | undefined;

    requests: { method: string; params: unknown }[] = [];
    onAgentRequest?: (method: string, params: unknown) => unknown;
    onNotification?: (method: string, params: unknown) => void;

    static start(binary: string, opts: StartOptions) {
        return FakeAcpClient.launch(false, binary, opts);
    }

    static startWorker(script: string, opts: StartOptions) {
        return FakeAcpClient.launch(true, script, opts);
    }

    private static launch(worker: boolean, binary: string, opts: StartOptions) {
        FakeAcpClient.lastStart = { worker, binary, opts };
        FakeAcpClient.current = new FakeAcpClient();
        FakeAcpClient.current.onAgentRequest = opts.onAgentRequest;
        FakeAcpClient.current.onNotification = opts.onNotification;
        return FakeAcpClient.current;
    }

    async request<T>(method: string, params: unknown): Promise<T> {
        this.requests.push({ method, params });
        if (method === "authenticate") {
            FakeAcpClient.signedIn = true;
            FakeAcpClient.lagLeft = FakeAcpClient.accountLag;
        }
        if (method === "session/new") {
            if (FakeAcpClient.sessionFailure) throw FakeAcpClient.sessionFailure;
            if (!FakeAcpClient.signedIn || FakeAcpClient.lagLeft-- > 0) throw new FakeAcpError(-32000, "Authentication required");
            return { sessionId: "sess-1", models: { currentModelId: "gpt-6-luna[medium]", availableModels: REMOTE_MODELS } } as T;
        }
        if (method === "session/prompt") {
            await FakeAcpClient.onPrompt?.(this);
            return { stopReason: "end_turn" } as T;
        }
        return {} as T;
    }

    notify(): void {}
    dispose(): void {}
    get alive(): boolean {
        return true;
    }

    methods(): string[] {
        return this.requests.map(r => r.method);
    }
}

vi.mock("./acp_client.js", () => ({ AcpClient: FakeAcpClient, AcpError: FakeAcpError }));

const { resetAcpAgentStateForTests } = await import("./acp_agent.js");
const { buildCodexModelList, CitationStripper, CodexAgentProvider, decideCodexPermission, resetCodexCatalogForTests } = await import("./codex_agent.js");

/** Part of the catalog codex-acp 1.13.1 reports on session/new for a ChatGPT account. */
const REMOTE_MODELS = [
    ...["low", "medium", "high", "xhigh", "max"].map(effort => ({
        modelId: `gpt-6-luna[${effort}]`,
        name: `6 Luna (${effort})`,
        description: "Fast and affordable model for easier tasks."
    })),
    ...["low", "medium", "high", "xhigh", "max", "ultra"].map(effort => ({
        modelId: `gpt-5.6-terra[${effort}]`,
        name: `5.6 Terra (${effort})`,
        description: "Older balanced model for straightforward work."
    })),
    { modelId: "gpt-5.5[high]", name: "5.5 (high)", description: "Legacy coding model." },
    { modelId: "gpt-5.5[low]", name: "5.5 (low)", description: "Legacy coding model." }
];

async function collect(iterable: AsyncIterable<LlmStreamChunk>): Promise<LlmStreamChunk[]> {
    const chunks: LlmStreamChunk[] = [];
    for await (const chunk of iterable) {
        if (chunk.type !== "status") {
            chunks.push(chunk);
        }
    }
    return chunks;
}

beforeEach(() => {
    resetAcpAgentStateForTests();
    resetCodexCatalogForTests();
    FakeAcpClient.current = undefined;
    FakeAcpClient.lastStart = undefined;
    FakeAcpClient.signedIn = true;
    FakeAcpClient.accountLag = 0;
    FakeAcpClient.lagLeft = 0;
    FakeAcpClient.sessionFailure = undefined;
    FakeAcpClient.onPrompt = undefined;
});

describe("CodexAgentProvider", () => {
    it("runs the bundled adapter in a worker against the user's Codex, read-only, with a home of Trilium's own, and denies what it asks permission for", async () => {
        await collect(new CodexAgentProvider().chatChunks([{ role: "user", content: "hi" }], {}));

        const start = FakeAcpClient.lastStart;
        expect(start?.worker).toBe(true);
        expect(start?.binary).toBe("/opt/trilium/assets/codex-acp.mjs");
        const home = path.join(DATA_DIR, "codex-agent", "home");
        expect(start?.opts.env).toEqual({
            CODEX_PATH: "/usr/bin/codex",
            CODEX_HOME: home,
            INITIAL_AGENT_MODE: "read-only",
            CODEX_CONFIG: JSON.stringify({ bypass_hook_trust: true, features: { hooks: true } })
        });
        // Every tool call goes through the hook, which fails closed.
        expect(getAcpHookEndpointUrlMock).toHaveBeenCalledWith("codex", expect.any(Function));
        expect(JSON.parse(fs.readFileSync(path.join(home, "hooks.json"), "utf8")).hooks.PreToolUse).toEqual([ {
            matcher: ".*",
            hooks: [ { type: "command", timeout: 10, command: "\"/usr/bin/curl\" --silent --show-error --fail --noproxy 127.0.0.1 --max-time 8 --data-binary @- http://127.0.0.1:12345/hook-secret/codex || exit 2" } ]
        } ]);
        expect(start?.opts.cwd).toBe(path.join(DATA_DIR, "codex-agent", "workspace"));
        expect(FakeAcpClient.current?.onAgentRequest?.("session/request_permission", {
            toolCall: { kind: "execute", title: "rm -rf /" },
            options: [{ optionId: "allow", kind: "allow_once" }, { optionId: "deny", kind: "reject_once" }]
        })).toEqual({ outcome: { outcome: "selected", optionId: "deny" } });
    });

    it("signs in with ChatGPT during the model probe, but reports a missing sign-in in the chat instead", async () => {
        FakeAcpClient.signedIn = false;
        const chunks = await collect(new CodexAgentProvider().chatChunks([{ role: "user", content: "hi" }], {}));
        expect(chunks).toEqual([{ type: "error", error: "OpenAI Codex is not signed in. Open this provider in the AI settings and go to the model selection, which opens the ChatGPT sign-in page in a browser on the device running Trilium." }]);
        expect(FakeAcpClient.current?.methods()).not.toContain("authenticate");

        await new CodexAgentProvider().listModels();
        expect(FakeAcpClient.current?.methods()).toEqual(["initialize", "session/new", "authenticate", "session/new"]);
        expect(FakeAcpClient.current?.requests[2].params).toEqual({ methodId: "chat-gpt" });
    });

    it("waits for Codex's account to show a sign-in it reported complete, for a while", async () => {
        vi.useFakeTimers();
        try {
            FakeAcpClient.signedIn = false;
            FakeAcpClient.accountLag = 2;
            const listing = new CodexAgentProvider().listModels();
            await vi.advanceTimersByTimeAsync(2_000);
            expect((await listing).map(m => m.id)).toContain("gpt-6-luna");
            expect(FakeAcpClient.current?.methods()).toEqual(["initialize", "session/new", "authenticate", "session/new", "session/new", "session/new"]);

            // An account that never shows the sign-in is reported after ten seconds.
            resetAcpAgentStateForTests();
            FakeAcpClient.signedIn = false;
            FakeAcpClient.accountLag = Infinity;
            const failing = new CodexAgentProvider().listModels().then(() => "resolved", (err: Error) => err.message);
            await vi.advanceTimersByTimeAsync(11_000);
            expect(await failing).toMatch(/not signed in/);
        } finally {
            vi.useRealTimers();
        }
    });

    it("explains a failure to start, sign in or answer in words the user can act on", async () => {
        const failureOf = async (error: Error) => {
            FakeAcpClient.sessionFailure = error;
            resetAcpAgentStateForTests();
            return new CodexAgentProvider().listModels().then(() => "resolved", (err: Error) => err.message);
        };
        expect(await failureOf(new Error("ACP request \"authenticate\" timed out after 300000ms"))).toMatch(/sign-in was not completed in time/);
        expect(await failureOf(new Error("spawn /usr/bin/codex ENOENT"))).toBe("Failed to start Codex: spawn /usr/bin/codex ENOENT");
        expect(await failureOf(new Error("Something else"))).toBe("Something else");
    });

    it("leaves the default model to Codex, runs any other at the chosen effort, and titles on the lead model at its lightest", async () => {
        const provider = new CodexAgentProvider();
        const modelSetFor = async (config: Record<string, unknown>) => {
            await collect(provider.chatChunks([{ role: "user", content: "hi" }], config));
            return (FakeAcpClient.current?.requests.filter(r => r.method === "session/set_model").at(-1)?.params as { modelId?: string } | undefined)?.modelId;
        };

        expect(await modelSetFor({})).toBeUndefined();
        expect(await modelSetFor({ model: "gpt-6-luna", reasoningEffort: "high" })).toBe("gpt-6-luna[high]");
        // No choice: the model's default, medium.
        expect(await modelSetFor({ model: "gpt-5.6-terra" })).toBe("gpt-5.6-terra[medium]");
        // A level the model lacks: the nearest one, the higher on a tie.
        expect(await modelSetFor({ model: "gpt-5.5", reasoningEffort: "medium" })).toBe("gpt-5.5[high]");
        // An id that names no grouped model passes through.
        expect(await modelSetFor({ model: "gpt-6-luna[low]" })).toBe("gpt-6-luna[low]");

        const pooled = FakeAcpClient.current;
        await provider.listModels();
        await provider.generateTitle("plan my week");
        expect(pooled?.requests.filter(r => r.method === "session/set_model").at(-1)?.params).toEqual({ sessionId: "sess-1", modelId: "gpt-6-luna[low]" });
    });
});

describe("buildCodexModelList", () => {
    it("lists each model once with the efforts it comes in, marks the legacy ones and pre-selects the newest", () => {
        const models = buildCodexModelList({ availableModels: REMOTE_MODELS });

        expect(models).toEqual([
            { id: "default", name: "Default", pricing: { input: 0, output: 0 }, isDefault: true, isSubscription: true },
            { id: "gpt-6-luna", name: "GPT-6 Luna", pricing: { input: 0, output: 0 }, isSubscription: true, reasoningEfforts: ["low", "medium", "high", "xhigh", "max"], defaultReasoningEffort: "medium" },
            // `ultra` is no level Trilium can name, so it is left out. An "Older" model is no legacy one.
            { id: "gpt-5.6-terra", name: "GPT-5.6 Terra", pricing: { input: 0, output: 0 }, isSubscription: true, reasoningEfforts: ["low", "medium", "high", "xhigh", "max"], defaultReasoningEffort: "medium" },
            // Sorted weakest first, defaulting to the lightest without medium.
            { id: "gpt-5.5", name: "GPT-5.5", pricing: { input: 0, output: 0 }, isSubscription: true, isLegacy: true, reasoningEfforts: ["low", "high"], defaultReasoningEffort: "low" }
        ]);
        expect([...new CodexAgentProvider().recommendedModelIds(models)]).toEqual(["default", "gpt-6-luna"]);
    });

    it("pre-selects the newest models an older Codex offers, which OpenAI describes as older", () => {
        // Codex 0.146.0 lists no GPT-6 Luna; OpenAI describes the rest against it.
        const olderCodex = [
            { modelId: "gpt-5.6-terra[medium]", name: "5.6 Terra (medium)", description: "Older balanced model for straightforward work." },
            { modelId: "gpt-5.6-luna[medium]", name: "5.6 Luna (medium)", description: "Older fast and efficient model." },
            { modelId: "gpt-5.5[medium]", name: "5.5 (medium)", description: "Legacy coding model." }
        ];
        const provider = new CodexAgentProvider();
        expect([...provider.recommendedModelIds(buildCodexModelList({ availableModels: olderCodex }))])
            .toEqual(["default", "gpt-5.6-terra", "gpt-5.6-luna"]);
        // With only legacy models left, those are the newest there are.
        expect([...provider.recommendedModelIds(buildCodexModelList({ availableModels: olderCodex.slice(2) }))])
            .toEqual(["default", "gpt-5.5"]);
    });

    it("keeps a model without a level in its id as it is", () => {
        expect(buildCodexModelList({ availableModels: [{ modelId: "codex-mini", name: "Codex Mini" }] })[1])
            .toEqual({ id: "codex-mini", name: "Codex Mini", pricing: { input: 0, output: 0 }, isSubscription: true });
    });
});

/** The options codex-acp 1.13.1 offers for an MCP tool approval. */
const MCP_APPROVAL_OPTIONS = [
    { optionId: "allow_once", name: "Allow", kind: "allow_once" },
    { optionId: "allow_session", name: "Allow for this session", kind: "allow_always" },
    { optionId: "allow_always", name: "Always allow", kind: "allow_always" },
    { optionId: "cancel", name: "Cancel", kind: "reject_once" }
];

/** A tool call as codex-acp 1.13.1 announces an MCP call, before asking to run it. */
function mcpToolCall(toolCallId: string, server: string, tool: string, args: Record<string, unknown>) {
    return {
        sessionUpdate: "tool_call", toolCallId, kind: "execute", title: `mcp.${server}.${tool}`, status: "in_progress",
        rawInput: { server, tool, arguments: args }, _meta: { is_mcp_tool_call: true }
    };
}

/** The permission request codex-acp 1.13.1 sends for an announced MCP call. */
function mcpApproval(toolCallId: string, extra: Record<string, unknown> = {}) {
    return { sessionId: "sess-1", toolCall: { toolCallId, kind: "execute", status: "pending", ...extra }, _meta: { is_mcp_tool_approval: true }, options: MCP_APPROVAL_OPTIONS };
}

const ALLOWED = { outcome: { outcome: "selected", optionId: "allow_once" } };
const DENIED = { outcome: { outcome: "selected", optionId: "cancel" } };

describe("CodexAgentProvider note tools", () => {
    it("runs Trilium's note tools, shown by their name and result, and denies calls to any other MCP server", async () => {
        const answers: unknown[] = [];
        FakeAcpClient.onPrompt = async client => {
            const update = (u: Record<string, unknown>) => client.onNotification?.("session/update", { sessionId: "sess-1", update: u });
            const ask = async (request: unknown) => answers.push(await client.onAgentRequest?.("session/request_permission", request));

            update({ sessionUpdate: "tool_call", toolCallId: "mcp_startup.trilium", kind: "other", title: "mcp__trilium__startup", status: "failed" });
            update(mcpToolCall("exec-1", "trilium", "read_note", { noteId: "abc" }));
            await ask(mcpApproval("exec-1"));
            update(mcpToolCall("exec-2", "codex_apps", "send_email", { to: "x" }));
            await ask(mcpApproval("exec-2"));
            // A request that is no MCP approval is denied even for a note-tool call.
            await ask({ ...mcpApproval("exec-1"), _meta: undefined });
            update({
                sessionUpdate: "tool_call_update", toolCallId: "exec-1", status: "completed",
                rawOutput: { result: { content: [{ type: "text", text: "Note abc: groceries." }], structuredContent: null, _meta: null }, error: null }
            });
            // Once finished, the call id no longer vouches for anything.
            await ask(mcpApproval("exec-1"));
        };

        const chunks = await collect(new CodexAgentProvider().chatChunks([{ role: "user", content: "hi" }], { enableNoteTools: true }));

        expect(answers).toEqual([ALLOWED, DENIED, DENIED, DENIED]);
        expect(chunks.filter(c => c.type === "tool_use" || c.type === "tool_result")).toEqual([
            { type: "tool_use", toolCallId: "exec-1", toolName: "read_note", toolInput: { noteId: "abc" } },
            { type: "tool_use", toolCallId: "exec-2", toolName: "send_email", toolInput: { to: "x" } },
            { type: "tool_result", toolCallId: "exec-1", toolName: "read_note", result: "Note abc: groceries.", isError: false }
        ]);
    });

    it("approves a call the adapter could not match to its announcement by the server it names", () => {
        const standalone = (serverName: string) => ({
            ...mcpApproval("elicitation:sess-1:trilium:1", { title: "MCP tool call approval", rawInput: { serverName, description: "Allow?" } })
        });
        expect(decideCodexPermission(standalone("trilium"), "test")).toEqual(ALLOWED);
        expect(decideCodexPermission(standalone("codex_apps"), "test")).toEqual(DENIED);
        // No one-shot allow on offer: nothing is approved permanently.
        expect(decideCodexPermission({ ...standalone("trilium"), options: MCP_APPROVAL_OPTIONS.slice(1) }, "test")).toEqual(DENIED);
    });
});

describe("CodexAgentProvider web search", () => {
    it("lets the web search through the hook only in a chat that allows it, and shows it as a web search with its sources", async () => {
        const decisions: unknown[] = [];
        FakeAcpClient.onPrompt = async client => {
            const decide = getAcpHookEndpointUrlMock.mock.calls.at(-1)?.[1];
            decisions.push(await decide?.({ hook_event_name: "PreToolUse", session_id: "sess-1", tool_name: "webrun", tool_input: { search_query: [ { q: "kernel" } ] } }));
            const update = (u: Record<string, unknown>) => client.onNotification?.("session/update", { sessionId: "sess-1", update: u });
            update({ sessionUpdate: "tool_call", toolCallId: "search-1", kind: "search", title: "Web search", status: "in_progress", rawInput: { type: "webSearch", query: "" } });
            // codex-acp 1.13.1 reports a finished search with no content, only its final title.
            update({ sessionUpdate: "tool_call_update", toolCallId: "search-1", title: "Web search: weather Sibiu", status: "completed", rawInput: { type: "webSearch", query: "weather Sibiu" } });
            // An opened page, which names its URL in the action.
            update({ sessionUpdate: "tool_call", toolCallId: "search-2", kind: "search", title: "Web search", status: "in_progress", rawInput: { type: "webSearch", query: "", action: null } });
            update({
                sessionUpdate: "tool_call_update", toolCallId: "search-2", title: "Open page: https://www.kernel.org/", status: "completed",
                rawInput: { type: "webSearch", query: "https://www.kernel.org/", action: { type: "openPage", url: "https://www.kernel.org/" } }
            });
            // A weather lookup webrun could not run, which the adapter reports as a finished search
            // without a query; only the hooks see what it asked and, after it ends, that it failed.
            const weather = { session_id: "sess-1", tool_name: "webrun", tool_use_id: "search-3" };
            await decide?.({ ...weather, hook_event_name: "PreToolUse", tool_input: { weather: [ { location: "Romania, Sibiu", duration: 3 } ], response_length: "short" } });
            update({ sessionUpdate: "tool_call", toolCallId: "search-3", kind: "search", title: "Web search", status: "in_progress", rawInput: { type: "webSearch", query: "", action: null } });
            update({ sessionUpdate: "tool_call_update", toolCallId: "search-3", title: "Web search", status: "completed", rawInput: { type: "webSearch", query: "", action: { type: "other" } } });
            await decide?.({ ...weather, hook_event_name: "PostToolUse", tool_response: [ { type: "input_text", text: "Found no tool response. This likely means the arguments you provided were not valid." } ] });
            // The search's results, as the PostToolUse hook posts them; the marker below cites one of them and one it never returned.
            await decide?.({
                hook_event_name: "PostToolUse", session_id: "sess-1", tool_name: "webrun",
                tool_response: [ { type: "input_text", text: "Vremea \u00een Sibiu (https://www.celsium.ro/vremea-sibiu)\n\uE200cite\uE202turn3search2\uE201 [wordlim: 200] Crawled: today" } ]
            });
            // The page of one of those results, opened by its id; the completion naming the page by
            // that id too must not replace the URL the result gave.
            await decide?.({ session_id: "sess-1", tool_name: "webrun", tool_use_id: "search-4", hook_event_name: "PreToolUse", tool_input: { open: [ { ref_id: "turn3search2" } ], response_length: "medium" } });
            update({ sessionUpdate: "tool_call", toolCallId: "search-4", kind: "search", title: "Web search", status: "in_progress", rawInput: { type: "webSearch", query: "", action: null } });
            update({ sessionUpdate: "tool_call_update", toolCallId: "search-4", title: "Open page", status: "completed", rawInput: { type: "webSearch", query: "turn3search2", action: { type: "openPage", url: "turn3search2" } } });
            // A citation marker, split across chunks as a stream can split it.
            for (const text of [ "Cloudy, 12\u00b0C. \uE200cite\uE202turn3se", "arch2\uE202turn3search0\uE201", " Low chance of rain." ]) {
                update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
            }
        };
        const provider = new CodexAgentProvider();

        const searching = await collect(provider.chatChunks([{ role: "user", content: "hi" }], { chatNoteId: "a", enableWebSearch: true }));
        await collect(provider.chatChunks([{ role: "user", content: "hi" }], { chatNoteId: "b" }));

        expect(decisions).toEqual([
            {},
            { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "Web search is turned off for this chat." } }
        ]);
        // Announced without a query, then shown with the query or page once the adapter reports it,
        // and finished with a result the chat does not read as a call still running.
        expect(searching.filter(c => c.type === "tool_use" || c.type === "tool_result")).toEqual([
            { type: "tool_use", toolCallId: "search-1", toolName: "web_search", toolInput: {} },
            { type: "tool_use", toolCallId: "search-1", toolName: "web_search", toolInput: { query: "weather Sibiu" } },
            { type: "tool_result", toolCallId: "search-1", toolName: "web_search", result: "Web search: weather Sibiu", isError: false },
            { type: "tool_use", toolCallId: "search-2", toolName: "web_search", toolInput: {} },
            { type: "tool_use", toolCallId: "search-2", toolName: "web_search", toolInput: { url: "https://www.kernel.org/" } },
            { type: "tool_result", toolCallId: "search-2", toolName: "web_search", result: "Open page: https://www.kernel.org/", isError: false },
            { type: "tool_use", toolCallId: "search-3", toolName: "web_search", toolInput: { query: "weather: Romania, Sibiu" } },
            { type: "tool_use", toolCallId: "search-3", toolName: "web_search", toolInput: { query: "weather: Romania, Sibiu" } },
            { type: "tool_result", toolCallId: "search-3", toolName: "web_search", result: "Web search", isError: false },
            // The failure the hook learns of afterwards replaces the result.
            { type: "tool_result", toolCallId: "search-3", toolName: "web_search", result: "Found no tool response. This likely means the arguments you provided were not valid.", isError: true },
            { type: "tool_use", toolCallId: "search-4", toolName: "read_web_page", toolInput: { url: "https://www.celsium.ro/vremea-sibiu" } },
            { type: "tool_use", toolCallId: "search-4", toolName: "read_web_page", toolInput: { url: "https://www.celsium.ro/vremea-sibiu" } },
            { type: "tool_result", toolCallId: "search-4", toolName: "read_web_page", result: "Open page", isError: false }
        ]);
        expect(searching.map(c => (c.type === "text" ? c.content : "")).join("")).toBe("Cloudy, 12\u00b0C.  Low chance of rain.");
        // The marker becomes a Trilium citation for the result the search returned.
        expect(searching.filter(c => c.type === "citation")).toEqual([
            { type: "citation", citation: { title: "Vremea \u00een Sibiu", url: "https://www.celsium.ro/vremea-sibiu" } }
        ]);
    });
});

describe("CitationStripper", () => {
    const strip = (...chunks: string[]) => {
        const stripper = new CitationStripper();
        return chunks.map(chunk => stripper.push(chunk).text);
    };

    it("removes whole and split markers, holding back only what a marker might still need", () => {
        expect(strip("A \uE200cite\uE202turn0search1\uE201 and \uE200cite\uE202turn0search2\uE201.")).toEqual([ "A  and ." ]);
        expect(strip("A \uE200cite\uE202tu", "rn0search1", "\uE201 B")).toEqual([ "A ", "", " B" ]);
        // A marker that never closes is dropped with the rest of the turn.
        expect(strip("A \uE200cite\uE202turn0")).toEqual([ "A " ]);
    });

    it("reports the search results a marker cites, and nothing for another kind of marker", () => {
        expect(new CitationStripper().push("A \uE200cite\uE202turn1search0\uE202turn1search3\uE201 B \uE200entity\uE202x\uE201"))
            .toEqual({ text: "A  B ", refs: [ "turn1search0", "turn1search3" ] });
    });

    it("lets an opening through once it has run longer than any marker", () => {
        expect(strip("A \uE200", "x".repeat(250))).toEqual([ "A ", "x".repeat(250) ]);
    });
});
