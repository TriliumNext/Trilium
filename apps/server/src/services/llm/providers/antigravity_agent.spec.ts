import type { LlmStreamChunk } from "@triliumnext/commons";
import fs from "fs";
import os from "os";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const infoLogMock = vi.hoisted(() => vi.fn());
vi.mock("@triliumnext/core", () => ({
    getLog: () => ({ info: infoLogMock, error: vi.fn() }),
    // buildSystemPrompt reads the workspace task states; none in this unit test.
    task_states: { getTaskStates: () => [] }
}));

const DATA_DIR = path.join(os.tmpdir(), "trilium-antigravity-agent-spec");
vi.mock("../../data_dir.js", async () => {
    const os = await import("os");
    const path = await import("path");
    return { default: { TRILIUM_DATA_DIR: path.join(os.tmpdir(), "trilium-antigravity-agent-spec") } };
});

vi.mock("./antigravity_binary.js", () => ({ resolveAntigravityBinaryPath: async () => "/opt/agy/agy_acp_server.par" }));
const getAcpHookEndpointUrlMock = vi.hoisted(() => vi.fn(async (_name: string, _handler: (payload: unknown) => unknown) => "http://127.0.0.1:12345/hook-secret/antigravity"));
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

const SIGN_IN_REQUIRED = new FakeAcpError(-32000, "Authentication required");

/** Answers like `agy_acp_server`: `session/new` fails until `authenticate` has run, when `signedIn` is false. */
class FakeAcpClient {
    static current: FakeAcpClient | undefined;
    static lastStart: { binary: string; opts: { args?: string[]; env?: Record<string, string>; cwd: string } } | undefined;
    static signedIn = true;
    /** The catalog `session/new` reports; undefined leaves `models` out of the response. */
    static availableModels: unknown[] | undefined = [];
    /** An error `session/new` fails with, when set. */
    static sessionFailure: Error | undefined;
    /** The session/update payloads the agent streams while answering session/prompt. */
    static promptUpdates: Record<string, unknown>[] = [];
    /** Runs while session/prompt is answered, as the agent's own requests do. */
    static onPrompt: ((client: FakeAcpClient) => Promise<void>) | undefined;

    requests: { method: string; params: unknown }[] = [];
    onAgentRequest?: (method: string, params: unknown) => unknown;
    onNotification?: (method: string, params: unknown) => void;

    static start(binary: string, opts: { args?: string[]; env?: Record<string, string>; cwd: string; onAgentRequest?: (m: string, p: unknown) => unknown; onNotification?: (m: string, p: unknown) => void }) {
        FakeAcpClient.lastStart = { binary, opts };
        FakeAcpClient.current = new FakeAcpClient();
        FakeAcpClient.current.onAgentRequest = opts.onAgentRequest;
        FakeAcpClient.current.onNotification = opts.onNotification;
        return FakeAcpClient.current;
    }

    async request<T>(method: string, params: unknown): Promise<T> {
        this.requests.push({ method, params });
        if (method === "authenticate") {
            FakeAcpClient.signedIn = true;
        }
        if (method === "session/new") {
            if (FakeAcpClient.sessionFailure) throw FakeAcpClient.sessionFailure;
            if (!FakeAcpClient.signedIn) throw SIGN_IN_REQUIRED;
            const models = FakeAcpClient.availableModels && { currentModelId: "gemini-3.7-flash-high", availableModels: FakeAcpClient.availableModels };
            return { sessionId: "sess-1", models } as T;
        }
        if (method === "session/prompt") {
            for (const update of FakeAcpClient.promptUpdates) {
                this.onNotification?.("session/update", { sessionId: "sess-1", update });
            }
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

const { createUpdateCollector, resetAcpAgentStateForTests } = await import("./acp_agent.js");
const { AntigravityAgentProvider, buildAntigravityEnv, buildAntigravityModelList, decideAntigravityPermission } = await import("./antigravity_agent.js");
const { parseBuildLabel } = await vi.importActual<typeof import("./antigravity_binary.js")>("./antigravity_binary.js");

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

/** The catalog agy_acp_server 1.1.1 reports on session/new, newest first. */
const REMOTE_MODELS = [
    ...["3.8", "3.7", "3.6"].flatMap(version => ["High", "Medium", "Low"].map(effort => ({
        modelId: `gemini-${version}-flash-${effort.toLowerCase()}`,
        name: `Gemini ${version} Flash (${effort})`
    }))),
    { modelId: "gemini-pro-agent", name: "Gemini 3.1 Pro (High)" },
    { modelId: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro (Low)" }
];

const PERMISSION_OPTIONS = [
    { optionId: "allow_always", name: "Allow Always", kind: "allow_always" },
    { optionId: "allow", name: "Allow", kind: "allow_once" },
    { optionId: "deny", name: "Deny", kind: "reject_once" }
];

beforeEach(() => {
    resetAcpAgentStateForTests();
    infoLogMock.mockReset();
    FakeAcpClient.current = undefined;
    FakeAcpClient.lastStart = undefined;
    FakeAcpClient.signedIn = true;
    FakeAcpClient.availableModels = REMOTE_MODELS;
    FakeAcpClient.sessionFailure = undefined;
    FakeAcpClient.promptUpdates = [];
    FakeAcpClient.onPrompt = undefined;
});

/** Answer permission requests the way the agent asks them: during a chat turn, on its session. */
async function decideDuringTurn(config: Record<string, unknown>, requests: Record<string, unknown>[]): Promise<unknown[]> {
    const answers: unknown[] = [];
    FakeAcpClient.onPrompt = async client => {
        for (const request of requests) {
            answers.push(await client.onAgentRequest?.("session/request_permission", { sessionId: "sess-1", ...request }));
        }
    };
    await collect(new AntigravityAgentProvider().chatChunks([{ role: "user", content: "hi" }], config));
    FakeAcpClient.onPrompt = undefined;
    return answers;
}

describe("decideAntigravityPermission", () => {
    // Shapes captured from agy_acp_server 1.1.1.
    it("approves once a call to Trilium's note-tools MCP server", () => {
        expect(decideAntigravityPermission({
            toolCall: {
                toolCallId: "fa53",
                kind: "other",
                title: "trilium_search_notes",
                rawInput: { arguments: { query: "x" } },
                _meta: { mcp: { tool: "search_notes", server: "trilium" }, is_mcp_tool_call: true }
            },
            options: PERMISSION_OPTIONS
        }, "test")).toEqual({ outcome: { outcome: "selected", optionId: "allow" } });
    });

    it("denies built-in tools, other MCP servers, and calls that only name Trilium in model-controlled fields", () => {
        const denied = { outcome: { outcome: "selected", optionId: "deny" } };
        // A shell command, as the server asks for it.
        expect(decideAntigravityPermission({
            toolCall: { toolCallId: "385f", kind: "execute", title: "id", rawInput: { CommandLine: "id" } },
            options: PERMISSION_OPTIONS
        }, "test")).toEqual(denied);
        // A tool from an MCP server Trilium did not provide.
        expect(decideAntigravityPermission({
            toolCall: { kind: "other", title: "other_fetch", _meta: { mcp: { tool: "fetch", server: "other" }, is_mcp_tool_call: true } },
            options: PERMISSION_OPTIONS
        }, "test")).toEqual(denied);
        // A built-in tool whose title and arguments the model filled with Trilium's name.
        expect(decideAntigravityPermission({
            toolCall: { kind: "fetch", title: "trilium_search_notes", rawInput: { Url: "https://example.com/?server=trilium" } },
            options: PERMISSION_OPTIONS
        }, "test")).toEqual(denied);
        // A note-tool call with no one-shot allow on offer is not approved permanently.
        expect(decideAntigravityPermission({
            toolCall: { kind: "other", _meta: { mcp: { server: "trilium" }, is_mcp_tool_call: true } },
            options: [PERMISSION_OPTIONS[0], PERMISSION_OPTIONS[2]]
        }, "test")).toEqual(denied);
    });

    // Shape captured from agy_acp_server 1.2.1.
    const SEARCH_WEB = { toolCallId: "7bba", kind: "search", status: "pending", title: "Run search_web?", rawInput: { query: "weather Sibiu today" } };

    it("approves a web search once only in a chat with web search on", () => {
        const allowed = { outcome: { outcome: "selected", optionId: "allow" } };
        const denied = { outcome: { outcome: "selected", optionId: "deny" } };
        expect(decideAntigravityPermission({ toolCall: SEARCH_WEB, options: PERMISSION_OPTIONS }, "test", { webSearch: true })).toEqual(allowed);
        expect(decideAntigravityPermission({ toolCall: SEARCH_WEB, options: PERMISSION_OPTIONS }, "test", { webSearch: false })).toEqual(denied);
        expect(decideAntigravityPermission({ toolCall: SEARCH_WEB, options: PERMISSION_OPTIONS }, "test")).toEqual(denied);
        // A shell command the model titled like a search, and another search-kind tool.
        expect(decideAntigravityPermission({
            toolCall: { kind: "execute", title: "Run search_web?", rawInput: { CommandLine: "Run search_web?" } },
            options: PERMISSION_OPTIONS
        }, "test", { webSearch: true })).toEqual(denied);
        expect(decideAntigravityPermission({
            toolCall: { ...SEARCH_WEB, title: "Run read_url_content?" },
            options: PERMISSION_OPTIONS
        }, "test", { webSearch: true })).toEqual(denied);
    });
});

describe("AntigravityAgentProvider", () => {
    it("launches the server with a home of Trilium's own and routes permission requests through the policy", async () => {
        await collect(new AntigravityAgentProvider().chatChunks([{ role: "user", content: "hi" }], { enableNoteTools: true }));

        const start = FakeAcpClient.lastStart;
        expect(start?.binary).toBe("/opt/agy/agy_acp_server.par");
        expect(start?.opts.args).toEqual(process.platform === "linux" ? ["--uid="] : []);
        expect(start?.opts.env?.GEMINI_HOME).toBe(path.join(DATA_DIR, "antigravity-agent", "home"));
        expect(start?.opts.cwd).toBe(path.join(DATA_DIR, "antigravity-agent", "workspace"));

        const sessionNew = FakeAcpClient.current?.requests.find(r => r.method === "session/new");
        expect(sessionNew?.params).toMatchObject({ mcpServers: [{ name: "trilium", type: "http" }] });
        expect(FakeAcpClient.current?.onAgentRequest?.("session/request_permission", {
            toolCall: { kind: "execute", title: "rm -rf /" },
            options: PERMISSION_OPTIONS
        })).toEqual({ outcome: { outcome: "selected", optionId: "deny" } });
    });

    it("keeps the agent away from its sign-in with a hook that asks Trilium about every tool call", async () => {
        const home = path.join(DATA_DIR, "antigravity-agent", "home");
        fs.rmSync(path.join(home, "config"), { recursive: true, force: true });
        getAcpHookEndpointUrlMock.mockClear();
        await collect(new AntigravityAgentProvider().chatChunks([{ role: "user", content: "hi" }], {}));

        const hooks = JSON.parse(fs.readFileSync(path.join(home, "config", "hooks.json"), "utf8"));
        expect(hooks["trilium-file-access"].PreToolUse[0]).toMatchObject({
            matcher: ".*",
            hooks: [ { command: "\"/usr/bin/curl\" --silent --show-error --fail --noproxy 127.0.0.1 --max-time 8 --data-binary @- http://127.0.0.1:12345/hook-secret/antigravity" } ]
        });

        const [ name, decide ] = getAcpHookEndpointUrlMock.mock.calls[0];
        expect(name).toBe("antigravity");
        const tokenRead = { toolCall: { name: "view_file", args: { AbsolutePath: path.join(home, "antigravity-acp", "acp_token.json") } } };
        expect(decide(tokenRead)).toMatchObject({ decision: "deny" });
        expect(infoLogMock).toHaveBeenCalledWith(expect.stringContaining(`kept view_file out of the server's private folder`));
        expect(decide({ toolCall: { name: "view_file", args: { AbsolutePath: path.join(DATA_DIR, "antigravity-agent", "workspace", "a.md") } } }))
            .toEqual({ decision: "allow" });
    });

    it("lets the agent search the web only when the chat allows it", async () => {
        const request = { toolCall: { kind: "search", title: "Run search_web?", rawInput: { query: "x" } }, options: PERMISSION_OPTIONS };

        expect(await decideDuringTurn({ enableWebSearch: true }, [request]))
            .toEqual([{ outcome: { outcome: "selected", optionId: "allow" } }]);
        expect(await decideDuringTurn({}, [request]))
            .toEqual([{ outcome: { outcome: "selected", optionId: "deny" } }]);
        // The chats share one agent process, so a request from a session no
        // turn owns gets no chat's settings.
        expect(FakeAcpClient.current?.onAgentRequest?.("session/request_permission", { sessionId: "sess-1", ...request }))
            .toEqual({ outcome: { outcome: "selected", optionId: "deny" } });
    });

    it("lets the agent read a public web page only when the chat allows web access", async () => {
        // Shape captured from agy_acp_server 1.2.1. IP literals need no DNS.
        const readUrl = (url: string) => ({
            toolCall: { kind: "fetch", status: "pending", title: "Run read_url_content?", rawInput: { Url: url } },
            options: PERMISSION_OPTIONS
        });
        const allowed = { outcome: { outcome: "selected", optionId: "allow" } };
        const denied = { outcome: { outcome: "selected", optionId: "deny" } };

        expect(await decideDuringTurn({ enableWebSearch: true }, [
            readUrl("https://93.184.215.14/"),
            readUrl("http://127.0.0.1:8080/"),
            readUrl("file:///C:/antigravity-acp/acp_token.json"),
            // A shell command the model titled like a page read.
            { ...readUrl("https://93.184.215.14/"), toolCall: { kind: "execute", title: "Run read_url_content?", rawInput: { Url: "https://93.184.215.14/" } } },
            // A page read that names no URL.
            { ...readUrl(""), toolCall: { kind: "fetch", title: "Run read_url_content?", rawInput: {} } }
        ])).toEqual([allowed, denied, denied, denied, denied]);

        expect(await decideDuringTurn({}, [readUrl("https://93.184.215.14/")])).toEqual([denied]);
    });

    it("explains a failure to start, sign in or answer in words the user can act on", async () => {
        const failureOf = async (error: Error) => {
            FakeAcpClient.sessionFailure = error;
            resetAcpAgentStateForTests();
            return new AntigravityAgentProvider().listModels().then(() => "resolved", (err: Error) => err.message);
        };
        expect(await failureOf(new Error("ACP request \"authenticate\" timed out after 300000ms"))).toMatch(/sign-in was not completed in time/);
        expect(await failureOf(new Error("spawn C:\\agy\\agy_acp_server.exe ENOENT"))).toBe("Failed to start Google's Antigravity ACP server: spawn C:\\agy\\agy_acp_server.exe ENOENT");
        expect(await failureOf(new Error("Something else"))).toBe("Something else");
    });

    it("passes the Linux build the empty --uid= the ACP registry launches it with, and no other build", async () => {
        const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
        const argsOn = async (platform: NodeJS.Platform) => {
            Object.defineProperty(process, "platform", { ...originalPlatform, value: platform });
            // Each platform launches its own process.
            resetAcpAgentStateForTests();
            await collect(new AntigravityAgentProvider().chatChunks([{ role: "user", content: "hi" }], {}));
            return FakeAcpClient.lastStart?.opts.args;
        };
        try {
            expect(await argsOn("linux")).toEqual([ "--uid=" ]);
            expect(await argsOn("win32")).toEqual([]);
        } finally {
            if (originalPlatform) {
                Object.defineProperty(process, "platform", originalPlatform);
            }
        }
    });

    it("works with a server that reports no catalog, or one without a Flash Low to title on", async () => {
        FakeAcpClient.availableModels = undefined;
        expect((await new AntigravityAgentProvider().listModels()).map(m => m.id)).toEqual([ "default" ]);
        const chunks = await collect(new AntigravityAgentProvider().chatChunks([{ role: "user", content: "hi" }], {}));
        expect(chunks.at(-1)).toEqual({ type: "done" });

        resetAcpAgentStateForTests();
        FakeAcpClient.availableModels = [ { modelId: "gemini-4-ultra-high", name: "Gemini 4 Ultra (High)" } ];
        const provider = new AntigravityAgentProvider();
        expect((await provider.listModels()).map(m => [ m.id, m.name, m.reasoningEfforts ])).toEqual([
            [ "default", "Default", undefined ],
            [ "gemini-4-ultra-high", "Gemini 4 Ultra (High)", undefined ]
        ]);
        await provider.generateTitle("plan my week");
        expect(FakeAcpClient.current?.methods()).not.toContain("session/set_model");
    });

    it("signs in during the model probe, but reports a missing sign-in in the chat instead", async () => {
        FakeAcpClient.signedIn = false;
        const chunks = await collect(new AntigravityAgentProvider().chatChunks([{ role: "user", content: "hi" }], {}));
        expect(chunks).toEqual([{ type: "error", error: "Google Antigravity is not signed in. Open this provider in the AI settings and go to the model selection, which opens the Google sign-in page in a browser on the device running Trilium." }]);
        expect(FakeAcpClient.current?.methods()).not.toContain("authenticate");

        const models = await new AntigravityAgentProvider().listModels();
        expect(FakeAcpClient.current?.methods()).toEqual(["initialize", "session/new", "authenticate", "session/new"]);
        expect(FakeAcpClient.current?.requests[2].params).toEqual({ methodId: "oauth-personal" });
        expect(models.map(m => m.id)).toEqual(["default", "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.1-pro"]);
        // The ACP prompt carries images but no PDFs, which become placeholders.
        expect(models.map(m => m.attachmentKinds)).toEqual(models.map(() => ["image"]));
    });

    it("leaves the default model to the server, selects any other, and titles on the newest Flash Low", async () => {
        const provider = new AntigravityAgentProvider();
        await collect(provider.chatChunks([{ role: "user", content: "hi" }], {}));
        expect(FakeAcpClient.current?.methods()).not.toContain("session/set_model");

        await collect(provider.chatChunks([{ role: "user", content: "hi" }], { model: "gemini-pro-agent" }));
        expect(FakeAcpClient.current?.requests.filter(r => r.method === "session/set_model").at(-1)?.params).toEqual({ sessionId: "sess-1", modelId: "gemini-pro-agent" });

        // The probe runs on a client of its own; the title runs on the chats' process.
        const pooled = FakeAcpClient.current;
        await provider.listModels();
        await provider.generateTitle("plan my week");
        expect(pooled?.requests.filter(r => r.method === "session/set_model").at(-1)?.params).toEqual({ sessionId: "sess-1", modelId: "gemini-3.8-flash-low" });
    });

    it("pre-selects the newest version of each family", () => {
        const models = buildAntigravityModelList({ availableModels: [
            ...REMOTE_MODELS,
            // A model named some other way is kept rather than hidden.
            { modelId: "gemini-nano-agent", name: "Gemini Nano Agent" }
        ] });

        expect([...new AntigravityAgentProvider().recommendedModelIds(models)].sort())
            .toEqual([ "default", "gemini-3.1-pro", "gemini-3.8-flash", "gemini-nano-agent" ]);
    });

    it("runs a model at the effort the chat chose, the model's default otherwise", async () => {
        const provider = new AntigravityAgentProvider();
        const modelSetFor = async (config: Record<string, unknown>) => {
            await collect(provider.chatChunks([{ role: "user", content: "hi" }], config));
            return (FakeAcpClient.current?.requests.filter(r => r.method === "session/set_model").at(-1)?.params as { modelId?: string } | undefined)?.modelId;
        };

        expect(await modelSetFor({ model: "gemini-3.8-flash", reasoningEffort: "medium" })).toBe("gemini-3.8-flash-medium");
        expect(await modelSetFor({ model: "gemini-3.1-pro", reasoningEffort: "low" })).toBe("gemini-3.1-pro-low");
        // No choice: the model's default, High.
        expect(await modelSetFor({ model: "gemini-3.1-pro" })).toBe("gemini-pro-agent");
        // A level the model lacks: the nearest one, the higher on a tie.
        expect(await modelSetFor({ model: "gemini-3.1-pro", reasoningEffort: "medium" })).toBe("gemini-pro-agent");
        expect(await modelSetFor({ model: "gemini-3.8-flash", reasoningEffort: "minimal" })).toBe("gemini-3.8-flash-low");
        // A variant id saved before the variants were grouped still works.
        expect(await modelSetFor({ model: "gemini-3.7-flash-low", reasoningEffort: "high" })).toBe("gemini-3.7-flash-low");
    });

    it("reports the variant the turn ran on, by the server's name for it", async () => {
        const provider = new AntigravityAgentProvider();
        const usageFor = async (config: Record<string, unknown>) => {
            const chunks = await collect(provider.chatChunks([{ role: "user", content: "hi" }], config));
            return chunks.find(c => c.type === "usage");
        };

        expect(await usageFor({ model: "gemini-3.8-flash", reasoningEffort: "medium" }))
            .toEqual({ type: "usage", usage: { model: "Gemini 3.8 Flash (Medium)", provider: "antigravity-agent" } });
        // The default leaves the pick to the server, which names it in session/new.
        expect(await usageFor({}))
            .toEqual({ type: "usage", usage: { model: "Gemini 3.7 Flash (High)", provider: "antigravity-agent" } });
    });
});

describe("tool call updates from agy_acp_server", () => {
    it("names an MCP tool call after the tool and unwraps its arguments", () => {
        const chunks: LlmStreamChunk[] = [];
        const collector = createUpdateCollector(chunk => chunks.push(chunk));
        const meta = { mcp: { tool: "search_icons", server: "trilium" }, is_mcp_tool_call: true };
        collector.onNotification("session/update", {
            sessionId: "sess-1",
            update: {
                sessionUpdate: "tool_call", toolCallId: "f6b5", title: "trilium_search_icons", kind: "other", status: "pending",
                content: [], rawInput: { arguments: { query: "font" } }, _meta: meta
            }
        });
        collector.onNotification("session/update", {
            sessionId: "sess-1",
            update: {
                sessionUpdate: "tool_call_update", toolCallId: "f6b5", status: "completed",
                content: [{ content: { text: "Search for icons", type: "text" }, type: "content" }], rawOutput: "Search for icons"
            }
        });

        expect(chunks).toEqual([
            { type: "tool_use", toolCallId: "f6b5", toolName: "search_icons", toolInput: { query: "font" } },
            { type: "tool_result", toolCallId: "f6b5", toolName: "search_icons", result: "Search for icons", isError: false }
        ]);
    });

    it("passes an MCP call's input through when it is not wrapped in an arguments object", () => {
        const chunks: LlmStreamChunk[] = [];
        const collector = createUpdateCollector(chunk => chunks.push(chunk));
        const meta = { mcp: { tool: "search_icons", server: "trilium" }, is_mcp_tool_call: true };
        for (const [ toolCallId, rawInput ] of [ [ "a", { arguments: "font" } ], [ "b", undefined ] ] as const) {
            collector.onNotification("session/update", {
                sessionId: "sess-1",
                update: { sessionUpdate: "tool_call", toolCallId, title: "trilium_search_icons", kind: "other", status: "pending", rawInput, _meta: meta }
            });
        }
        expect(chunks.map(c => c.type === "tool_use" && c.toolInput)).toEqual([ { arguments: "font" }, {} ]);
    });
});

describe("AntigravityAgentProvider tool calls", () => {
    // Shapes captured from agy_acp_server 1.1.1.
    const MCP_DIR = path.join(DATA_DIR, "antigravity-agent", "home", "antigravity-acp", "brain", "06ada25b", "mcp", "trilium");
    const TOKEN_FILE = path.join(DATA_DIR, "antigravity-agent", "home", "antigravity-acp", "acp_token.json");

    it("hides the agent's reads of its own working files, and nothing else", async () => {
        const savedPage = path.join(DATA_DIR, "antigravity-agent", "home", "antigravity-acp", "brain", "f0c024c5", ".system_generated", "steps", "10", "content.md");
        FakeAcpClient.promptUpdates = [
            // Reading a fetched page the server saved, which the agent never completes: hidden, so it cannot end up "stopped".
            { sessionUpdate: "tool_call", toolCallId: "call_228152", title: "Running view_file", kind: "read", status: "in_progress", rawInput: { AbsolutePath: savedPage, StartLine: 1, EndLine: 60 } },
            // Listing the tool descriptions: hidden, and so is its completion.
            { sessionUpdate: "tool_call", toolCallId: "06ada25b:2", title: "Running list_directory", kind: "search", status: "in_progress", locations: [{ path: MCP_DIR }], rawInput: { directory_path: MCP_DIR } },
            { sessionUpdate: "tool_call_update", toolCallId: "06ada25b:2", status: "completed", rawOutput: "List trilium MCP tools" },
            // Reading one that does not exist, which the agent never completes: hidden, so it cannot end up "stopped".
            { sessionUpdate: "tool_call", toolCallId: "call_257368", title: "Running view_file", kind: "read", status: "in_progress", rawInput: { AbsolutePath: path.join(MCP_DIR, "instructions.md") } },
            // Its own sign-in token lives in its home too, and a read of it stays visible.
            { sessionUpdate: "tool_call", toolCallId: "call_token", title: "Running view_file", kind: "read", status: "in_progress", locations: [{ path: TOKEN_FILE }], rawInput: { AbsolutePath: TOKEN_FILE } },
            { sessionUpdate: "tool_call_update", toolCallId: "call_token", status: "completed", rawOutput: "Read token" },
            // A note tool.
            { sessionUpdate: "tool_call", toolCallId: "cf21", title: "trilium_search_icons", kind: "other", status: "pending", rawInput: { arguments: { query: "font" } }, _meta: { mcp: { tool: "search_icons", server: "trilium" }, is_mcp_tool_call: true } },
            { sessionUpdate: "tool_call_update", toolCallId: "cf21", status: "completed", rawOutput: "Search icons" }
        ];

        const chunks = await collect(new AntigravityAgentProvider().chatChunks([{ role: "user", content: "hi" }], { enableNoteTools: true }));
        expect(chunks.filter(c => c.type === "tool_use" || c.type === "tool_result").map(c => c.toolCallId)).toEqual(["call_token", "call_token", "cf21", "cf21"]);
    });

    it("names the web search like the other providers do, and nothing the model titled after it", async () => {
        FakeAcpClient.promptUpdates = [
            { sessionUpdate: "tool_call", toolCallId: "7bba", title: "Run search_web?", kind: "search", status: "pending", rawInput: { query: "weather Sibiu today" } },
            { sessionUpdate: "tool_call_update", toolCallId: "7bba", status: "completed", rawOutput: "Sunny" },
            { sessionUpdate: "tool_call", toolCallId: "sh1", title: "Run search_web?", kind: "execute", status: "pending", rawInput: { CommandLine: "Run search_web?" } },
            { sessionUpdate: "tool_call", toolCallId: "0601", title: "Run read_url_content?", kind: "fetch", status: "pending", rawInput: { Url: "https://en.wikipedia.org/wiki/Quantum_computing" } }
        ];

        const chunks = await collect(new AntigravityAgentProvider().chatChunks([{ role: "user", content: "hi" }], { enableWebSearch: true }));
        expect(chunks.filter(c => c.type === "tool_use" || c.type === "tool_result")).toEqual([
            { type: "tool_use", toolCallId: "7bba", toolName: "web_search", toolInput: { query: "weather Sibiu today" } },
            { type: "tool_result", toolCallId: "7bba", toolName: "web_search", result: "Sunny", isError: false },
            { type: "tool_use", toolCallId: "sh1", toolName: "Run search_web?", toolInput: { CommandLine: "Run search_web?" } },
            { type: "tool_use", toolCallId: "0601", toolName: "read_web_page", toolInput: { url: "https://en.wikipedia.org/wiki/Quantum_computing" } }
        ]);
    });

    it("shows an untitled call as a plain tool, and hides a working-file read whatever its input", async () => {
        const brain = path.join(DATA_DIR, "antigravity-agent", "home", "antigravity-acp", "brain", "06ad", "notes.md");
        FakeAcpClient.promptUpdates = [
            { sessionUpdate: "tool_call", toolCallId: "s1", kind: "search", status: "pending", rawInput: { query: "q" } },
            { sessionUpdate: "tool_call", toolCallId: "f1", kind: "fetch", status: "pending", rawInput: { Url: "https://example.com/" } },
            { sessionUpdate: "tool_call", toolCallId: "b1", title: "Running view_file", kind: "read", status: "in_progress", locations: [{ path: brain }], rawInput: "notes" }
        ];

        const chunks = await collect(new AntigravityAgentProvider().chatChunks([{ role: "user", content: "hi" }], { enableWebSearch: true }));
        expect(chunks.filter(c => c.type === "tool_use").map(c => [ c.toolCallId, c.toolName ])).toEqual([ [ "s1", "tool" ], [ "f1", "tool" ] ]);
    });
});

describe("buildAntigravityModelList", () => {
    it("lists each model once, with the efforts it comes in", () => {
        const efforts = { pricing: { input: 0, output: 0 }, isSubscription: true, defaultReasoningEffort: "high" };
        expect(buildAntigravityModelList({ availableModels: REMOTE_MODELS })).toEqual([
            { id: "default", name: "Default", pricing: { input: 0, output: 0 }, isDefault: true, isSubscription: true },
            { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", reasoningEfforts: [ "low", "medium", "high" ], ...efforts },
            { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash", reasoningEfforts: [ "low", "medium", "high" ], ...efforts },
            { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash", reasoningEfforts: [ "low", "medium", "high" ], ...efforts },
            { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro", reasoningEfforts: [ "low", "high" ], ...efforts }
        ]);
    });

    it("leads with the server's own default and keeps the server's order and names", () => {
        expect(buildAntigravityModelList({ availableModels: [{ modelId: "gemini-x" }, { modelId: "default" }, { modelId: "" }] })).toEqual([
            { id: "default", name: "Default", pricing: { input: 0, output: 0 }, isDefault: true, isSubscription: true },
            { id: "gemini-x", name: "gemini-x", pricing: { input: 0, output: 0 }, isSubscription: true }
        ]);
    });

    it("keeps a label that is no effort level in the name, and defaults to the strongest level without High", () => {
        const models = buildAntigravityModelList({ availableModels: [
            { modelId: "gemini-3-pro-ultra", name: "Gemini 3 Pro (Ultra)" },
            { modelId: "gemini-3.9-flash-low", name: "Gemini 3.9 Flash (Low)" },
            { modelId: "gemini-3.9-flash-medium", name: "Gemini 3.9 Flash (Medium)" }
        ] });
        expect(models.slice(1).map(m => [ m.id, m.name, m.reasoningEfforts, m.defaultReasoningEffort ])).toEqual([
            [ "gemini-3-pro-ultra", "Gemini 3 Pro (Ultra)", undefined, undefined ],
            [ "gemini-3.9-flash", "Gemini 3.9 Flash", [ "low", "medium" ], "medium" ]
        ]);
    });

    it("compares versions of different lengths as if padded with zeros", () => {
        const models = buildAntigravityModelList({ availableModels: [
            { modelId: "gemini-3-flash", name: "Gemini 3 Flash" },
            { modelId: "gemini-3.1-flash", name: "Gemini 3.1 Flash" },
            { modelId: "gemini-3.0-pro", name: "Gemini 3.0 Pro" },
            { modelId: "gemini-3-pro", name: "Gemini 3 Pro" }
        ] });
        expect([ ...new AntigravityAgentProvider().recommendedModelIds(models) ].sort())
            .toEqual([ "default", "gemini-3-pro", "gemini-3.0-pro", "gemini-3.1-flash" ]);
    });
});

describe("buildAntigravityEnv", () => {
    it("points SSL_CERT_FILE at the first CA bundle on Linux, only when unset", () => {
        const fedora = (file: string) => file === "/etc/pki/tls/certs/ca-bundle.crt";
        expect(buildAntigravityEnv("/home", "linux", {}, fedora)).toEqual({ GEMINI_HOME: "/home", SSL_CERT_FILE: "/etc/pki/tls/certs/ca-bundle.crt" });
        expect(buildAntigravityEnv("/home", "linux", { SSL_CERT_FILE: "/mine.pem" }, fedora)).toEqual({ GEMINI_HOME: "/home" });
        expect(buildAntigravityEnv("/home", "linux", {}, () => false)).toEqual({ GEMINI_HOME: "/home" });
        expect(buildAntigravityEnv("/home", "darwin", {}, () => true)).toEqual({ GEMINI_HOME: "/home" });
    });
});

describe("parseBuildLabel", () => {
    it("reads the build label, falling back to the first line", () => {
        expect(parseBuildLabel("Built on Wed Sep  2 2026\nBuild label: agy_acp_server_1.1.1\nBuild tool: Blaze")).toBe("agy_acp_server_1.1.1");
        expect(parseBuildLabel("agy 2.0\nmore")).toBe("agy 2.0");
    });
});
