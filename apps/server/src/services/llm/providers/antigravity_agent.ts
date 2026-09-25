/**
 * Antigravity Agent provider — drives Google's Antigravity ACP server
 * (`agy_acp_server`) as a subprocess. This lets users with a Google account —
 * free, Google AI Pro or Ultra — use the in-app chat on Gemini without an API
 * key: the server signs in with the Google account and bills the account's
 * Antigravity quota.
 *
 * Unlike the Copilot CLI, the server has no command-line switches for its
 * built-in tools, so the boundary is drawn differently:
 *   - `GEMINI_HOME` points it at a directory of Trilium's own, so its sign-in,
 *     sessions, MCP servers and skills are Trilium's rather than those of the
 *     user's own Antigravity setup;
 *   - its read tools are confined to the (empty) agent cwd and
 *     `<home>/antigravity-acp`, which also holds the sign-in, so a hook keeps
 *     them out of that folder (see `antigravity_hook.ts`);
 *   - every tool that writes, runs a command or reaches the network asks
 *     permission first, and {@link decideAntigravityPermission} approves only
 *     Trilium's note tools.
 */

import { LLM_REASONING_EFFORTS, type LlmReasoningEffort } from "@triliumnext/commons";
import { getLog } from "@triliumnext/core";
import type { LlmProviderConfig, ModelInfo } from "@triliumnext/core/src/services/llm/types.js";
import { existsSync } from "fs";
import path from "path";

import dataDirs from "../../data_dir.js";
import { AcpAgentProvider, type AcpLaunchSpec, type AcpNewSessionParams, type AcpPermissionOutcome, type AcpPermissionRequest, type AcpSessionModelState, type AcpToolCallUpdate, type BuiltInToolDisplay, denyPermission, describeError, NOTE_TOOLS_MCP_SERVER_NAME } from "./acp_agent.js";
import { type AcpClient, AcpError } from "./acp_client.js";
import { getAcpHookEndpointUrl } from "./acp_mcp_endpoint.js";
import { resolveAntigravityBinaryPath } from "./antigravity_binary.js";
import { type AntigravityDirs, type AntigravityHookDecision, buildHookCommand, decideAntigravityToolCall, resolveCurlPath, writeAntigravityHooks } from "./antigravity_hook.js";
import { isPublicHttpUrl } from "./public_url.js";

/** The model id that leaves the session on the model the server picks. */
const DEFAULT_MODEL_ID = "default";

/**
 * The catalog available without asking the server. Gemini's line-up moves too
 * fast to name here, so it holds only the entry that defers to the server's
 * own default.
 */
const AVAILABLE_MODELS: ModelInfo[] = [
    { id: DEFAULT_MODEL_ID, name: "Default", pricing: { input: 0, output: 0 }, isDefault: true, isSubscription: true }
];

/**
 * The sign-in method for a personal Google account, which covers the free tier
 * and Google AI Pro/Ultra alike. The server also offers `oauth-business`,
 * `gemini-api-key` and `agent-platform`, which the API-key Gemini provider
 * already serves better.
 */
const SIGN_IN_METHOD = "oauth-personal";

/** How long the add-provider screen waits for the user to finish signing in in the browser. */
export const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

/** CA bundle locations on common Linux distributions, in the order Go's crypto/x509 tries them. */
const LINUX_CA_BUNDLES = [
    "/etc/ssl/certs/ca-certificates.crt",
    "/etc/pki/tls/certs/ca-bundle.crt",
    "/etc/ssl/ca-bundle.pem",
    "/etc/pki/tls/cacert.pem",
    "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
    "/etc/ssl/cert.pem"
];

/**
 * What the last catalog the server reported says about its variants: for each
 * listed model, the real id of each effort level, and the cheap model for the
 * title turn. Every `session/new` refreshes it, so a chat turn resolves
 * against the catalog of the session it runs in.
 */
let catalog: { variants: Map<string, Map<LlmReasoningEffort, string>>; titleModel?: string } = { variants: new Map() };

export class AntigravityAgentProvider extends AcpAgentProvider {
    name = "antigravity-agent";
    protected readonly logLabel = "Antigravity Agent provider";
    protected readonly fallbackModels = AVAILABLE_MODELS;
    protected readonly defaultModelId = DEFAULT_MODEL_ID;
    protected readonly agentDirName = path.join("antigravity-agent", "workspace");

    /**
     * The newest version of each family, every effort level included, plus
     * `default`. Older versions stay in the list, unselected. The family and
     * version come from the display name (`Gemini 3.8 Flash (High)`), since
     * the ids are not uniform (`gemini-pro-agent` is Gemini 3.1 Pro (High)). A
     * model named any other way is selected, so a new naming scheme cannot hide
     * the whole catalog.
     */
    recommendedModelIds(models: ModelInfo[]): Set<string> {
        const parsed = models.map(model => ({ model, name: parseGeminiModelName(model.name) }));
        const newestByFamily = new Map<string, number[]>();
        for (const { name } of parsed) {
            if (name) {
                const newest = newestByFamily.get(name.family);
                if (!newest || compareVersions(name.version, newest) > 0) {
                    newestByFamily.set(name.family, name.version);
                }
            }
        }
        return new Set(parsed
            .filter(({ name }) => {
                if (!name) {
                    return true;
                }
                /* v8 ignore next -- the loop above records a newest version for every family it parsed. */
                const newest = newestByFamily.get(name.family) ?? [];
                return compareVersions(name.version, newest) === 0;
            })
            .map(({ model }) => model.id));
    }

    protected titleModelId(): string | undefined {
        return catalog.titleModel;
    }

    protected sessionModelId(model: string, config: LlmProviderConfig): string {
        return resolveAntigravityModel(model, config.reasoningEffort, catalog.variants);
    }

    protected async launchSpec(): Promise<AcpLaunchSpec> {
        const home = agentHome();
        const dirs = { home, workspace: this.agentCwd() };
        const [ binary, curl, hookUrl ] = await Promise.all([
            resolveAntigravityBinaryPath(),
            resolveCurlPath(),
            getAcpHookEndpointUrl(payload => this.decideToolCall(payload, dirs))
        ]);
        writeAntigravityHooks(home, buildHookCommand(curl, hookUrl));
        return {
            binary,
            // The ACP registry launches the Linux build with an empty `--uid=`.
            args: process.platform === "linux" ? ["--uid="] : [],
            env: buildAntigravityEnv(agentHome())
        };
    }

    protected buildModelList(remote: AcpSessionModelState): ModelInfo[] {
        recordCatalog(remote);
        return buildAntigravityModelList(remote);
    }

    protected decidePermission(request: AcpPermissionRequest, config?: LlmProviderConfig): AcpPermissionOutcome | Promise<AcpPermissionOutcome> {
        const webSearch = config?.enableWebSearch === true;
        if (webSearch && isUrlRead(request.toolCall)) {
            return decideAntigravityUrlRead(request, this.logLabel);
        }
        return decideAntigravityPermission(request, this.logLabel, { webSearch });
    }

    /** Answer the file-access hook for one tool call, logging each denial. */
    private decideToolCall(payload: unknown, dirs: AntigravityDirs): AntigravityHookDecision {
        const answer = decideAntigravityToolCall(payload, dirs);
        if (answer.decision === "deny") {
            const tool = (payload as { toolCall?: { name?: unknown } }).toolCall?.name;
            getLog().info(`${this.logLabel}: kept ${String(tool)} out of the server's private folder.`);
        }
        return answer;
    }

    /**
     * The agent reads its own working files with its file tools: the
     * description of an MCP tool before calling it, and the saved output of a
     * long tool result such as a fetched page. Those reads are how it follows
     * its own tools, not work on the user's behalf.
     */
    protected isInternalToolCall(update: AcpToolCallUpdate): boolean {
        return isWorkingFileAccess(update, agentHome());
    }

    /**
     * The web search, under the name the other providers' searches carry, and
     * the page read, with the URL where the chat looks for a detail.
     */
    protected describeBuiltInTool(update: AcpToolCallUpdate): BuiltInToolDisplay | undefined {
        if (isWebSearch(update)) {
            return { toolName: "web_search" };
        }
        if (isUrlRead(update)) {
            return { toolName: "read_web_page", toolInput: { url: requestedUrl(update.rawInput) } };
        }
        return undefined;
    }

    /**
     * Open a session, signing in first when the server has no saved sign-in and
     * the user is on the add-provider screen to complete it. The server opens
     * the Google sign-in page in a browser on the device running Trilium and
     * answers `authenticate` once the user has finished there; it keeps the
     * sign-in under `GEMINI_HOME`, so later sessions need none.
     */
    protected async createSession(client: AcpClient, params: AcpNewSessionParams, interactive: boolean, timeoutMs: number) {
        let created: Awaited<ReturnType<AcpAgentProvider["createSession"]>>;
        try {
            created = await super.createSession(client, params, interactive, timeoutMs);
        } catch (err) {
            if (!interactive || !isSignInRequired(err)) {
                throw err;
            }
            await client.request("authenticate", { methodId: SIGN_IN_METHOD }, SIGN_IN_TIMEOUT_MS);
            created = await super.createSession(client, params, interactive, timeoutMs);
        }
        if (created.models) {
            recordCatalog(created.models);
        }
        return created;
    }

    protected describeFailure(error: unknown): string {
        const text = describeError(error);
        if (isSignInRequired(error)) {
            return "Google Antigravity is not signed in. Open this provider in the AI settings and go to the model selection, which opens the Google sign-in page in a browser on the device running Trilium.";
        }
        if (/"authenticate" timed out/.test(text)) {
            return "The Google sign-in was not completed in time. Try again, and finish signing in in the browser window that opens on the device running Trilium.";
        }
        if (/ENOENT|spawn/i.test(text)) {
            return `Failed to start Google's Antigravity ACP server: ${text}`;
        }
        return text;
    }
}

/**
 * Approve Trilium's own note tools, and the web search in a chat that allows
 * it; deny everything else.
 *
 * The server asks before every MCP tool call, including those of the note-tools
 * server Trilium hands it. It marks those requests in `toolCall._meta` — the
 * MCP server's name and `is_mcp_tool_call` — which the server sets itself, so
 * the model cannot forge them the way it controls a tool call's title and
 * arguments. Other built-in tools (shell, file edits, URL fetch) carry no such
 * marker and are denied.
 *
 * The web search is recognized by its kind and title together. The server
 * titles it from a template, and the one tool whose title the model writes, the
 * shell, has the kind `execute`.
 */
export function decideAntigravityPermission(
    request: AcpPermissionRequest,
    logLabel: string,
    { webSearch = false }: { webSearch?: boolean } = {}
): AcpPermissionOutcome {
    const toolCall = request.toolCall;
    const meta = toolCall?._meta;
    const mcp = meta?.mcp as { server?: unknown } | undefined;
    const isNoteTool = meta?.is_mcp_tool_call === true && mcp?.server === NOTE_TOOLS_MCP_SERVER_NAME;
    const allowOnce = request.options?.find(o => o.kind === "allow_once");
    if ((isNoteTool || (webSearch && isWebSearch(toolCall))) && allowOnce) {
        return { outcome: { outcome: "selected", optionId: allowOnce.optionId } };
    }
    return denyPermission(request, logLabel);
}

/**
 * The server's catalog, led by the entry that defers to its own default, with
 * each model listed once. The server names an effort level inside the model
 * (`Gemini 3.8 Flash (High)`, `gemini-3.8-flash-high`), so its variants
 * become one entry, `gemini-3.8-flash`, that lists the levels as
 * `reasoningEfforts`; {@link resolveAntigravityModel} picks the variant for a
 * turn. The server's order is kept: it is the picker Antigravity itself
 * shows, newest first.
 */
export function buildAntigravityModelList(remote: AcpSessionModelState): ModelInfo[] {
    const models = groupAntigravityCatalog(remote).map<ModelInfo>(entry => {
        const common = { pricing: { input: 0, output: 0 }, isSubscription: true };
        if (entry.variants.size === 1) {
            const [ [ , modelId ] ] = entry.variants;
            /* v8 ignore next -- groupAntigravityCatalog names every variant it records. */
            return { id: modelId, name: entry.variantNames.get(modelId) ?? modelId, ...common };
        }
        const reasoningEfforts = sortEfforts([ ...entry.variants.keys() ]);
        return { id: entry.id, name: entry.name, ...common, reasoningEfforts, defaultReasoningEffort: defaultEffort(reasoningEfforts) };
    });
    return [ ...AVAILABLE_MODELS, ...models ];
}

/**
 * The real model id for a listed model at an effort level: the variant for
 * that level, the nearest one when the model lacks it (the higher on a tie),
 * or the model's default level without a choice. An id that names no grouped
 * model, such as a variant saved before grouping, is returned as it is.
 */
export function resolveAntigravityModel(model: string, effort: LlmReasoningEffort | undefined, variants: Map<string, Map<LlmReasoningEffort, string>>): string {
    const byEffort = variants.get(model);
    if (!byEffort) {
        return model;
    }
    const levels = sortEfforts([ ...byEffort.keys() ]);
    const wanted = LLM_REASONING_EFFORTS.indexOf(effort ?? defaultEffort(levels));
    let chosen = levels[0];
    for (const level of levels) {
        if (Math.abs(LLM_REASONING_EFFORTS.indexOf(level) - wanted) <= Math.abs(LLM_REASONING_EFFORTS.indexOf(chosen) - wanted)) {
            chosen = level;
        }
    }
    /* v8 ignore next -- `chosen` is one of `byEffort`'s own keys. */
    return byEffort.get(chosen) ?? model;
}

/**
 * Whether a built-in tool call only touches the agent's working files: every
 * path it names lies under `<home>/antigravity-acp/brain/<session>/`, where the
 * server keeps the tool descriptions (`mcp/`) and the output of long tool
 * results, such as a fetched page (`.system_generated/`). Anything else in the
 * home, such as the sign-in token, does not qualify.
 */
export function isWorkingFileAccess(update: AcpToolCallUpdate, home: string): boolean {
    if (update._meta && (update._meta as { is_mcp_tool_call?: unknown }).is_mcp_tool_call === true) {
        return false;
    }
    const paths = [
        ...(update.locations ?? []).map(location => location.path),
        ...Object.values(typeof update.rawInput === "object" && update.rawInput !== null ? update.rawInput : {})
    ].filter((value): value is string => typeof value === "string" && path.isAbsolute(value));
    return paths.length > 0 && paths.every(candidate => {
        const segments = path.relative(home, path.resolve(candidate)).split(path.sep);
        return segments[0] === "antigravity-acp" && segments[1] === "brain" && segments.length > 3;
    });
}

/**
 * The environment the server runs in. `GEMINI_HOME` gives it a home of
 * Trilium's own. On Linux, `SSL_CERT_FILE` points it at the system CA bundle
 * when nothing else does: the server's bundled Python looks for one at a fixed
 * path that some distributions (NixOS) lack, and every model request then
 * fails certificate verification.
 */
export function buildAntigravityEnv(
    geminiHome: string,
    platform = process.platform,
    env = process.env,
    fileExists: (file: string) => boolean = existsSync
): Record<string, string> {
    const result: Record<string, string> = { GEMINI_HOME: geminiHome };
    if (platform === "linux" && !env.SSL_CERT_FILE) {
        const bundle = LINUX_CA_BUNDLES.find(candidate => fileExists(candidate));
        if (bundle) {
            result.SSL_CERT_FILE = bundle;
        }
    }
    return result;
}

/**
 * `Gemini 3.8 Flash (High)` → family `Flash`, version `[3, 8]`, model
 * `Gemini 3.8 Flash`, effort `high`; the effort is absent from a name without
 * one. Undefined for any other shape, or an effort label that is not a level.
 */
function parseGeminiModelName(name: string): { family: string; version: number[]; model: string; effort?: LlmReasoningEffort } | undefined {
    const match = /^Gemini (\d+(?:\.\d+)*) (.+?)(?: \(([^)]+)\))?$/.exec(name);
    if (!match) {
        return undefined;
    }
    const effort = match[3] === undefined ? undefined : EFFORT_LABELS[match[3].toLowerCase()];
    if (match[3] !== undefined && !effort) {
        return undefined;
    }
    return { family: match[2], version: match[1].split(".").map(Number), model: `Gemini ${match[1]} ${match[2]}`, effort };
}

/** The effort levels Antigravity names in its models, by their label. */
const EFFORT_LABELS: Record<string, LlmReasoningEffort | undefined> = { low: "low", medium: "medium", high: "high" };

/**
 * The catalog's models, variants of one model gathered into one entry. A model
 * whose name carries no level is an entry with a single variant.
 */
function groupAntigravityCatalog(remote: AcpSessionModelState) {
    const entries = new Map<string, { id: string; name: string; variants: Map<LlmReasoningEffort, string>; variantNames: Map<string, string> }>();
    for (const model of remote.availableModels ?? []) {
        if (!model.modelId || model.modelId === DEFAULT_MODEL_ID) {
            continue;
        }
        const name = model.name ?? model.modelId;
        const parsed = parseGeminiModelName(name);
        const id = parsed?.effort ? parsed.model.toLowerCase().replace(/\s+/g, "-") : model.modelId;
        let entry = entries.get(id);
        if (!entry) {
            entry = { id, name: parsed?.effort ? parsed.model : name, variants: new Map(), variantNames: new Map() };
            entries.set(id, entry);
        }
        // A model without a level still needs a key; "high" is never read back for it.
        entry.variants.set(parsed?.effort ?? "high", model.modelId);
        entry.variantNames.set(model.modelId, name);
    }
    return [ ...entries.values() ];
}

/** Remember the variants and the title model of a catalog the server reported. */
function recordCatalog(remote: AcpSessionModelState) {
    const variants = new Map<string, Map<LlmReasoningEffort, string>>();
    for (const entry of groupAntigravityCatalog(remote)) {
        if (entry.variants.size > 1) {
            variants.set(entry.id, entry.variants);
        }
    }
    const titleModel = (remote.availableModels ?? []).find(m => /flash-low$/.test(m.modelId))?.modelId;
    catalog = { variants, titleModel };
}

function sortEfforts(efforts: LlmReasoningEffort[]): LlmReasoningEffort[] {
    return [ ...efforts ].sort((a, b) => LLM_REASONING_EFFORTS.indexOf(a) - LLM_REASONING_EFFORTS.indexOf(b));
}

/** High where the model has it, as the server itself defaults to a High variant; the strongest otherwise. */
function defaultEffort(sortedEfforts: LlmReasoningEffort[]): LlmReasoningEffort {
    return sortedEfforts.includes("high") ? "high" : sortedEfforts[sortedEfforts.length - 1];
}

function compareVersions(a: number[], b: number[]): number {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const difference = (a[i] ?? 0) - (b[i] ?? 0);
        if (difference !== 0) {
            return difference;
        }
    }
    return 0;
}

/** The server's home, `GEMINI_HOME`: its sign-in, sessions and tool descriptions. */
function agentHome(): string {
    return path.resolve(dataDirs.TRILIUM_DATA_DIR, "antigravity-agent", "home");
}

/**
 * Approve reading a web page once when its URL leads to the public internet
 * (see {@link isPublicHttpUrl}), and deny it otherwise. The caller has checked
 * that the chat allows web access and that the request is the page read.
 */
export async function decideAntigravityUrlRead(request: AcpPermissionRequest, logLabel: string): Promise<AcpPermissionOutcome> {
    const url = requestedUrl(request.toolCall?.rawInput);
    const allowOnce = request.options?.find(o => o.kind === "allow_once");
    if (url && allowOnce && await isPublicHttpUrl(url)) {
        return { outcome: { outcome: "selected", optionId: allowOnce.optionId } };
    }
    return denyPermission(request, logLabel);
}

/**
 * Whether a tool call or permission request is the server's page read: the
 * kind `fetch` with the title the server gives it. The model writes only the
 * URL, which travels in the input.
 */
function isUrlRead(toolCall: { kind?: string; title?: string } | undefined): boolean {
    return toolCall?.kind === "fetch" && /^Run(?:ning)? read_url_content\??$/.test(toolCall.title ?? "");
}

/** The URL a page read names, in its `Url` argument. */
function requestedUrl(rawInput: unknown): string | undefined {
    const url = (rawInput as { Url?: unknown } | null | undefined)?.Url;
    return typeof url === "string" ? url : undefined;
}

/**
 * Whether a tool call or permission request is the server's web search: the
 * kind `search` with the title the server gives it, `Run search_web?` while it
 * waits for permission and `Running search_web` once it runs.
 */
function isWebSearch(toolCall: { kind?: string; title?: string } | undefined): boolean {
    return toolCall?.kind === "search" && /^Run(?:ning)? search_web\??$/.test(toolCall.title ?? "");
}

function isSignInRequired(error: unknown): boolean {
    return error instanceof AcpError && error.code === -32000 && /authentication required/i.test(error.message);
}
