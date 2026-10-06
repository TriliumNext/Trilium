/**
 * Codex Agent provider — drives the user's own Codex CLI through the ACP
 * adapter Trilium ships (`codex-acp`, the Agent Client Protocol), which runs in
 * a worker thread and starts `codex app-server` (see codex_binary.ts). This
 * lets users with a ChatGPT account — Free, Go, Plus, Pro or Business — use the
 * in-app chat without an API key: Codex signs in with the ChatGPT account and
 * bills the plan's Codex usage.
 *
 * `CODEX_HOME` points Codex at a directory of Trilium's own, so its
 * sign-in, sessions, MCP servers and skills are Trilium's rather than those of
 * the user's own Codex setup. A `PreToolUse` hook lets through only Trilium's
 * note tools and, in a chat that allows it, the web search (see codex_hook.ts).
 * Behind it, the session starts in the `read-only` mode, where Codex asks
 * before anything that writes, and {@link decideCodexPermission} approves only
 * calls to Trilium's note tools.
 */

import { LLM_REASONING_EFFORTS, type LlmCitation, type LlmMessage, type LlmReasoningEffort, type LlmStreamChunk } from "@triliumnext/commons";
import type { LlmProviderConfig, ModelInfo } from "@triliumnext/core/src/services/llm/types.js";
import path from "path";

import dataDirs from "../../data_dir.js";
import { AcpAgentProvider, type AcpLaunchSpec, type AcpModel, type AcpNewSessionParams, type AcpPermissionOutcome, type AcpPermissionRequest, type AcpSessionModelState, type AcpToolCallUpdate, type BuiltInToolDisplay, denyPermission, describeError, nearestEffort, NOTE_TOOLS_MCP_SERVER_NAME, sortEfforts } from "./acp_agent.js";
import type { AcpClient } from "./acp_client.js";
import { getAcpHookEndpointUrl } from "./acp_mcp_endpoint.js";
import { buildHookCommand, resolveCurlPath } from "./acp_hook.js";
import { resolveCodexAcpScript, resolveCodexBinaryPath } from "./codex_binary.js";
import { buildCodexHookCommand, type CodexHookAnswer, codexSearchSources, decideCodexToolCall, describeWebrunInput, webrunFailure, writeCodexHooks } from "./codex_hook.js";

/** The model id that leaves the session on the model Codex picks. */
const DEFAULT_MODEL_ID = "default";

/**
 * The catalog available without asking the adapter. Codex's line-up moves too
 * fast to name here, so it holds only the entry that defers to Codex's own
 * default.
 */
const AVAILABLE_MODELS: ModelInfo[] = [
    { id: DEFAULT_MODEL_ID, name: "Default", pricing: { input: 0, output: 0 }, isDefault: true, isSubscription: true }
];

/** The adapter's sign-in method for a ChatGPT account; its other one takes an API key, which the OpenAI provider serves. */
const SIGN_IN_METHOD = "chat-gpt";

/**
 * The settings the adapter merges into every session, as `CODEX_CONFIG`.
 * Codex runs a hook only once the user has trusted it, which no one can do in
 * Trilium's own `CODEX_HOME`; `features.hooks` keeps the hook running should
 * the feature's default change.
 */
const CODEX_CONFIG = { bypass_hook_trust: true, features: { hooks: true } };

/** `gpt-6-luna[medium]` → model `gpt-6-luna`, level `medium`. */
const VARIANT_ID = /^(.+)\[([^\]]+)\]$/;

/** `6 Luna (medium)` → `6 Luna`. */
const VARIANT_NAME = /^(.+?) \([^)]+\)$/;

/**
 * What the last catalog Codex reported says about its variants: for each
 * listed model, the effort levels it comes in, and the cheap model for the
 * title turn. Every `session/new` refreshes it.
 */
let catalog: { efforts: Map<string, LlmReasoningEffort[]>; titleModel?: string } = { efforts: new Map() };

/**
 * The sources each chat turn's web searches returned, by the id the model cites
 * them with, keyed by the turn's configuration: the object the pool attaches to
 * the turn's session, which the hook finds by session id.
 */
const sourcesByTurn = new WeakMap<LlmProviderConfig, Map<string, LlmCitation>>();

/**
 * How the chat shows each `webrun` call, by its id, which is also the ACP tool
 * call's. An entry goes once its call finishes; the cap bounds calls that never do.
 */
const webrunCalls = new Map<string, BuiltInToolDisplay>();
const MAX_WEBRUN_CALLS = 200;

/**
 * The models the last catalog described as `Older …`, which
 * {@link CodexAgentProvider.recommendedModelIds} leaves unselected when a newer one is
 * listed. Kept beside the catalog rather than on `ModelInfo`, whose `isLegacy` marks
 * only the `Legacy …` ones.
 */
const olderModelIds = new Set<string>();

export class CodexAgentProvider extends AcpAgentProvider {
    name = "codex-agent";
    protected readonly logLabel = "Codex Agent provider";
    protected readonly fallbackModels = AVAILABLE_MODELS;
    protected readonly defaultModelId = DEFAULT_MODEL_ID;
    protected readonly agentDirName = path.join("codex-agent", "workspace");
    protected readonly signIn = { methodId: SIGN_IN_METHOD, product: "OpenAI Codex", account: "ChatGPT" };

    /**
     * The newest models this Codex offers, and its default. Codex describes a
     * model against OpenAI's newest (`Older …`, `Legacy …`), which an older Codex
     * does not list, so the newest tier present is chosen: the models described
     * as neither, else the older ones, else the rest.
     */
    recommendedModelIds(models: ModelInfo[]): Set<string> {
        const listed = models.filter(m => m.id !== DEFAULT_MODEL_ID);
        const tiers = [
            listed.filter(m => !m.isLegacy && !olderModelIds.has(m.id)),
            listed.filter(m => !m.isLegacy),
            listed
        ];
        const newest = tiers.find(tier => tier.length > 0) ?? [];
        return new Set([ DEFAULT_MODEL_ID, ...newest.map(m => m.id) ]);
    }

    protected titleModelId(): string | undefined {
        return catalog.titleModel;
    }

    protected sessionModelId(model: string, config: LlmProviderConfig): string {
        return resolveCodexModel(model, config.reasoningEffort, catalog.efforts);
    }

    protected async launchSpec(): Promise<AcpLaunchSpec> {
        const [ codex, curl, hookUrl ] = await Promise.all([
            resolveCodexBinaryPath(),
            resolveCurlPath(),
            getAcpHookEndpointUrl("codex", payload => this.answerHook(payload))
        ]);
        const home = agentHome();
        writeCodexHooks(home, buildCodexHookCommand(curl, hookUrl), buildHookCommand(curl, hookUrl));
        return {
            binary: resolveCodexAcpScript(),
            args: [],
            worker: true,
            env: {
                CODEX_PATH: codex,
                CODEX_HOME: home,
                INITIAL_AGENT_MODE: "read-only",
                CODEX_CONFIG: JSON.stringify(CODEX_CONFIG)
            }
        };
    }

    protected buildModelList(remote: AcpSessionModelState): ModelInfo[] {
        recordCatalog(remote);
        return buildCodexModelList(remote);
    }

    protected decidePermission(
        request: AcpPermissionRequest,
        _config?: LlmProviderConfig,
        mcpServerOf?: (toolCallId: string | undefined) => string | undefined
    ): AcpPermissionOutcome {
        return decideCodexPermission(request, this.logLabel, mcpServerOf);
    }

    /** The adapter reports each MCP server's startup as a tool call of its own, `mcp_startup.<server>`. */
    protected isInternalToolCall(update: AcpToolCallUpdate): boolean {
        return update.toolCallId?.startsWith("mcp_startup.") ?? false;
    }

    /**
     * A `webrun` call, under the names the other providers' web tools carry —
     * `read_web_page` for a page it opens, `web_search` for the rest — with its
     * query or page, where the chat looks for a detail. The adapter announces
     * every call as a search with an empty query and reports the query only in
     * later updates, which carry no kind, so the hook's record fills the gap.
     */
    protected describeBuiltInTool(update: AcpToolCallUpdate): BuiltInToolDisplay | undefined {
        const input = update.rawInput as { type?: unknown; query?: unknown; action?: { type?: unknown; url?: unknown } | null } | undefined;
        if (update.kind !== "search" && input?.type !== "webSearch") {
            return undefined;
        }
        // What the hook saw of the call, for the `webrun` operations the adapter reports without a query.
        const call = update.toolCallId ? webrunCalls.get(update.toolCallId) : undefined;
        if (update.toolCallId && (update.status === "completed" || update.status === "failed")) {
            webrunCalls.delete(update.toolCallId);
        }
        const toolName = call?.toolName ?? "web_search";
        let toolInput = call?.toolInput ?? {};
        // The adapter can name a page opened by a result id with that id, so only a URL replaces what the hook resolved.
        if (input?.action?.type === "openPage" && typeof input.action.url === "string" && /^https?:\/\//i.test(input.action.url)) {
            toolInput = { url: input.action.url };
        } else if (toolName === "web_search" && typeof input?.query === "string" && input.query) {
            toolInput = { query: input.query };
        }
        return { toolName, toolInput };
    }

    /** Remember the catalog of every session opened, which picks the variant a turn runs on. */
    protected async createSession(client: AcpClient, params: AcpNewSessionParams, interactive: boolean, timeoutMs: number) {
        const created = await super.createSession(client, params, interactive, timeoutMs);
        if (created.models) {
            recordCatalog(created.models);
        }
        return created;
    }

    /** The turn, with the citation markers Codex writes into its reply taken out (see {@link CitationStripper}). */
    async *chatChunks(messages: LlmMessage[], config: LlmProviderConfig, signal?: AbortSignal): AsyncIterable<LlmStreamChunk> {
        const citations = new CitationStripper();
        for await (const chunk of super.chatChunks(messages, config, signal)) {
            if (chunk.type !== "text") {
                yield chunk;
                continue;
            }
            const { text, refs } = citations.push(chunk.content);
            if (text) {
                yield { ...chunk, content: text };
            }
            for (const ref of refs) {
                const citation = sourcesByTurn.get(config)?.get(ref);
                if (citation) {
                    yield { type: "citation", citation };
                }
            }
        }
    }

    /**
     * Answer the hook: decide a tool call before it runs, and after a web search
     * remember its sources for the turn, which the citations in the reply name,
     * or mark the call failed when it did not work.
     */
    private answerHook(payload: unknown): Promise<CodexHookAnswer> | CodexHookAnswer {
        this.recordWebrunCall(payload);
        // Codex reports a `webrun` call done before this hook learns that it failed.
        const failure = webrunFailure(payload);
        if (failure) {
            this.reportToolFailure(failure.sessionId, failure.toolCallId, failure.reason);
        }
        const search = codexSearchSources(payload);
        if (!search) {
            return decideCodexToolCall(payload, {
                configOf: sessionId => this.turnConfigOf(sessionId),
                urlOf: (sessionId, ref) => this.sourceUrl(sessionId, ref)
            });
        }
        const config = this.turnConfigOf(search.sessionId);
        if (config) {
            const known = sourcesByTurn.get(config) ?? new Map<string, LlmCitation>();
            for (const [ ref, citation ] of search.sources) {
                known.set(ref, citation);
            }
            sourcesByTurn.set(config, known);
        }
        return {};
    }

    /**
     * Remember how the chat shows a `webrun` call, from its `PreToolUse` event,
     * which reaches Trilium before the adapter announces the call. A page opened
     * by a result's id is shown by that result's URL.
     */
    private recordWebrunCall(payload: unknown): void {
        const event = payload as { hook_event_name?: unknown; tool_name?: unknown; tool_use_id?: unknown; tool_input?: unknown; session_id?: unknown } | null;
        if (event?.hook_event_name !== "PreToolUse" || event.tool_name !== "webrun" || typeof event.tool_use_id !== "string") {
            return;
        }
        const sessionId = typeof event.session_id === "string" ? event.session_id : undefined;
        webrunCalls.set(event.tool_use_id, describeWebrunInput(event.tool_input, ref => (sessionId ? this.sourceUrl(sessionId, ref) : undefined)));
        for (const oldest of webrunCalls.keys()) {
            if (webrunCalls.size <= MAX_WEBRUN_CALLS) {
                break;
            }
            webrunCalls.delete(oldest);
        }
    }

    /** The URL of a search result the web searches of the turn running in `sessionId` returned, by its id. */
    private sourceUrl(sessionId: string, ref: string): string | undefined {
        const config = this.turnConfigOf(sessionId);
        return config ? sourcesByTurn.get(config)?.get(ref)?.url : undefined;
    }

    protected describeFailure(error: unknown): string {
        const text = describeError(error);
        const signInFailure = this.describeSignInFailure(error);
        if (signInFailure) {
            return signInFailure;
        }
        if (/ENOENT|spawn/i.test(text)) {
            return `Failed to start Codex: ${text}`;
        }
        return text;
    }
}

/**
 * Approve once a call to Trilium's note tools; deny everything else.
 *
 * Codex asks before running an MCP tool that is not marked read-only, and the
 * adapter forwards that as a permission request marked
 * `_meta.is_mcp_tool_approval`. The request carries only the id of the tool
 * call, which the adapter announced just before with its server in `rawInput`,
 * so the server is looked up with `mcpServerOf`. When several calls to one
 * server wait at once, the adapter cannot tell which one is asking and names
 * the server in `toolCall.rawInput.serverName` instead. Codex fills in both,
 * not the model.
 */
export function decideCodexPermission(
    request: AcpPermissionRequest,
    logLabel: string,
    mcpServerOf?: (toolCallId: string | undefined) => string | undefined
): AcpPermissionOutcome {
    const toolCall = request.toolCall;
    const standaloneServer = (toolCall?.rawInput as { serverName?: unknown } | undefined)?.serverName;
    const server = mcpServerOf?.(toolCall?.toolCallId) ?? standaloneServer;
    const allowOnce = request.options?.find(o => o.kind === "allow_once");
    if (request._meta?.is_mcp_tool_approval === true && server === NOTE_TOOLS_MCP_SERVER_NAME && allowOnce) {
        return { outcome: { outcome: "selected", optionId: allowOnce.optionId } };
    }
    return denyPermission(request, logLabel);
}

/**
 * Codex's catalog, led by the entry that defers to its own default, with each
 * model listed once. Codex names an effort level inside the model id
 * (`gpt-6-luna[medium]`), so its variants become one entry, `gpt-6-luna`, that
 * lists the levels as `reasoningEfforts`; {@link resolveCodexModel} picks the
 * variant for a turn. A level Trilium has no name for (`ultra`, which also
 * delegates to sub-agents) is left out. Codex's order is kept: it is the picker
 * Codex itself shows, newest first.
 */
export function buildCodexModelList(remote: AcpSessionModelState): ModelInfo[] {
    olderModelIds.clear();
    const models = groupCodexCatalog(remote).map<ModelInfo>(entry => {
        if (entry.age === "older") {
            olderModelIds.add(entry.id);
        }
        const common = { pricing: { input: 0, output: 0 }, isSubscription: true, ...(entry.age === "legacy" && { isLegacy: true }) };
        if (entry.efforts.length === 0) {
            return { id: entry.id, name: entry.name, ...common };
        }
        return { id: entry.id, name: entry.name, ...common, reasoningEfforts: entry.efforts, defaultReasoningEffort: defaultEffort(entry.efforts) };
    });
    return [ ...AVAILABLE_MODELS, ...models ];
}

/**
 * The real model id for a listed model at an effort level: the variant for
 * that level, the nearest one when the model lacks it (the higher on a tie),
 * or the model's default level without a choice. An id that names no grouped
 * model is returned as it is.
 */
export function resolveCodexModel(model: string, effort: LlmReasoningEffort | undefined, efforts: Map<string, LlmReasoningEffort[]>): string {
    const levels = efforts.get(model);
    if (!levels?.length) {
        return model;
    }
    return `${model}[${nearestEffort(levels, effort ?? defaultEffort(levels))}]`;
}

/** The catalog's models, variants of one model gathered into one entry. */
function groupCodexCatalog(remote: AcpSessionModelState) {
    const entries = new Map<string, { id: string; name: string; efforts: LlmReasoningEffort[]; age: ModelAge }>();
    for (const model of remote.availableModels ?? []) {
        if (!model.modelId || model.modelId === DEFAULT_MODEL_ID) {
            continue;
        }
        const variant = VARIANT_ID.exec(model.modelId);
        const effort = variant ? asEffort(variant[2]) : undefined;
        if (variant && !effort) {
            continue;
        }
        const id = variant ? variant[1] : model.modelId;
        let entry = entries.get(id);
        if (!entry) {
            entry = { id, name: displayName(id, model), efforts: [], age: modelAge(model) };
            entries.set(id, entry);
        }
        if (effort) {
            entry.efforts.push(effort);
        }
    }
    return [ ...entries.values() ].map(entry => ({ ...entry, efforts: sortEfforts(entry.efforts) }));
}

/** Remember the variants and the title model of a catalog Codex reported. */
function recordCatalog(remote: AcpSessionModelState) {
    const entries = groupCodexCatalog(remote);
    const efforts = new Map(entries.filter(e => e.efforts.length > 0).map(e => [ e.id, e.efforts ]));
    // The newest model at its lightest level; Codex lists its fast model first.
    const lead = [ "current", "older", "legacy" ].map(age => entries.find(e => e.age === age)).find(Boolean);
    const titleModel = lead && (lead.efforts.length ? `${lead.id}[${lead.efforts[0]}]` : lead.id);
    catalog = { efforts, titleModel };
}

/** `gpt-6-luna` named `6 Luna (medium)` → `GPT-6 Luna`, as Codex's own picker shows it. */
function displayName(id: string, model: AcpModel): string {
    const name = model.name ? (VARIANT_NAME.exec(model.name)?.[1] ?? model.name) : id;
    return /^gpt-/i.test(id) && !/^gpt/i.test(name) ? `GPT-${name}` : name;
}

/** How Codex describes a model against OpenAI's newest: `Older …`, `Legacy …`, or neither. */
type ModelAge = "current" | "older" | "legacy";

function modelAge(model: AcpModel): ModelAge {
    const description = model.description ?? "";
    if (/^legacy\b/i.test(description)) {
        return "legacy";
    }
    return /^older\b/i.test(description) ? "older" : "current";
}

function asEffort(level: string): LlmReasoningEffort | undefined {
    return (LLM_REASONING_EFFORTS as readonly string[]).includes(level) ? level as LlmReasoningEffort : undefined;
}

/** Medium where the model has it, as Codex itself defaults to it; the lightest otherwise. */
function defaultEffort(sortedEfforts: LlmReasoningEffort[]): LlmReasoningEffort {
    return sortedEfforts.includes("medium") ? "medium" : sortedEfforts[0];
}

/** The adapter's `CODEX_HOME`: its sign-in, sessions and config. */
function agentHome(): string {
    return path.resolve(dataDirs.TRILIUM_DATA_DIR, "codex-agent", "home");
}


/** A citation marker opens with U+E200, separates its parts with U+E202 and closes with U+E201, private-use characters. */
const MARKER_START = "\uE200";
const MARKER_SEPARATOR = "\uE202";
const COMPLETE_MARKER = /\uE200[^\uE201]*\uE201/g;

/** Longer than any citation marker; an opening held back past it was no marker. */
const MAX_MARKER_LENGTH = 200;

/**
 * Removes the citation markers OpenAI's models write after a web search,
 * `U+E200 cite U+E202 turn3search2 U+E201`, from streamed text, and reports the
 * search results they cite, which {@link CodexAgentProvider.chatChunks} turns into
 * Trilium citations. Left in, the chat would show them as `citeturn3search2`. A
 * marker can span chunks, so text from an unclosed one is held back until it
 * closes, and dropped if it never does.
 */
export class CitationStripper {
    private pending = "";

    /** The text of `chunk` that is safe to show now, and the search results the removed markers cite. */
    push(chunk: string): { text: string; refs: string[] } {
        const refs: string[] = [];
        let text = (this.pending + chunk).replace(COMPLETE_MARKER, marker => {
            const [ kind, ...ids ] = marker.slice(1, -1).split(MARKER_SEPARATOR);
            if (kind === "cite") {
                refs.push(...ids);
            }
            return "";
        });
        let open = text.indexOf(MARKER_START);
        if (open >= 0 && text.length - open > MAX_MARKER_LENGTH) {
            text = text.replaceAll(MARKER_START, "");
            open = -1;
        }
        this.pending = open >= 0 ? text.slice(open) : "";
        return { text: open >= 0 ? text.slice(0, open) : text, refs };
    }
}

/** For tests: forget the recorded catalog and web tool calls. */
export function resetCodexCatalogForTests(): void {
    catalog = { efforts: new Map() };
    webrunCalls.clear();
    olderModelIds.clear();
}
