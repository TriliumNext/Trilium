/**
 * Shared base for the providers that drive a subscription agent over the Agent
 * Client Protocol (ACP) — GitHub Copilot (`copilot --acp`) and Google
 * Antigravity (`agy_acp_server`). The agent CLI runs as a subprocess, owns the
 * account's authentication, runs its own agentic loop and keeps conversation
 * history in host-side sessions. So every ACP provider:
 *   - implements `chatChunks()` (chunk-native streaming) instead of `chat()`,
 *   - keeps its agent process running between turns (see acp_client_pool.ts),
 *   - maps chat notes to ACP sessions and sends only the newest user message
 *     when the transcript still matches, prompting the session directly while
 *     its process runs and through `session/load` after that, and falls back to
 *     seeding a fresh session from the transcript when it diverged or was lost,
 *   - exposes note tools by pointing the agent at a private loopback MCP
 *     endpoint (see acp_mcp_endpoint.ts), and answers the ACP permission
 *     callback fail-closed.
 *
 * A subclass supplies how to launch its CLI, its model catalog and its
 * permission policy; the protocol handling lives here.
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
import { AcpClient } from "./acp_client.js";
import { AcpClientPool, type AcpLease, type AcpPoolConnection } from "./acp_client_pool.js";
import { getAcpMcpEndpointUrl } from "./acp_mcp_endpoint.js";
import { attachmentPlaceholder, buildHistoryReplay, hashTranscript } from "./transcript.js";

/** How an ACP provider starts its agent subprocess. */
export interface AcpLaunchSpec {
    binary: string;
    args: string[];
    /** Launch through a shell (npm `.cmd` shims on Windows). */
    shell?: boolean;
    /** Variables set on top of the server's own environment. */
    env?: Record<string, string>;
}

/** The ACP permission callback's answer. */
export type AcpPermissionOutcome = { outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" } };

/** How the chat shows a built-in tool call: a name it has a label for, and the input it reads. */
export interface BuiltInToolDisplay {
    toolName: string;
    toolInput?: Record<string, unknown>;
}

export interface AcpPermissionRequest {
    sessionId?: string;
    toolCall?: {
        toolCallId?: string;
        title?: string;
        kind?: string;
        rawInput?: unknown;
        /** Agent-specific metadata, set by the agent itself rather than by the model. */
        _meta?: Record<string, unknown>;
    };
    options?: { optionId: string; name?: string; kind?: string }[];
}

/** The `models` block of a `session/new` response — ACP's model-selection state. */
export interface AcpSessionModelState {
    availableModels?: AcpModel[];
    /** The model the session starts on. */
    currentModelId?: string;
}

export interface AcpModel {
    modelId: string;
    name?: string;
    description?: string;
    /** Vendor extensions ACP itself doesn't define. */
    _meta?: Record<string, unknown>;
}

/** Parameters of `session/new`. */
export interface AcpNewSessionParams {
    cwd: string;
    mcpServers: AcpMcpServer[];
}

type AcpMcpServer = { name: string; type: "http"; url: string; headers: never[] };

/** Image media types the ACP prompt accepts as a base64 image block. */
const SUPPORTED_IMAGE_MIMES = new Set<string>(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/**
 * How long a probed catalog is reused. The line-up changes with the vendor's
 * releases and the user's plan, neither of which moves within an editing
 * session, and the probe costs a CLI spawn.
 */
const MODEL_CATALOG_TTL_MS = 60 * 60 * 1000;

/** Upper bound on the catalog probe — a spawn plus one round-trip, no prompt. */
const MODEL_PROBE_TIMEOUT_MS = 60_000;

export const INIT_TIMEOUT_MS = 30_000;
export const SESSION_TIMEOUT_MS = 120_000;
/** Upper bound for a whole prompt turn (agentic loops included). */
const PROMPT_TIMEOUT_MS = 15 * 60_000;

/** Session mappings kept per chat note; bounded to avoid unbounded growth. */
const MAX_TRACKED_SESSIONS = 200;

/**
 * Titles one session answers before it is replaced. Titles share a session to
 * skip `session/new` (~2.5 s on Antigravity, which also keeps every session on
 * disk); the cap bounds the history each title prompt carries.
 */
export const MAX_TITLES_PER_SESSION = 20;

/** The name the loopback MCP server is registered under in `session/new`. */
export const NOTE_TOOLS_MCP_SERVER_NAME = "trilium";

interface SessionEntry {
    sessionId: string;
    /** Hash of the transcript as it stood when the session last responded. */
    transcriptHash: string;
    /** The {@link AcpLease.generation} of the process that holds the session. */
    generation: number;
    /**
     * Whether the session has the note-tools MCP server. MCP servers are fixed
     * at `session/new`, so a chat whose note access changed needs a new session.
     */
    noteToolsEnabled: boolean;
    /** The model state `session/new` or `session/load` reported, for the chat footer. */
    models?: AcpSessionModelState;
}

/**
 * What an ACP provider keeps between instances. The chat builds a provider per
 * configuration and the add-provider screen builds throwaway ones, but sessions
 * and the probed catalog belong to the agent on this host, so they are kept per
 * provider type rather than per instance.
 */
interface ProviderState {
    /**
     * chatNoteId → ACP session. In-memory only: the CLI's sessions live on this
     * host, so the mapping must not sync across devices. Losing it (e.g. on
     * restart) is fine — the provider reseeds a fresh session from the
     * transcript the client sends.
     */
    sessionsByChatNote: Map<string, SessionEntry>;
    modelCatalogCache?: { models: ModelInfo[]; fetchedAt: number };
    modelCatalogInFlight?: Promise<ModelInfo[]>;
    agentCwd?: string;
    /** The agent process shared by chat turns and titles. */
    pool: AcpClientPool;
    /** The session titles are generated in. */
    titleSession?: TitleSession;
    /** Settles when the title in progress does; a session answers one prompt at a time. */
    titleQueue: Promise<unknown>;
}

interface TitleSession {
    sessionId: string;
    /** The {@link AcpLease.generation} of the process that holds the session. */
    generation: number;
    /** Titles the session has been asked for. */
    titles: number;
}

const stateByProvider = new Map<string, ProviderState>();

/** Clients whose agent advertised `session/close` in its `initialize` response. */
const sessionClosers = new WeakSet<AcpClient>();

/** The part of the `initialize` response Trilium reads. */
interface AcpInitializeResult {
    agentCapabilities?: { sessionCapabilities?: { close?: unknown } };
}

/** For tests: stop every pooled agent and forget every provider's sessions, catalog and agent cwd. */
export function resetAcpAgentStateForTests(): void {
    for (const state of stateByProvider.values()) {
        state.pool.dispose();
    }
    stateByProvider.clear();
}

export abstract class AcpAgentProvider implements LlmProvider {
    abstract name: string;

    /** Prefix for log lines, e.g. "Copilot Agent provider". */
    protected abstract readonly logLabel: string;

    /**
     * The catalog available without asking the CLI anything.
     *
     * {@link listModels} reads the real line-up off `session/new`, but that
     * costs a subprocess and a round-trip, and the {@link LlmProvider} interface
     * also needs a *synchronous* answer: the chat resolves its default model and
     * display name through `getAvailableModels()` on every turn, which cannot
     * wait on a spawn. It holds only the ids the provider itself names, rather
     * than a mirror of a vendor line-up that changes with every release.
     */
    protected abstract readonly fallbackModels: ModelInfo[];

    /** The model id that leaves the agent on its own default, so no `session/set_model` is sent. */
    protected abstract readonly defaultModelId: string;

    /** Directory, relative to the data dir, that the agent runs in. */
    protected abstract readonly agentDirName: string;

    /** How to spawn the agent. Resolving the binary can fail with an actionable message. */
    protected abstract launchSpec(): Promise<AcpLaunchSpec>;

    /** Turn the catalog the agent reported on `session/new` into Trilium's model list. */
    protected abstract buildModelList(remote: AcpSessionModelState): ModelInfo[];

    abstract recommendedModelIds(models: ModelInfo[]): Set<string>;

    /**
     * The id to hand `session/set_model` for the chat's model and settings. A
     * provider whose agent names an effort level inside the model id maps
     * {@link LlmProviderConfig.reasoningEffort} here.
     */
    protected sessionModelId(model: string, _config: LlmProviderConfig): string {
        return model;
    }

    /** The cheap model for the title turn, if the agent offers one. */
    protected abstract titleModelId(): string | undefined;

    /**
     * Permission policy. The default denies every request; a subclass whose
     * agent asks before running Trilium's own note tools approves those.
     * `config` is the chat turn's configuration, and absent outside a chat
     * turn (the model probe, the title).
     */
    protected decidePermission(request: AcpPermissionRequest, _config?: LlmProviderConfig): AcpPermissionOutcome | Promise<AcpPermissionOutcome> {
        return denyPermission(request, this.logLabel);
    }

    /**
     * Whether a tool call is the agent's own bookkeeping rather than work the
     * user asked for, and so stays out of the chat. Display only: the call has
     * already passed the permission policy.
     */
    protected isInternalToolCall(_update: AcpToolCallUpdate): boolean {
        return false;
    }

    /**
     * The chat's name for a built-in tool call it has a label for, such as
     * `web_search`, and optionally its input in the shape the chat reads;
     * undefined shows the call's title. Display only.
     */
    protected describeBuiltInTool(_update: AcpToolCallUpdate): BuiltInToolDisplay | undefined {
        return undefined;
    }

    /** Map a failure to an actionable message; {@link describeError} gives the generic one. */
    protected abstract describeFailure(error: unknown): string;

    /**
     * The name of the model a turn ran on, for the chat footer: the session's
     * own name for `runningModelId`, then the catalog's name for `runningModel`,
     * then `runningModel` itself.
     */
    private describeRunningModel(runningModel: string, runningModelId: string | undefined, sessionModels: AcpSessionModelState | undefined): string {
        const running = runningModelId ? sessionModels?.availableModels?.find(m => m.modelId === runningModelId) : undefined;
        if (running?.name) {
            return running.name;
        }
        const known = this.state().modelCatalogCache?.models ?? this.fallbackModels;
        return known.find(m => m.id === runningModel)?.name ?? runningModel;
    }

    /**
     * Open a session. `interactive` is true only on the add-provider screen,
     * where a subclass can run a sign-in the user is there to complete.
     */
    protected async createSession(client: AcpClient, params: AcpNewSessionParams, _interactive: boolean, timeoutMs: number) {
        return await client.request<{ sessionId: string; models?: AcpSessionModelState }>("session/new", params, timeoutMs);
    }

    /**
     * Free at the point of use for every model, discovered ones included: the
     * subscription covers the whole catalog, so an id this build has never heard
     * of still costs nothing per token. Only ids that aren't the provider's at
     * all come back unpriced.
     */
    getModelPricing(model: string): ModelPricing | undefined {
        const known = this.state().modelCatalogCache?.models ?? this.fallbackModels;
        return known.some(m => m.id === model) ? { input: 0, output: 0 } : undefined;
    }

    getAvailableModels(): ModelInfo[] {
        return this.fallbackModels;
    }

    /**
     * The models this account can use, as the installed CLI reports them.
     *
     * There is no `/models` endpoint to call: the catalog arrives on the
     * `session/new` response, which reflects the CLI's version and the plan the
     * user is signed in under. Opening a session sends no prompt, so the probe
     * spends no quota.
     *
     * Cached for {@link MODEL_CATALOG_TTL_MS}, with concurrent callers sharing
     * one probe. A *failure* propagates rather than falling back to
     * {@link fallbackModels}, so the add/edit-provider screen can say the CLI is
     * missing or signed out instead of showing models that would fail on first
     * use.
     */
    async listModels(): Promise<ModelInfo[]> {
        const state = this.state();
        if (state.modelCatalogCache && Date.now() - state.modelCatalogCache.fetchedAt < MODEL_CATALOG_TTL_MS) {
            return state.modelCatalogCache.models;
        }
        if (!state.modelCatalogInFlight) {
            state.modelCatalogInFlight = this.probeModelCatalog().finally(() => {
                state.modelCatalogInFlight = undefined;
            });
        }
        return state.modelCatalogInFlight;
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
            const created = await this.createSession(client, { cwd: this.agentCwd(), mcpServers: [] }, true, MODEL_PROBE_TIMEOUT_MS);
            const models = this.buildModelList(created.models ?? {});
            this.state().modelCatalogCache = { models, fetchedAt: Date.now() };
            return models;
        } catch (err) {
            // Name the reason (binary missing, not signed in, timeout) so the
            // provider screen can show something the user can act on.
            throw new Error(this.describeFailure(err));
        } finally {
            client?.dispose();
        }
    }

    /** Not used — the route prefers {@link chatChunks} when implemented. */
    chat(): StreamResult {
        throw new Error(`The ${this.logLabel} streams chunks directly; use chatChunks().`);
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

        const sessionsByChatNote = this.state().sessionsByChatNote;
        const history = conversation.slice(0, -1);
        const historyHash = hashTranscript(history);
        const stored = config.chatNoteId ? sessionsByChatNote.get(config.chatNoteId) : undefined;
        const resume = stored && stored.transcriptHash === historyHash ? stored.sessionId : undefined;

        // A config that does not mention the note tools does not get them, as `base_provider` reads
        // it and as the AI-SDK providers therefore behave — what a request leaves unsaid has to
        // mean the same thing whichever provider answers it.
        const noteToolsEnabled = !!config.enableNoteTools;
        const model = config.model || this.defaultModelId;

        // Queue between the ACP notification callback and this generator: the
        // callback is synchronous while consumption is async, so updates are
        // buffered and drained in arrival order.
        const chunkQueue: LlmStreamChunk[] = [];
        let wakeup: (() => void) | undefined;
        const emit = (chunk: LlmStreamChunk) => {
            chunkQueue.push(chunk);
            wakeup?.();
        };

        const collector = createUpdateCollector(emit, update => this.isInternalToolCall(update), update => this.describeBuiltInTool(update));
        const pool = this.state().pool;
        let lease: AcpLease | undefined;
        let attachedSession: string | undefined;
        let assistantText = "";

        try {
            if (!pool.warm) {
                yield { type: "status", status: "starting_agent" };
            }
            const acquired = await pool.acquire(connection => this.connect(connection));
            lease = acquired;
            const client = acquired.client;

            // Resume the mapped session only when the transcript still matches
            // what it last saw and it has the note access this turn asks for;
            // anything else (edited history, lost mapping, toggled note access)
            // reseeds a fresh session.
            const resumable = stored?.noteToolsEnabled === noteToolsEnabled ? resume : undefined;
            let sessionId: string | undefined;
            let sessionModels: AcpSessionModelState | undefined;
            const isLive = resumable !== undefined && stored?.generation === acquired.generation;
            // Only opening or loading a session names its MCP servers.
            const mcpServers = isLive ? [] : await buildMcpServersConfig(noteToolsEnabled);
            if (isLive) {
                // The session is still loaded in this process, so the turn
                // prompts it directly. The CLIs reject `session/load` for it.
                sessionId = resumable;
                sessionModels = stored?.models;
            } else if (resumable) {
                // The process that held the session ended. `session/load`
                // replays its history as notifications, which the pool drops
                // because no turn is attached to the session yet.
                try {
                    const loaded = await client.request<{ models?: AcpSessionModelState } | null>(
                        "session/load",
                        { sessionId: resumable, cwd: this.agentCwd(), mcpServers },
                        SESSION_TIMEOUT_MS
                    );
                    sessionId = resumable;
                    sessionModels = loaded?.models;
                } catch (err) {
                    getLog().info(`${this.logLabel}: session/load failed (${describeError(err)}); reseeding a fresh session.`);
                }
            }

            if (!sessionId) {
                const created = await this.createSession(client, { cwd: this.agentCwd(), mcpServers }, false, SESSION_TIMEOUT_MS);
                sessionId = created.sessionId;
                sessionModels = created.models;
            }
            collector.sessionId = sessionId;
            attachedSession = sessionId;
            pool.attach(sessionId, { onUpdate: params => collector.onNotification("session/update", params), config });

            // The catalog id the turn runs on, and the agent's own id for it when known.
            let runningModel = this.defaultModelId;
            let runningModelId = sessionModels?.currentModelId;
            if (model !== this.defaultModelId) {
                // Model selection is an optional ACP capability — degrade to the
                // agent's default rather than failing the turn.
                try {
                    const modelId = this.sessionModelId(model, config);
                    await client.request("session/set_model", { sessionId, modelId }, INIT_TIMEOUT_MS);
                    runningModel = model;
                    runningModelId = modelId;
                } catch (err) {
                    getLog().error(`${this.logLabel}: failed to select model "${model}" (${describeError(err)}); continuing with the agent's default.`);
                }
            }

            // Text that precedes this turn's own content: the system
            // instructions and replayed transcript when the session is fresh,
            // then the volatile current-note metadata hint (kept out of the
            // transcript hash so a later turn can still resume).
            const isFreshSession = sessionId !== resumable;
            const hasAttachments = Array.isArray(lastMessage.content) && lastMessage.content.some(p => p.type !== "text");
            const noteHint = config.contextNoteId ? buildNoteHint(config.contextNoteId, hasAttachments) : null;
            const prefix = [
                isFreshSession ? wrapSystemInstructions(composeSystemPrompt(messages, { ...config, enableNoteTools: noteToolsEnabled })) : null,
                (isFreshSession && history.length > 0) ? buildHistoryReplay(history) : null,
                noteHint
            ].filter((s): s is string => Boolean(s)).join("\n\n");

            const promptSessionId = sessionId;
            const onAbort = () => {
                // Cancel in-band: other chats share the process, so the turn
                // cannot end it.
                client.notify("session/cancel", { sessionId: promptSessionId });
                // Wake the drain loop below: an agent slow to honour the cancel
                // (or ignoring it) would otherwise keep this generator suspended
                // until PROMPT_TIMEOUT_MS elapses.
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
                // reading past this point.
                while ((!finished && !signal?.aborted) || chunkQueue.length > 0) {
                    if (chunkQueue.length === 0) {
                        await new Promise<void>(resolve => { wakeup = resolve; });
                        wakeup = undefined;
                        continue;
                    }
                    for (const chunk of chunkQueue.splice(0)) {
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
                // ACP reports no token counts, so the usage carries only the model.
                yield { type: "usage", usage: { model: this.describeRunningModel(runningModel, runningModelId, sessionModels), provider: this.name } };
            } finally {
                signal?.removeEventListener("abort", onAbort);
            }

            // An aborted turn stops draining before the agent settles, so the
            // session's real history is unknown — recording a hash here would
            // let a later turn resume a session that diverged from the
            // transcript. Forgetting it just reseeds a fresh one.
            if (config.chatNoteId && !signal?.aborted) {
                rememberSession(sessionsByChatNote, config.chatNoteId, {
                    sessionId,
                    transcriptHash: hashTranscript([
                        ...conversation,
                        { role: "assistant", content: assistantText }
                    ]),
                    generation: acquired.generation,
                    noteToolsEnabled,
                    models: sessionModels
                });
            }

            yield { type: "done" };
        } catch (error) {
            yield { type: "error", error: this.describeFailure(error) };
        } finally {
            if (attachedSession) {
                pool.detach(attachedSession);
            }
            if (lease) {
                pool.release();
            }
        }
    }

    /**
     * Name a chat after its first message, in the session titles share. Titles
     * take turns, because a session answers one prompt at a time.
     */
    async generateTitle(firstMessage: string): Promise<string> {
        const state = this.state();
        const title = state.titleQueue.then(() => this.requestTitle(firstMessage));
        state.titleQueue = title;
        return title;
    }

    private async requestTitle(firstMessage: string): Promise<string> {
        const pool = this.state().pool;
        let lease: AcpLease | undefined;
        let sessionId: string | undefined;
        let answered = false;
        try {
            let title = "";
            lease = await pool.acquire(connection => this.connect(connection));
            sessionId = await this.titleSessionFor(lease);
            pool.attach(sessionId, {
                onUpdate: params => {
                    const update = (params as AcpSessionUpdate).update;
                    if (update?.sessionUpdate === "agent_message_chunk" && update.content && "text" in update.content && update.content.type === "text") {
                        title += update.content.text;
                    }
                }
            });
            await lease.client.request(
                "session/prompt",
                {
                    sessionId,
                    prompt: [{
                        type: "text",
                        text: `Generate a short title (at most 5 words) summarizing the chat message below. It is a new request: earlier messages in this conversation do not apply. Reply with only the title, no quotes or punctuation around it:

${firstMessage.substring(0, 500)}`
                    }]
                },
                SESSION_TIMEOUT_MS
            );
            answered = true;
            return title.trim().replace(/^["']|["']$/g, "").substring(0, 100);
        } catch (error) {
            getLog().error(`${this.logLabel} title generation failed: ${this.describeFailure(error)}`);
            return "";
        } finally {
            if (sessionId) {
                pool.detach(sessionId);
            }
            // A failed prompt leaves the session in an unknown state.
            if (lease && sessionId && !answered) {
                await this.retireTitleSession(lease);
            }
            if (lease) {
                pool.release();
            }
        }
    }

    /**
     * The title session on the lease's process, opening one on the title model
     * when the process has none or the current one reached
     * {@link MAX_TITLES_PER_SESSION}.
     */
    private async titleSessionFor(lease: AcpLease): Promise<string> {
        const state = this.state();
        const current = state.titleSession;
        if (current?.generation === lease.generation && current.titles < MAX_TITLES_PER_SESSION) {
            current.titles++;
            return current.sessionId;
        }
        await this.retireTitleSession(lease);

        const { sessionId } = await this.createSession(lease.client, { cwd: this.agentCwd(), mcpServers: [] }, false, SESSION_TIMEOUT_MS);
        const titleModel = this.titleModelId();
        if (titleModel) {
            try {
                await lease.client.request("session/set_model", { sessionId, modelId: titleModel }, INIT_TIMEOUT_MS);
            } catch {
                // Title generation works on any model; ignore selection failures.
            }
        }
        state.titleSession = { sessionId, generation: lease.generation, titles: 1 };
        return sessionId;
    }

    /** Stop using the title session, closing it when its process is the lease's and the agent supports that. */
    private async retireTitleSession(lease: AcpLease): Promise<void> {
        const state = this.state();
        const retired = state.titleSession;
        state.titleSession = undefined;
        if (retired?.generation === lease.generation && sessionClosers.has(lease.client)) {
            await this.closeAgentSession(lease.client, retired.sessionId);
        }
    }

    /** Ask the agent to drop a session it no longer needs, logging a refusal. */
    private async closeAgentSession(client: AcpClient, sessionId: string): Promise<void> {
        try {
            await client.request("session/close", { sessionId }, INIT_TIMEOUT_MS);
        } catch (err) {
            getLog().info(`${this.logLabel}: session/close failed (${describeError(err)}).`);
        }
    }

    /** Start the pooled agent, answering each permission request with its turn's configuration. */
    private connect(connection: AcpPoolConnection): Promise<AcpClient> {
        return this.startClient(connection.onNotification, {
            turnConfig: connection.turnConfig,
            onExit: connection.onExit
        });
    }

    /**
     * Spawn the agent and run the ACP initialize handshake. `turnConfig` gives
     * the configuration of the chat turn a permission request belongs to, which
     * the permission policy reads.
     */
    protected async startClient(
        onNotification: (method: string, params: unknown) => void,
        options: {
            turnConfig?: (sessionId: string | undefined) => LlmProviderConfig | undefined;
            onExit?: (error: Error) => void;
        } = {}
    ): Promise<AcpClient> {
        const launch = await this.launchSpec();
        const client = AcpClient.start(launch.binary, {
            cwd: this.agentCwd(),
            shell: launch.shell,
            args: launch.args,
            env: launch.env,
            onNotification,
            onAgentRequest: (method, params) => this.handleAgentRequest(
                method,
                params,
                options.turnConfig?.((params as { sessionId?: string } | undefined)?.sessionId)
            ),
            onExit: options.onExit
        });
        try {
            const initialized = await client.request<AcpInitializeResult | null>(
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
            if (initialized?.agentCapabilities?.sessionCapabilities?.close) {
                sessionClosers.add(client);
            }
        } catch (err) {
            client.dispose();
            throw err;
        }
        return client;
    }

    /**
     * Handle agent→client requests. Only the permission callback is supported;
     * everything else (fs, terminal) was never advertised and is refused.
     */
    private handleAgentRequest(method: string, params: unknown, config: LlmProviderConfig | undefined): unknown {
        if (method === "session/request_permission") {
            return this.decidePermission(params as AcpPermissionRequest, config);
        }
        throw new Error(`Trilium does not support "${method}".`);
    }

    /**
     * Directory the agent subprocess runs in. The CLIs key their session storage
     * and project-level config (custom instructions, trusted-folder state) by
     * cwd, so a stable, dedicated directory keeps Trilium's sessions grouped and
     * away from any real project. The `.git` marker makes it its own project
     * root so an enclosing repository's agent config (AGENTS.md,
     * .github/copilot-instructions.md) is never inherited — the dev-run data dir
     * sits inside the Trilium repo.
     */
    protected agentCwd(): string {
        const state = this.state();
        if (!state.agentCwd) {
            // Resolve to an absolute path — TRILIUM_DATA_DIR can be relative (dev
            // runs use TRILIUM_DATA_DIR=data) and a relative spawn cwd would move
            // with the server process's own cwd.
            const cwd = path.resolve(dataDirs.TRILIUM_DATA_DIR, this.agentDirName);
            fs.mkdirSync(cwd, { recursive: true });

            const gitMarker = path.join(cwd, ".git");
            if (!fs.existsSync(gitMarker)) {
                fs.mkdirSync(path.join(gitMarker, "objects"), { recursive: true });
                fs.mkdirSync(path.join(gitMarker, "refs"), { recursive: true });
                fs.writeFileSync(path.join(gitMarker, "HEAD"), "ref: refs/heads/main\n");
            }
            state.agentCwd = cwd;
        }
        return state.agentCwd;
    }

    private state(): ProviderState {
        let state = stateByProvider.get(this.name);
        if (!state) {
            state = { sessionsByChatNote: new Map(), pool: new AcpClientPool(this.logLabel), titleQueue: Promise.resolve() };
            stateByProvider.set(this.name, state);
        }
        return state;
    }
}

/**
 * Deny a permission request, preferring a persistent "reject always" so a
 * retrying agent stops re-asking, then a one-shot reject, then cancelling the
 * turn. Never allows.
 */
export function denyPermission(request: AcpPermissionRequest, logLabel: string): AcpPermissionOutcome {
    getLog().info(`${logLabel}: denied unapproved tool call "${request.toolCall?.title ?? "unknown"}" (kind: ${request.toolCall?.kind ?? "?"}).`);

    const options = request.options ?? [];
    const rejectOption = options.find(o => o.kind === "reject_always") ?? options.find(o => o.kind === "reject_once");
    if (rejectOption) {
        return { outcome: { outcome: "selected", optionId: rejectOption.optionId } };
    }
    return { outcome: { outcome: "cancelled" } };
}

/**
 * Create the session/update collector: maps ACP updates to LlmStreamChunks and
 * pushes them through `emit`. `sessionId` filters stray updates from other
 * sessions.
 * `isHidden` keeps a tool call, and with it every update for that call, out
 * of the chat. `describeBuiltIn` names a built-in tool call the chat has a
 * label for; a call it leaves undescribed shows its title.
 */
export function createUpdateCollector(
    emit: (chunk: LlmStreamChunk) => void,
    isHidden?: (update: AcpToolCallUpdate) => boolean,
    describeBuiltIn?: (update: AcpToolCallUpdate) => BuiltInToolDisplay | undefined
) {
    // toolCallId → display name, for labelling results; also the guard that
    // only this turn's tool calls produce result chunks.
    const toolNamesById = new Map<string, string>();

    const collector = {
        sessionId: undefined as string | undefined,
        onNotification(method: string, params: unknown): void {
            if (method !== "session/update") {
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
                    if (!update.toolCallId || toolNamesById.has(update.toolCallId) || isHidden?.(update)) {
                        break; // malformed, a re-announcement of a known call, or hidden
                    }
                    const mcpTool = mcpToolName(update._meta);
                    const builtIn = mcpTool ? undefined : describeBuiltIn?.(update);
                    const toolName = mcpTool ?? builtIn?.toolName ?? (update.title || "tool");
                    toolNamesById.set(update.toolCallId, toolName);
                    emit({
                        type: "tool_use",
                        toolCallId: update.toolCallId,
                        toolName,
                        toolInput: (mcpTool ? unwrapMcpArguments(update.rawInput) : builtIn?.toolInput ?? update.rawInput ?? {}) as Record<string, unknown>
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

/**
 * Map the current user turn to ACP prompt blocks: real image blocks for
 * natively-supported attachments, text for everything else. `prefix` (system
 * instructions + reseed transcript + note hint) always leads.
 */
export function buildPromptBlocks(content: string | LlmMessagePart[], prefix: string): AcpContentBlock[] {
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

export function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** ACP content block (subset used by these providers). */
type AcpContentBlock =
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string };

interface AcpSessionUpdate {
    sessionId: string;
    update?: AcpToolCallUpdate;
}

/** One `session/update` payload; the fields listed are those of tool calls. */
export interface AcpToolCallUpdate {
    sessionUpdate: string;
    content?: AcpContentBlock | { type: string; content?: AcpContentBlock; [key: string]: unknown };
    toolCallId?: string;
    title?: string;
    status?: string;
    /** Files the call touches. */
    locations?: { path?: string }[];
    rawInput?: unknown;
    rawOutput?: unknown;
    [key: string]: unknown;
}

function rememberSession(sessionsByChatNote: Map<string, SessionEntry>, chatNoteId: string, entry: SessionEntry) {
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

/** The MCP server list for `session/new`/`session/load`: the private loopback endpoint, or none. */
async function buildMcpServersConfig(noteToolsEnabled: boolean): Promise<AcpMcpServer[]> {
    if (!noteToolsEnabled) {
        return [];
    }
    const url = await getAcpMcpEndpointUrl();
    return [{ name: NOTE_TOOLS_MCP_SERVER_NAME, type: "http", url, headers: [] }];
}

/**
 * Build the same Trilium system prompt the other providers use. ACP has no
 * system-prompt parameter, so it is delivered as a `<system_instructions>`
 * block leading the first prompt of each session.
 */
function composeSystemPrompt(messages: LlmMessage[], config: LlmProviderConfig): string {
    // buildSystemPrompt only returns undefined in its own documented-unreachable
    // no-parts case (the markdown hints are always appended).
    /* v8 ignore next */
    return buildSystemPrompt(messages, config) ?? "";
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

/**
 * The MCP tool behind a tool call, from the `_meta` that `agy_acp_server` sets on
 * calls to a client-provided MCP server. The call's title is `<server>_<tool>`,
 * which matches none of the tool labels the chat has.
 */
function mcpToolName(meta: unknown): string | undefined {
    const typed = meta as { is_mcp_tool_call?: unknown; mcp?: { tool?: unknown } } | undefined;
    return typed?.is_mcp_tool_call === true && typeof typed.mcp?.tool === "string" ? typed.mcp.tool : undefined;
}

/** An MCP call's arguments, which `agy_acp_server` reports wrapped as `{ arguments: … }`. */
function unwrapMcpArguments(rawInput: unknown): unknown {
    const wrapped = rawInput as { arguments?: unknown } | undefined;
    return wrapped && typeof wrapped.arguments === "object" && wrapped.arguments !== null ? wrapped.arguments : rawInput ?? {};
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
