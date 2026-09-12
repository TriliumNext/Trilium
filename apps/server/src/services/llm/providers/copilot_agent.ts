/**
 * Copilot Agent provider — drives the GitHub Copilot CLI in ACP mode
 * (`copilot --acp`, the Agent Client Protocol) as a subprocess. This lets
 * users with a GitHub Copilot subscription (Pro/Pro+/Business/Enterprise) use
 * the in-app chat without an API key: authentication is owned entirely by the
 * CLI (`copilot login`, or credentials shared with any other Copilot editor
 * integration on the machine), and usage is billed to the subscription.
 *
 * Bring-your-own-binary: nothing is bundled — the provider spawns the user's
 * own installed `copilot` CLI (see copilot_binary.ts).
 *
 * Like the Claude Agent provider, the CLI runs its own agentic loop and owns
 * conversation history in host-side sessions. This provider therefore:
 *   - implements `chatChunks()` (chunk-native streaming) instead of `chat()`,
 *   - maps chat notes to ACP sessions and sends only the newest user message
 *     when the transcript still matches (`session/load`), falling back to
 *     seeding a fresh session from the transcript when it diverged or was lost,
 *   - exposes note tools by pointing the agent at a private loopback MCP
 *     endpoint (see copilot_mcp_endpoint.ts), and denies every built-in
 *     file/shell tool through the ACP permission callback.
 */

import type { LlmMessage, LlmMessagePart, LlmStreamChunk } from "@triliumnext/commons";
import { getLog } from "@triliumnext/core";
import { resolveAttachmentPart } from "@triliumnext/core/src/services/llm/attachment_content.js";
import { buildNoteHint } from "@triliumnext/core/src/services/llm/note_hint.js";
import { buildSystemPrompt } from "@triliumnext/core/src/services/llm/system_prompt.js";
import type { LlmProvider, LlmProviderConfig, ModelInfo, ModelPricing, StreamResult } from "@triliumnext/core/src/services/llm/types.js";
import { encodeBase64 } from "@triliumnext/core/src/services/utils/binary.js";
import fs from "fs";
import path from "path";

import dataDirs from "../../data_dir.js";
import { AcpClient, AcpError } from "./acp_client.js";
import { needsShell, resolveCopilotBinaryPath } from "./copilot_binary.js";
import { getCopilotMcpEndpointUrl } from "./copilot_mcp_endpoint.js";
import { attachmentPlaceholder, buildHistoryReplay, hashTranscript } from "./transcript.js";

/** Image media types the ACP prompt accepts as a base64 image block. */
const SUPPORTED_IMAGE_MIMES = new Set<string>(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/**
 * The catalog available without asking the CLI anything.
 *
 * {@link CopilotAgentProvider.listModels} reads the real line-up off
 * `session/new`, but that costs a subprocess and a round-trip, and the
 * {@link LlmProvider} interface also needs a *synchronous* answer: the chat
 * resolves its default model and display name through `getAvailableModels()` on
 * every turn, which cannot wait on a spawn. This is that answer, and the
 * fallback when the probe can't run at all (CLI missing, logged out).
 *
 * So it holds only the two ids the provider itself names — `auto`, the default a
 * chat falls back to when it has none stored, and {@link TITLE_MODEL} — rather
 * than a mirror of the picker. Anything more would be a guess about someone
 * else's account, stale the moment GitHub changes the line-up, and the picker
 * never shows this list when the CLI can be reached. Pricing is zero throughout
 * because the subscription covers it.
 */
const AVAILABLE_MODELS: ModelInfo[] = [
    { id: "auto", name: "Auto", pricing: { input: 0, output: 0 }, isDefault: true, isSubscription: true },
    { id: "gpt-5-mini", name: "GPT-5 mini", pricing: { input: 0, output: 0 }, isSubscription: true }
];

/** Free-tier model used for the cheap title turn. */
const TITLE_MODEL = "gpt-5-mini";

/**
 * How long a probed catalog is reused. Matches the Claude Agent provider: the
 * line-up changes with GitHub's releases and the user's plan, neither of which
 * moves within an editing session, and the probe costs a CLI spawn.
 */
const MODEL_CATALOG_TTL_MS = 60 * 60 * 1000;

/** Upper bound on the catalog probe — a spawn plus one round-trip, no prompt. */
const MODEL_PROBE_TIMEOUT_MS = 60_000;

/**
 * Premium-request multipliers from the last successful probe, by model id.
 *
 * Kept beside the catalog rather than on {@link ModelInfo}, which has no field
 * for it: the multiplier is a Copilot-plan quota rate, not a price, and is only
 * comparable against other Copilot models. {@link
 * CopilotAgentProvider.recommendedModelIds} is its one consumer.
 */
const premiumMultiplierById = new Map<string, number>();

let modelCatalogCache: { models: ModelInfo[]; fetchedAt: number } | undefined;
let modelCatalogInFlight: Promise<ModelInfo[]> | undefined;

/**
 * CLI arguments passed alongside `--acp`. These form the *primary* security
 * boundary; the permission callback (see {@link decidePermission}) is a
 * fail-closed backstop.
 *   - `--allow-tool=trilium` auto-approves every tool from our "trilium" MCP
 *     server, so note tools run without a permission round-trip (and without
 *     relying on us recognizing them — the CLI presents MCP tool calls with
 *     opaque IDs and human-friendly titles that don't embed the server name).
 *   - `--deny-tool` on each built-in file/shell/network tool guarantees they
 *     can never run even if a future CLI build changed the permission-prompt
 *     defaults. The agent's only capability surface is Trilium's note tools.
 *   - `--no-custom-instructions` keeps any AGENTS.md/copilot-instructions.md in
 *     an enclosing directory out of the notes chat.
 *   - `--no-auto-update` keeps the pinned binary from mutating under us.
 */
const COPILOT_ACP_ARGS = [
    "--allow-tool=trilium",
    ...["shell", "powershell", "write", "edit", "create", "view", "glob", "grep", "task", "web_fetch"].map(t => `--deny-tool=${t}`),
    "--no-custom-instructions",
    "--no-auto-update"
];

const INIT_TIMEOUT_MS = 30_000;
const SESSION_TIMEOUT_MS = 120_000;
/** Upper bound for a whole prompt turn (agentic loops included). */
const PROMPT_TIMEOUT_MS = 15 * 60_000;

/** Session mappings kept per chat note; bounded to avoid unbounded growth. */
const MAX_TRACKED_SESSIONS = 200;

interface SessionEntry {
    sessionId: string;
    /** Hash of the transcript as it stood when the session last responded. */
    transcriptHash: string;
}

/**
 * chatNoteId → ACP session. In-memory only: the CLI's sessions live on this
 * host, so the mapping must not sync across devices. Losing it (e.g. on
 * restart) is fine — the provider reseeds a fresh session from the transcript
 * the client sends.
 */
const sessionsByChatNote = new Map<string, SessionEntry>();

function rememberSession(chatNoteId: string, entry: SessionEntry) {
    // Refresh insertion order so the oldest mapping is evicted first.
    sessionsByChatNote.delete(chatNoteId);
    sessionsByChatNote.set(chatNoteId, entry);
    if (sessionsByChatNote.size > MAX_TRACKED_SESSIONS) {
        for (const oldest of sessionsByChatNote.keys()) {
            sessionsByChatNote.delete(oldest);
            break;
        }
    }
}

/** ACP content block (subset used by this provider). */
type AcpContentBlock =
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string };

interface AcpSessionUpdate {
    sessionId: string;
    update?: {
        sessionUpdate: string;
        content?: AcpContentBlock | { type: string; content?: AcpContentBlock; [key: string]: unknown };
        toolCallId?: string;
        title?: string;
        status?: string;
        rawInput?: unknown;
        rawOutput?: unknown;
        [key: string]: unknown;
    };
}

interface AcpPermissionRequest {
    sessionId?: string;
    toolCall?: { toolCallId?: string; title?: string; kind?: string; rawInput?: unknown };
    options?: { optionId: string; name?: string; kind?: string }[];
}

/** The `models` block of a `session/new` response — ACP's model-selection state. */
interface AcpSessionModelState {
    availableModels?: AcpModel[];
    /** The model the session starts on. Not used: Trilium picks per chat. */
    currentModelId?: string;
}

interface AcpModel {
    modelId: string;
    name?: string;
    description?: string;
    /**
     * Vendor extensions ACP itself doesn't define. Copilot puts its quota
     * accounting here: `copilotUsage` is the premium-request multiplier as a
     * display string ("0.33x", "15x"), and `copilotEnablement` marks models the
     * account or its policy can't actually use.
     */
    _meta?: { copilotUsage?: string; copilotEnablement?: string };
}

export class CopilotAgentProvider implements LlmProvider {
    name = "copilot-agent";

    /**
     * Free at the point of use for every model, discovered ones included: the
     * subscription covers the whole catalog, so an id this build has never heard
     * of still costs nothing per token. Only ids that aren't Copilot's at all
     * come back unpriced.
     */
    getModelPricing(model: string): ModelPricing | undefined {
        const known = modelCatalogCache?.models ?? AVAILABLE_MODELS;
        return known.some(m => m.id === model) ? { input: 0, output: 0 } : undefined;
    }

    getAvailableModels(): ModelInfo[] {
        return AVAILABLE_MODELS;
    }

    /**
     * The models this account may use, as the installed CLI reports them.
     *
     * There is no `/models` endpoint to call: the catalog arrives on the
     * `session/new` response, which reflects the CLI's version and the plan the
     * user is signed in under — a Pro account and a Business one are offered
     * different line-ups, and neither matches a list committed here months
     * earlier. Opening a session sends no prompt, so the probe spends no premium
     * requests.
     *
     * Cached for {@link MODEL_CATALOG_TTL_MS}, with concurrent callers sharing
     * one probe. A *failure* propagates rather than falling back to
     * {@link AVAILABLE_MODELS}, so the add/edit-provider screen can say the CLI
     * is missing or logged out instead of showing three models that would fail
     * on first use.
     */
    async listModels(): Promise<ModelInfo[]> {
        if (modelCatalogCache && Date.now() - modelCatalogCache.fetchedAt < MODEL_CATALOG_TTL_MS) {
            return modelCatalogCache.models;
        }
        if (!modelCatalogInFlight) {
            modelCatalogInFlight = this.probeModelCatalog().finally(() => {
                modelCatalogInFlight = undefined;
            });
        }
        return modelCatalogInFlight;
    }

    /**
     * Open a session purely to read the catalog off its response, then tear the
     * CLI down. No `session/prompt` is ever sent, and note tools are left out of
     * the session — nothing is asked of the agent, so it needs no capabilities.
     */
    private async probeModelCatalog(): Promise<ModelInfo[]> {
        let client: AcpClient | undefined;
        try {
            client = await this.startClient(() => {});
            const created = await client.request<{ models?: AcpSessionModelState }>(
                "session/new",
                { cwd: getAgentCwd(), mcpServers: [] },
                MODEL_PROBE_TIMEOUT_MS
            );
            const models = buildCopilotModelList(created.models?.availableModels ?? [], AVAILABLE_MODELS);
            modelCatalogCache = { models, fetchedAt: Date.now() };
            return models;
        } catch (err) {
            // Name the reason (binary missing, not logged in, timeout) so the
            // provider screen can show something the user can act on.
            throw new Error(describeError(err));
        } finally {
            client?.dispose();
        }
    }

    /**
     * Everything except the models that bill at more than one premium request
     * per turn.
     *
     * Copilot meters a monthly allowance of premium requests, not tokens, and
     * the multipliers span two orders of magnitude — a turn on Opus 5 (15x)
     * spends what fifteen Sonnet turns would. Pre-selecting those would let a
     * user empty the month's allowance from a picker that gave no hint of it, so
     * the expensive models stay one deliberate tick away while the 1x-and-under
     * bulk of the catalog is on by default.
     *
     * Anything whose rate the CLI didn't report — `auto`, or a model listed by a
     * future CLI that drops the metadata — is recommended: the flag only seeds a
     * selection the user can change, so failing open costs less than hiding a
     * model that may well be the cheap one.
     */
    recommendedModelIds(models: ModelInfo[]): Set<string> {
        return new Set(models.filter(m => (premiumMultiplierById.get(m.id) ?? 0) <= 1).map(m => m.id));
    }

    /** Not used — the route prefers {@link chatChunks} when implemented. */
    chat(): StreamResult {
        throw new Error("The Copilot Agent provider streams chunks directly; use chatChunks().");
    }

    async *chatChunks(messages: LlmMessage[], config: LlmProviderConfig, signal?: AbortSignal): AsyncIterable<LlmStreamChunk> {
        if (signal?.aborted) {
            // The client is gone — don't spawn an agent subprocess nobody
            // will read from.
            return;
        }

        const conversation = messages.filter(m => m.role !== "system");
        const lastMessage = conversation[conversation.length - 1];
        if (!lastMessage || lastMessage.role !== "user") {
            yield { type: "error", error: "The last message must be a user message." };
            return;
        }

        const history = conversation.slice(0, -1);
        const historyHash = hashTranscript(history);
        const stored = config.chatNoteId ? sessionsByChatNote.get(config.chatNoteId) : undefined;
        const resume = stored && stored.transcriptHash === historyHash ? stored.sessionId : undefined;

        // A config that does not mention the note tools does not get them, as `base_provider` reads
        // it and as the AI-SDK providers therefore behave — what a request leaves unsaid has to
        // mean the same thing whichever provider answers it.
        const noteToolsEnabled = !!config.enableNoteTools;
        const model = config.model || "auto";

        // Queue between the ACP notification callback and this generator: the
        // callback is synchronous while consumption is async, so updates are
        // buffered and drained in arrival order.
        const chunkQueue: LlmStreamChunk[] = [];
        let wakeup: (() => void) | undefined;
        const emit = (chunk: LlmStreamChunk) => {
            chunkQueue.push(chunk);
            wakeup?.();
        };

        const collector = createUpdateCollector(emit);
        let client: AcpClient | undefined;
        let sessionId: string | undefined;
        let assistantText = "";

        try {
            client = await this.startClient(collector.onNotification);

            const mcpServers = noteToolsEnabled ? await buildMcpServersConfig() : [];

            // Resume the existing session only when the transcript still
            // matches what it last saw; any divergence (edited history, lost
            // mapping, server restart) reseeds a fresh session. session/load
            // replays the session's history as notifications — the collector
            // suppresses everything until the load completes.
            if (resume) {
                collector.muted = true;
                try {
                    await client.request("session/load", { sessionId: resume, cwd: getAgentCwd(), mcpServers }, SESSION_TIMEOUT_MS);
                    sessionId = resume;
                } catch (err) {
                    getLog().info(`Copilot Agent provider: session/load failed (${describeError(err)}); reseeding a fresh session.`);
                } finally {
                    collector.muted = false;
                }
            }

            if (!sessionId) {
                const created = await client.request<{ sessionId: string }>(
                    "session/new",
                    { cwd: getAgentCwd(), mcpServers },
                    SESSION_TIMEOUT_MS
                );
                sessionId = created.sessionId;
            }
            collector.sessionId = sessionId;

            if (model !== "auto") {
                // Model selection is an optional ACP capability — degrade to the
                // agent's default rather than failing the turn.
                try {
                    await client.request("session/set_model", { sessionId, modelId: model }, INIT_TIMEOUT_MS);
                } catch (err) {
                    getLog().error(`Copilot Agent provider: failed to select model "${model}" (${describeError(err)}); continuing with the agent's default.`);
                }
            }

            // Text that precedes this turn's own content: the system
            // instructions and replayed transcript when the session is fresh,
            // then the volatile current-note metadata hint (kept out of the
            // transcript hash so a later turn can still resume).
            const isFreshSession = sessionId !== resume;
            const hasAttachments = Array.isArray(lastMessage.content) && lastMessage.content.some(p => p.type !== "text");
            const noteHint = config.contextNoteId ? buildNoteHint(config.contextNoteId, hasAttachments) : null;
            const prefix = [
                isFreshSession ? wrapSystemInstructions(this.composeSystemPrompt(messages, { ...config, enableNoteTools: noteToolsEnabled })) : null,
                (isFreshSession && history.length > 0) ? buildHistoryReplay(history) : null,
                noteHint
            ].filter((s): s is string => Boolean(s)).join("\n\n");

            const onAbort = () => {
                if (sessionId) {
                    client?.notify("session/cancel", { sessionId });
                }
                // Wake the drain loop below: an agent slow to honour the cancel
                // (or ignoring it) would otherwise keep this generator — and its
                // subprocess — suspended until PROMPT_TIMEOUT_MS elapses.
                wakeup?.();
            };
            signal?.addEventListener("abort", onAbort, { once: true });

            try {
                const promptPromise = client.request<{ stopReason?: string }>(
                    "session/prompt",
                    { sessionId, prompt: buildPromptBlocks(lastMessage.content, prefix) },
                    PROMPT_TIMEOUT_MS
                );

                // Drain updates as they arrive until the prompt resolves (and
                // then whatever is still queued).
                let result: { stopReason?: string } | undefined;
                let promptError: unknown;
                const done = promptPromise
                    .then(r => { result = r; })
                    .catch(err => { promptError = err; })
                    .finally(() => wakeup?.());

                let finished = false;
                void done.then(() => { finished = true; wakeup?.(); });
                // On abort, drain what already arrived and stop — nobody is
                // reading past this point, and `finally` disposes the client.
                while ((!finished && !signal?.aborted) || chunkQueue.length > 0) {
                    if (chunkQueue.length === 0) {
                        await new Promise<void>(resolve => { wakeup = resolve; });
                        wakeup = undefined;
                        continue;
                    }
                    const chunk = chunkQueue.shift();
                    if (chunk) {
                        if (chunk.type === "text") {
                            assistantText += chunk.content;
                        }
                        yield chunk;
                    }
                }
                if (promptError) {
                    throw promptError;
                }

                const stopReason = result?.stopReason ?? "end_turn";
                if (stopReason !== "end_turn" && stopReason !== "cancelled") {
                    yield { type: "error", error: describeStopReason(stopReason) };
                }
            } finally {
                signal?.removeEventListener("abort", onAbort);
            }

            // An aborted turn stops draining before the agent settles, so the
            // session's real history is unknown — recording a hash here would
            // let a later turn resume a session that diverged from the
            // transcript. Forgetting it just reseeds a fresh one.
            if (config.chatNoteId && sessionId && !signal?.aborted) {
                rememberSession(config.chatNoteId, {
                    sessionId,
                    transcriptHash: hashTranscript([
                        ...conversation,
                        { role: "assistant", content: assistantText }
                    ])
                });
            }

            yield { type: "done" };
        } catch (error) {
            yield { type: "error", error: describeCopilotError(error) };
        } finally {
            client?.dispose();
        }
    }

    async generateTitle(firstMessage: string): Promise<string> {
        let client: AcpClient | undefined;
        try {
            let title = "";
            client = await this.startClient((method, params) => {
                if (method !== "session/update") {
                    return;
                }
                const update = (params as AcpSessionUpdate).update;
                if (update?.sessionUpdate === "agent_message_chunk" && update.content && "text" in update.content && update.content.type === "text") {
                    title += update.content.text;
                }
            });

            const { sessionId } = await client.request<{ sessionId: string }>(
                "session/new",
                { cwd: getAgentCwd(), mcpServers: [] },
                SESSION_TIMEOUT_MS
            );
            try {
                await client.request("session/set_model", { sessionId, modelId: TITLE_MODEL }, INIT_TIMEOUT_MS);
            } catch {
                // Title generation works on any model; ignore selection failures.
            }
            await client.request(
                "session/prompt",
                {
                    sessionId,
                    prompt: [{
                        type: "text",
                        text: `Generate a short title (at most 5 words) summarizing this chat message. Reply with only the title, no quotes or punctuation around it:\n\n${firstMessage.substring(0, 500)}`
                    }]
                },
                SESSION_TIMEOUT_MS
            );
            return title.trim().replace(/^["']|["']$/g, "").substring(0, 100);
        } catch (error) {
            getLog().error(`Copilot Agent title generation failed: ${describeCopilotError(error)}`);
            return "";
        } finally {
            client?.dispose();
        }
    }

    /** Spawn `copilot --acp` and run the ACP initialize handshake. */
    private async startClient(onNotification: (method: string, params: unknown) => void): Promise<AcpClient> {
        const binary = await resolveCopilotBinaryPath();
        const client = AcpClient.start(binary, {
            cwd: getAgentCwd(),
            shell: needsShell(binary),
            args: COPILOT_ACP_ARGS,
            onNotification,
            onAgentRequest: handleAgentRequest
        });
        try {
            await client.request(
                "initialize",
                {
                    protocolVersion: 1,
                    clientInfo: { name: "trilium-notes", version: "1.0" },
                    // No fs capabilities: the agent must never touch the host
                    // filesystem — notes are its only data surface.
                    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } }
                },
                INIT_TIMEOUT_MS
            );
        } catch (err) {
            client.dispose();
            throw err;
        }
        return client;
    }

    /**
     * Build the same Trilium system prompt the other providers use. ACP has no
     * system-prompt parameter, so it is delivered as a `<system_instructions>`
     * block leading the first prompt of each session.
     */
    private composeSystemPrompt(messages: LlmMessage[], config: LlmProviderConfig): string {
        // buildSystemPrompt only returns undefined in its own documented-unreachable
        // no-parts case (the markdown hints are always appended).
        /* v8 ignore next */
        return buildSystemPrompt(messages, config) ?? "";
    }
}

/**
 * Turn the CLI's reported catalog into Trilium's model list, recording each
 * model's premium-request multiplier on the way through.
 *
 * The CLI's order is kept as-is rather than re-sorted or filed behind the
 * curated entries: unlike an HTTP `/models` endpoint, which dumps every id a
 * vendor has ever shipped, this list *is* the picker GitHub shows in the
 * terminal — already chosen and already ordered for a human. The curated list
 * contributes only a display name for anything the CLI leaves unnamed.
 *
 * Models the CLI marks as not enabled are dropped: they appear so the terminal
 * picker can grey them out with a reason, which a checkbox list has nowhere to
 * put, and selecting one would fail at the first turn.
 */
export function buildCopilotModelList(remote: AcpModel[], curated: ModelInfo[]): ModelInfo[] {
    const curatedById = new Map(curated.map(m => [m.id, m]));
    premiumMultiplierById.clear();

    const models = remote
        .filter(m => m.modelId && (m._meta?.copilotEnablement ?? "enabled") === "enabled")
        .map<ModelInfo>(m => {
            const multiplier = parsePremiumMultiplier(m._meta?.copilotUsage);
            if (multiplier !== undefined) {
                premiumMultiplierById.set(m.modelId, multiplier);
            }
            return {
                id: m.modelId,
                name: m.name ?? curatedById.get(m.modelId)?.name ?? m.modelId,
                // Every model on a Copilot plan is covered by the subscription;
                // the picker says so instead of showing a per-token price.
                pricing: { input: 0, output: 0 },
                isSubscription: true
            };
        });

    // Nothing usable came back — an account with no model entitlements at all,
    // or a CLI that stopped reporting them. Fall back rather than hand the
    // picker an empty list it would render as "no models".
    if (models.length === 0) {
        return curated;
    }

    // `find(m => m.isDefault)` is how the chat resolves an unset model, so the
    // list must always carry one. Prefer the curated default (`auto`) when the
    // account still offers it; otherwise the first model the CLI listed, which
    // is the one its own picker leads with.
    const preferred = models.find(m => curatedById.get(m.id)?.isDefault) ?? models[0];
    return models.map(m => (m === preferred ? { ...m, isDefault: true } : m));
}

/** `"0.33x"` → `0.33`. Undefined for a missing or unparseable rate. */
function parsePremiumMultiplier(usage: string | undefined): number | undefined {
    if (!usage) {
        return undefined;
    }
    const parsed = Number.parseFloat(usage);
    return Number.isFinite(parsed) ? parsed : undefined;
}

/** For tests: forget the probed catalog so the next call re-probes. */
export function resetModelCatalogCacheForTests(): void {
    modelCatalogCache = undefined;
    modelCatalogInFlight = undefined;
    premiumMultiplierById.clear();
}

/** The MCP server list for `session/new`/`session/load`, pointing at the private loopback endpoint. */
async function buildMcpServersConfig(): Promise<{ name: string; type: "http"; url: string; headers: never[] }[]> {
    const url = await getCopilotMcpEndpointUrl();
    return [{ name: "trilium", type: "http", url, headers: [] }];
}

/**
 * Directory the agent subprocess runs in. The CLI keys its session storage and
 * project-level config (custom instructions, trusted-folder state) by cwd, so
 * a stable, dedicated directory keeps Trilium's sessions grouped and away from
 * any real project. The `.git` marker makes it its own project root so an
 * enclosing repository's agent config (AGENTS.md, .github/copilot-instructions.md)
 * is never inherited — the dev-run data dir sits inside the Trilium repo.
 */
let agentCwd: string | undefined;
function getAgentCwd(): string {
    if (!agentCwd) {
        // Resolve to an absolute path — TRILIUM_DATA_DIR may be relative (dev
        // runs use TRILIUM_DATA_DIR=data) and a relative spawn cwd would move
        // with the server process's own cwd.
        agentCwd = path.resolve(dataDirs.TRILIUM_DATA_DIR, "copilot-agent");
        fs.mkdirSync(agentCwd, { recursive: true });

        const gitMarker = path.join(agentCwd, ".git");
        if (!fs.existsSync(gitMarker)) {
            fs.mkdirSync(path.join(gitMarker, "objects"), { recursive: true });
            fs.mkdirSync(path.join(gitMarker, "refs"), { recursive: true });
            fs.writeFileSync(path.join(gitMarker, "HEAD"), "ref: refs/heads/main\n");
        }
    }
    return agentCwd;
}

/** For tests: forget the initialized agent cwd so the next call re-runs setup. */
export function resetAgentCwdForTests(): void {
    agentCwd = undefined;
}

/**
 * Handle agent→client requests. Only the permission callback is supported;
 * everything else (fs, terminal) was never advertised and is refused.
 */
function handleAgentRequest(method: string, params: unknown): unknown {
    if (method === "session/request_permission") {
        return decidePermission(params as AcpPermissionRequest);
    }
    throw new Error(`Trilium does not support "${method}".`);
}

/**
 * Permission policy — fail closed. Trilium's note tools are pre-approved at the
 * CLI level (`--allow-tool=trilium`, see {@link COPILOT_ACP_ARGS}), so they run
 * without ever reaching this callback. Anything that *does* reach here is, by
 * definition, a tool we did not allow — a built-in file/shell/network tool — so
 * it is denied.
 *
 * This deliberately does NOT try to recognize note tools and allow them: the
 * CLI presents tool calls with opaque IDs and human-friendly titles that don't
 * embed the MCP server name, so any name-based allow-list would be guesswork.
 * Denying here means the worst case is a note tool failing to run (fail-safe),
 * never a shell command executing on the server host (fail-open).
 */
export function decidePermission(request: AcpPermissionRequest): { outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" } } {
    getLog().info(`Copilot Agent provider: denied unapproved tool call "${request.toolCall?.title ?? "unknown"}" (kind: ${request.toolCall?.kind ?? "?"}).`);

    const options = request.options ?? [];
    // Prefer a persistent "reject always" so a retrying agent stops re-asking;
    // fall back to a one-shot reject, then to cancelling the turn.
    const rejectOption = options.find(o => o.kind === "reject_always") ?? options.find(o => o.kind === "reject_once");
    if (rejectOption) {
        return { outcome: { outcome: "selected", optionId: rejectOption.optionId } };
    }
    return { outcome: { outcome: "cancelled" } };
}

/**
 * Create the session/update collector: maps ACP updates to LlmStreamChunks and
 * pushes them through `emit`. `muted` suppresses the replay flood during
 * session/load; `sessionId` filters stray updates from other sessions.
 */
function createUpdateCollector(emit: (chunk: LlmStreamChunk) => void) {
    // toolCallId → display name, for labelling results; also the guard that
    // only this turn's tool calls produce result chunks.
    const toolNamesById = new Map<string, string>();

    const collector = {
        muted: false,
        sessionId: undefined as string | undefined,
        onNotification(method: string, params: unknown): void {
            if (method !== "session/update" || collector.muted) {
                return;
            }
            const { sessionId, update } = params as AcpSessionUpdate;
            if (!update || (collector.sessionId && sessionId !== collector.sessionId)) {
                return;
            }

            switch (update.sessionUpdate) {
                case "agent_message_chunk": {
                    const text = extractText(update.content);
                    if (text) {
                        emit({ type: "text", content: text });
                    }
                    break;
                }
                case "agent_thought_chunk": {
                    const text = extractText(update.content);
                    if (text) {
                        emit({ type: "thinking", content: text });
                    }
                    break;
                }
                case "tool_call": {
                    if (!update.toolCallId || toolNamesById.has(update.toolCallId)) {
                        break; // malformed or a re-announcement of a known call
                    }
                    const toolName = update.title || "tool";
                    toolNamesById.set(update.toolCallId, toolName);
                    emit({
                        type: "tool_use",
                        toolCallId: update.toolCallId,
                        toolName,
                        toolInput: (update.rawInput ?? {}) as Record<string, unknown>
                    });
                    break;
                }
                case "tool_call_update": {
                    const toolCallId = update.toolCallId;
                    const toolName = toolCallId ? toolNamesById.get(toolCallId) : undefined;
                    if (!toolCallId || toolName === undefined) {
                        break; // not a call announced this turn
                    }
                    if (update.status === "completed" || update.status === "failed") {
                        emit({
                            type: "tool_result",
                            toolCallId,
                            toolName,
                            result: flattenToolContent(update.content, update.rawOutput),
                            isError: update.status === "failed"
                        });
                        toolNamesById.delete(toolCallId);
                    }
                    break;
                }
                default:
                    // plan / available_commands_update / config options — not
                    // surfaced in the chat.
                    break;
            }
        }
    };
    return collector;
}

/** Pull the text out of an update's content block (nested for tool contents). */
function extractText(content: unknown): string {
    if (!content || typeof content !== "object") {
        return "";
    }
    const block = content as { type?: string; text?: unknown };
    return block.type === "text" && typeof block.text === "string" ? block.text : "";
}

/** Flatten a tool_call_update's content/rawOutput into the result string shown in the chat. */
function flattenToolContent(content: unknown, rawOutput: unknown): string {
    if (Array.isArray(content)) {
        const texts = content
            .map(item => {
                if (!item || typeof item !== "object") {
                    return "";
                }
                // ACP wraps each block ({ type: "content", content: … }); some
                // agents pass the MCP result's blocks straight through instead.
                return "content" in item
                    ? extractText((item as { content?: AcpContentBlock }).content)
                    : extractText(item);
            })
            .filter(Boolean);
        if (texts.length > 0) {
            return texts.join("\n");
        }
    }
    if (rawOutput !== undefined) {
        return typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput);
    }
    return "";
}

/**
 * Map the current user turn to ACP prompt blocks: real image blocks for
 * natively-supported attachments, text for everything else. `prefix` (system
 * instructions + reseed transcript + note hint) always leads.
 */
function buildPromptBlocks(content: string | LlmMessagePart[], prefix: string): AcpContentBlock[] {
    if (typeof content === "string") {
        const text = prefix ? `${prefix}\n\n${content}` : content;
        return [{ type: "text", text }];
    }

    const blocks: AcpContentBlock[] = [];
    if (prefix) {
        blocks.push({ type: "text", text: prefix });
    }
    for (const part of content) {
        if (part.type === "text") {
            blocks.push({ type: "text", text: part.text });
            continue;
        }
        const resolved = resolveAttachmentPart(part);
        if (resolved?.kind === "image" && SUPPORTED_IMAGE_MIMES.has(resolved.mime)) {
            blocks.push({ type: "image", data: encodeBase64(resolved.bytes), mimeType: resolved.mime });
        } else if (resolved?.kind === "text") {
            // Inlined text attachments (SVG source, text files) travel as text.
            blocks.push({ type: "text", text: resolved.text });
        } else {
            // Unresolved, or a type the ACP prompt can't carry (e.g. PDFs) — a
            // placeholder keeps the turn self-describing.
            blocks.push({ type: "text", text: attachmentPlaceholder(part) });
        }
    }
    return blocks;
}

/** Wrap the Trilium system prompt for delivery inside the first user prompt. */
function wrapSystemInstructions(systemPrompt: string): string | null {
    // buildSystemPrompt appends the Markdown hints unconditionally, so the only
    // caller can never pass an empty string — this is unreachable defence.
    /* v8 ignore next 3 -- composeSystemPrompt never yields an empty prompt */
    if (!systemPrompt) {
        return null;
    }
    return `<system_instructions>\n${systemPrompt}\n</system_instructions>`;
}

function describeStopReason(stopReason: string): string {
    switch (stopReason) {
        case "refusal":
            return "The model declined to continue this conversation.";
        case "max_tokens":
        case "max_turn_requests":
            return `The agent stopped early (${stopReason.replace(/_/g, " ")}). Try a narrower request.`;
        default:
            return `Agent stopped: ${stopReason}`;
    }
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Map failures to actionable messages (auth problems name the fix). */
function describeCopilotError(error: unknown): string {
    const text = describeError(error);
    if (error instanceof AcpError && (error.code === -32000 || /auth|login|subscription/i.test(text))) {
        return "GitHub Copilot CLI is not authenticated. Run `copilot login` on the machine running the Trilium server to sign in with your GitHub Copilot subscription.";
    }
    if (/ENOENT|spawn/i.test(text)) {
        return `Failed to start the GitHub Copilot CLI: ${text}`;
    }
    return text;
}

/** For tests. */
export { buildPromptBlocks, createUpdateCollector };
