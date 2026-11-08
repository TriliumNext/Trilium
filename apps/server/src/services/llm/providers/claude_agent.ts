/**
 * Claude Agent provider — drives the Claude Agent SDK (Claude Code as a
 * subprocess) instead of calling the Anthropic API directly. This lets users
 * with a Claude Pro/Max subscription use the in-app chat without an API key:
 * authentication is owned entirely by Claude Code (`claude /login` once on the
 * machine running the server), and billing goes to the subscription.
 *
 * Bring-your-own-binary: the SDK's ~250 MB bundled native binary is stripped at
 * install time (`ignoredOptionalDependencies` in the root pnpm-workspace.yaml);
 * the provider drives the user's own
 * installed `claude` CLI (see claude_binary.ts), keeping the server lean.
 *
 * Unlike the AI-SDK providers, the Agent SDK runs its own agentic loop and is
 * session-based (it owns conversation history). This provider therefore:
 *   - implements `chatChunks()` (chunk-native streaming) instead of `chat()`,
 *   - maps chat notes to agent sessions and sends only the newest user message
 *     when the transcript still matches (`resume`), falling back to seeding a
 *     fresh session from the transcript when it diverged or was lost,
 *   - exposes note tools by pointing the agent at Trilium's own MCP server,
 *     with every built-in Claude Code tool (file access, bash, …) disabled.
 */

import type { CanUseTool, Options as AgentOptions, query as queryFn, SDKAssistantMessage, SDKMessage, SDKResultMessage, SDKUserMessage, SpawnedProcess } from "@anthropic-ai/claude-agent-sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources";
import type { LlmMessage, LlmMessagePart, LlmStreamChunk } from "@triliumnext/commons";
import { getLog } from "@triliumnext/core";
import { attachmentPlaceholder, resolveAttachmentPart } from "@triliumnext/core/src/services/llm/attachment_content.js";
import { getSelectedModel } from "@triliumnext/core/src/services/llm/index.js";
import { buildNoteHint } from "@triliumnext/core/src/services/llm/note_hint.js";
import { anthropicRecommendedIds } from "@triliumnext/core/src/services/llm/providers/anthropic.js";
import { getProviderPrices, type ProviderPrices } from "@triliumnext/core/src/services/llm/providers/base_provider.js";
import { buildSystemPrompt } from "@triliumnext/core/src/services/llm/system_prompt.js";
import { TOOL_CALL_DECLINED_REASON, type ToolApprovals } from "@triliumnext/core/src/services/llm/tool_approval.js";
import type { LlmProvider, LlmProviderConfig, ModelInfo, ModelPricing, StreamResult } from "@triliumnext/core/src/services/llm/types.js";
import { encodeBase64 } from "@triliumnext/core/src/services/utils/binary.js";
import { spawn as nodeSpawn } from "child_process";
import fs from "fs";
import path from "path";

import dataDirs from "../../data_dir.js";
import { createMcpServer } from "../../mcp/mcp_server.js";
import { resolveClaudeBinaryPath } from "./claude_binary.js";
import {
    type ClaudeSession,
    closeSession,
    Pushable,
    releaseSession,
    rememberSession as rememberWarmSession,
    takeWarmSession
} from "./claude_session_pool.js";
import { buildHistoryReplay, buildTitlePrompt, cleanTitle, flattenContent, hashTranscript } from "./transcript.js";

// Re-exported for existing importers (specs, siblings); the implementations
// now live in the shared transcript module.
export { buildSeededPrompt, hashTranscript } from "./transcript.js";

/** Image media types Anthropic accepts as a base64 image block. */
type SupportedImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
const SUPPORTED_IMAGE_MIMES = new Set<string>(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/**
 * Claude Code's own picker value for the model it recommends to this account. A chat
 * on it sends no model, so Claude Code chooses.
 */
const DEFAULT_MODEL = "default";

/**
 * The catalog available without asking Claude Code anything. `chat.ts` needs a
 * synchronous default for a chat that stores no model, and {@link DEFAULT_MODEL}
 * is the one id that never goes out of date. {@link ClaudeAgentProvider.listModels}
 * reads the real line-up from the CLI.
 */
const FALLBACK_MODELS: ModelInfo[] = [
    { id: DEFAULT_MODEL, name: "Default", pricing: { input: 0, output: 0 }, isDefault: true, isSubscription: true }
];

const TITLE_MODEL = "claude-haiku-4-5-20251001";

/**
 * The pool key of the session titles share. Note IDs never contain a colon, so
 * it cannot collide with a chat's own session.
 */
const TITLE_SESSION_KEY = ":title";
const TITLE_FINGERPRINT = "title";
/**
 * The title session's system prompt. `/clear` leaves no earlier titles in the
 * history to imitate, so the examples here hold the model to the word limit.
 */
const TITLE_SYSTEM_PROMPT = "You generate short, descriptive titles. A title has at most five words: name the subject "
    + "and leave out filler such as \"Guide\", \"Overview\", \"Basics\" or \"Common Mistakes\". Reply with only the title "
    + "text — no quotes, no punctuation around it. Examples of good titles: \"Garden Shed Wiring Plan\", "
    + "\"Quarterly Budget Review\", \"Fixing Login Timeouts\".";
/** How long a title or a `/clear` waits for its result before the title session is closed. */
export const TITLE_TIMEOUT_MS = 60_000;

/** Upper bound on assistant↔tool round-trips within one chat turn. */
const MAX_TURNS = 25;

/** How long a successfully probed subscription model list is served from cache. */
const SUBSCRIPTION_MODEL_TTL_MS = 60 * 60 * 1000;
/** Upper bound on how long the init handshake may take to surface the catalog. */
const SUBSCRIPTION_MODEL_PROBE_TIMEOUT_MS = 15_000;

/**
 * Cached dynamic model list. Deliberately module-level rather than per-instance:
 * the add/edit-provider flow ({@link listProviderModels}) builds a throwaway
 * provider on every call, so an instance cache would never hit — and there is
 * only ever one Claude Code install per host, so a single shared cache is both
 * correct and avoids re-spawning the CLI subprocess on each dropdown open.
 */
let subscriptionModelCache: { models: ModelInfo[]; fetchedAt: number } | undefined;
let subscriptionModelInFlight: Promise<ModelInfo[]> | undefined;

/** Session mappings kept per chat note; bounded to avoid unbounded growth. */
const MAX_TRACKED_SESSIONS = 200;

interface SessionEntry {
    sessionId: string;
    /** Hash of the transcript as it stood when the session last responded. */
    transcriptHash: string;
}

/**
 * chatNoteId → agent session. In-memory only: agent sessions live on this
 * host (under ~/.claude), so the mapping must not sync across devices. Losing
 * it (e.g. on restart) is fine — the provider reseeds a fresh session from
 * the transcript the client sends.
 */
const sessionsByChatNote = new Map<string, SessionEntry>();

/** Settles when the title in progress does; a session answers one prompt at a time. */
let titleQueue: Promise<unknown> = Promise.resolve();

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

export class ClaudeAgentProvider implements LlmProvider {
    name = "claude-agent";

    /**
     * Free for every model the subscription covers: Claude Code's default, the
     * models its catalog listed, and any Claude model the price table knows.
     * Long-context variants (`claude-opus-4-8[1m]`) are looked up by their base id.
     */
    getModelPricing(model: string): ModelPricing | undefined {
        const known = model === DEFAULT_MODEL
            || subscriptionModelCache?.models.some(m => m.id === model)
            || Object.hasOwn(getProviderPrices("anthropic"), baseModelId(model));
        return known ? { input: 0, output: 0 } : undefined;
    }

    getAvailableModels(): ModelInfo[] {
        return FALLBACK_MODELS;
    }

    /**
     * The subscription catalog shares Anthropic's `claude-*` id shape, so it
     * reuses the metered provider's per-family newest-version rule rather than
     * the generic non-preview/non-legacy default.
     *
     * Long-context ids (`claude-opus-4-8[1m]`) don't match that shape, so they are
     * ranked under their base id and the winners translated back to the ids
     * actually on offer — otherwise the one Opus row Claude Code lists would be
     * left out of the pre-selected set entirely.
     */
    recommendedModelIds(models: ModelInfo[]): Set<string> {
        const idsByBase = new Map<string, string[]>();
        for (const model of models) {
            const base = baseModelId(model.id);
            idsByBase.set(base, [...(idsByBase.get(base) ?? []), model.id]);
        }
        const bases = anthropicRecommendedIds([...idsByBase.keys()].map(id => ({ id, name: id })));
        return new Set([...bases].flatMap(base => idsByBase.get(base) ?? []));
    }

    /**
     * Dynamically list the models Claude Code actually offers on this host, with
     * context windows from the committed price table. Unlike the API providers there is no
     * `/models` endpoint: the catalog is whatever the installed CLI reports for
     * the logged-in account (tier, version, any managed `availableModels`
     * allowlist), which the Agent SDK hands over via the `initialize` handshake.
     *
     * Cached for {@link SUBSCRIPTION_MODEL_TTL_MS}. A probe *failure* (Claude
     * Code not installed, not logged in, or timed out) propagates so the
     * add/edit-provider screen surfaces an actionable error. There is no offline
     * line-up to fall back to: {@link getAvailableModels} holds only Claude Code's default.
     */
    async listModels(): Promise<ModelInfo[]> {
        const now = Date.now();
        if (subscriptionModelCache && now - subscriptionModelCache.fetchedAt < SUBSCRIPTION_MODEL_TTL_MS) {
            return subscriptionModelCache.models;
        }
        if (!subscriptionModelInFlight) {
            subscriptionModelInFlight = this.fetchModels().finally(() => {
                subscriptionModelInFlight = undefined;
            });
        }
        return subscriptionModelInFlight;
    }

    private async fetchModels(): Promise<ModelInfo[]> {
        let sdkModels: SubscriptionModelSource[];
        try {
            sdkModels = await this.probeSupportedModels();
        } catch (error) {
            // Report why the probe failed (missing binary, not logged in, timeout)
            // so the caller can show an actionable message.
            throw new Error(describeAgentError(error));
        }
        const models = buildSubscriptionModelList(sdkModels, getProviderPrices("anthropic"));
        subscriptionModelCache = { models, fetchedAt: Date.now() };
        return models;
    }

    /**
     * Read Claude Code's model catalog without running a chat turn. A streaming
     * prompt that never yields keeps stdin open so the session's `initialize`
     * handshake completes — that handshake carries the catalog, so no user
     * message is sent and no tokens are spent. The session is torn down as soon
     * as the catalog is read (or the probe times out).
     */
    private async probeSupportedModels(): Promise<SubscriptionModelSource[]> {
        const abortController = new AbortController();
        // An input stream that yields no user message: `next()` stays pending —
        // keeping the session's stdin open so the `initialize` handshake can
        // complete — and only resolves `done` when the probe is torn down. No
        // user turn is ever sent, so the probe spends no tokens.
        const noInput: AsyncIterable<SDKUserMessage> = {
            [Symbol.asyncIterator]: () => ({
                next: () => new Promise<IteratorResult<SDKUserMessage>>(resolve => {
                    const finish = () => resolve({ done: true, value: undefined });
                    if (abortController.signal.aborted) {
                        finish();
                    } else {
                        abortController.signal.addEventListener("abort", finish, { once: true });
                    }
                })
            })
        };

        const query = await loadQuery();
        const response = query({
            prompt: noInput,
            options: {
                ...await this.buildBaseOptions({ enableNoteTools: false }),
                maxTurns: 1,
                abortController
            }
        });

        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                response.supportedModels(),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error("Timed out reading the Claude Code model catalog")), SUBSCRIPTION_MODEL_PROBE_TIMEOUT_MS);
                })
            ]);
        } finally {
            // `timer` is always assigned by the time this runs: the Promise
            // executor above is invoked synchronously by the constructor, so the
            // race cannot settle before the assignment. The guard exists only to
            // narrow the optional type, making its else path unreachable.
            /* v8 ignore else */
            if (timer) {
                clearTimeout(timer);
            }
            abortController.abort();
        }
    }

    /** Not used — the route prefers {@link chatChunks} when implemented. */
    chat(): StreamResult {
        throw new Error("The Claude Agent provider streams chunks directly; use chatChunks().");
    }

    async *chatChunks(messages: LlmMessage[], config: LlmProviderConfig, signal?: AbortSignal): AsyncIterable<LlmStreamChunk> {
        if (signal?.aborted) {
            // The abort listener below would never fire for an already-aborted
            // signal — and the client is gone anyway, so don't spawn an agent
            // subprocess nobody will read from.
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

        // Resume the existing agent session only when the transcript the client
        // sent still matches what that session last saw; any divergence (edited
        // history, lost mapping, server restart) reseeds a fresh session.
        const stored = config.chatNoteId ? sessionsByChatNote.get(config.chatNoteId) : undefined;
        const resume = stored && stored.transcriptHash === historyHash ? stored.sessionId : undefined;

        // Text that precedes *this* user turn's own content: the replayed
        // transcript when reseeding a lost/diverged session, then the volatile
        // current-note metadata hint. The hint mirrors the AI-SDK providers'
        // applyNoteHint and is kept out of the session hash so a later turn's
        // unhinted transcript still matches and can resume.
        const hasAttachments = Array.isArray(lastMessage.content) && lastMessage.content.some(p => p.type !== "text");
        const noteHint = config.contextNoteId ? buildNoteHint(config.contextNoteId, hasAttachments) : null;
        const prefix = [
            (!resume && history.length > 0) ? buildHistoryReplay(history) : null,
            noteHint
        ].filter((s): s is string => Boolean(s)).join("\n\n");

        // Attachments the model can consume natively (images, PDFs) are sent as
        // real content blocks via a one-message stream — the only prompt form
        // the Agent SDK accepts them in. Text-only turns (including messages
        // whose attachments all degrade to text, e.g. SVG or text files) stay on
        // the simpler string-prompt path.
        const prompt = buildPrompt(lastMessage.content, prefix, hasAttachments);

        const abortController = new AbortController();
        const onAbort = () => abortController.abort();
        signal?.addEventListener("abort", onAbort, { once: true });

        // A chat without a model, or on the default, sends none, so Claude Code chooses.
        const model = config.model && config.model !== DEFAULT_MODEL ? config.model : undefined;
        // Report the friendly name in usage metadata (the chat pane renders it
        // verbatim); `model` itself must stay the raw ID for the query() call.
        const modelDisplayName = describeModel(model, config.providerId);
        let sessionId: string | undefined;
        let assistantText = "";
        /** The session this turn is driving, released (not closed) at the end. */
        let held: ClaudeSession | undefined;
        /** Set once the turn reaches its `result`; only then is the session in a known state. */
        let turnComplete = false;
        // tool_use id → name, for labelling results; also serves as the guard
        // that only results belonging to *this* turn's tool calls are emitted.
        const toolNamesById = new Map<string, string>();
        // streaming block index → tool_use id, for input-delta attribution
        const toolIdsByBlockIndex = new Map<number, string>();

        try {
            const query = await loadQuery();
            const systemPrompt = this.composeSystemPrompt(messages, config);
            // Options the SDK fixes at query() construction: a change to any of
            // them can't be applied to a live session, so it forces a new one.
            // `model` is deliberately absent — setModel() handles it in place.
            const fingerprint = JSON.stringify({
                systemPrompt,
                noteTools: areNoteToolsAvailable(config),
                webSearch: !!config.enableWebSearch,
                thinking: !!config.enableExtendedThinking
            });

            // Only reuse a warm session when the transcript still matches what
            // it last saw (`resume`), so an edited history reseeds as before.
            const warm = config.chatNoteId && resume
                ? takeWarmSession(config.chatNoteId, fingerprint)
                : undefined;
            let session = warm?.sessionId === resume ? warm : undefined;
            if (warm && !session) {
                // Right chat, wrong conversation — retire it rather than reply
                // into the wrong session.
                closeSession(config.chatNoteId ?? "", warm);
            }

            if (session) {
                if (model && session.model !== model) {
                    // Streaming input mode only; ~0 ms in practice.
                    await session.query.setModel(model);
                    session.model = model;
                }
            } else {
                yield { type: "status", status: "starting_agent" };
                const input = new Pushable<SDKUserMessage>();
                const created: ClaudeSession = {
                    query: query({
                        prompt: input,
                        options: {
                            ...await this.buildBaseOptions(config, () => created.toolApprovals),
                            systemPrompt,
                            model,
                            resume,
                            includePartialMessages: true,
                            maxTurns: MAX_TURNS,
                            abortController
                        }
                    }),
                    input,
                    fingerprint,
                    closed: false,
                    busy: true,
                    model
                };
                session = created;
                if (config.chatNoteId) {
                    rememberWarmSession(config.chatNoteId, session);
                }
            }
            const active = session;
            held = active;
            active.toolApprovals = config.toolApprovals;
            await pushUserTurn(active.input, prompt);

            // Manual iteration on purpose: `for await (…) { break }` calls
            // iterator.return(), which closes the query and kills the process
            // this whole pool exists to keep warm.
            for (;;) {
                const next = await active.query.next();
                if (next.done) {
                    active.closed = true;
                    break;
                }
                const message = next.value;
                sessionId = takeSessionId(message) ?? sessionId;
                active.sessionId = sessionId ?? active.sessionId;

                switch (message.type) {
                    case "stream_event": {
                        if (message.parent_tool_use_id !== null) {
                            break; // subagent traffic — not part of the visible reply
                        }
                        const event = message.event;
                        if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
                            toolIdsByBlockIndex.set(event.index, event.content_block.id);
                            toolNamesById.set(event.content_block.id, event.content_block.name);
                            yield {
                                type: "tool_input_start",
                                toolCallId: event.content_block.id,
                                toolName: friendlyToolName(event.content_block.name)
                            };
                        } else if (event.type === "content_block_delta") {
                            if (event.delta.type === "text_delta") {
                                assistantText += event.delta.text;
                                yield { type: "text", content: event.delta.text };
                            } else if (event.delta.type === "thinking_delta") {
                                yield { type: "thinking", content: event.delta.thinking };
                            } else if (event.delta.type === "input_json_delta") {
                                const toolCallId = toolIdsByBlockIndex.get(event.index);
                                if (toolCallId) {
                                    yield { type: "tool_input_delta", toolCallId, delta: event.delta.partial_json };
                                }
                            }
                        }
                        break;
                    }

                    case "assistant": {
                        if (message.parent_tool_use_id !== null) {
                            break;
                        }
                        const authError = describeAssistantError(message);
                        if (authError) {
                            yield { type: "error", error: authError };
                            break;
                        }
                        // Text/thinking already streamed via stream_events; only
                        // the completed tool calls are emitted from the full message.
                        for (const block of message.message.content) {
                            if (block.type === "tool_use") {
                                toolNamesById.set(block.id, block.name);
                                yield {
                                    type: "tool_use",
                                    toolCallId: block.id,
                                    toolName: friendlyToolName(block.name),
                                    toolInput: (block.input ?? {}) as Record<string, unknown>
                                };
                            }
                        }
                        break;
                    }

                    case "user": {
                        if (message.parent_tool_use_id !== null) {
                            break;
                        }
                        const content = message.message.content;
                        if (!Array.isArray(content)) {
                            break;
                        }
                        for (const block of content) {
                            if (block.type !== "tool_result" || !block.tool_use_id) {
                                continue;
                            }
                            // Only surface results for tool calls made this turn —
                            // this also filters any replayed history on resume.
                            const toolName = toolNamesById.get(block.tool_use_id);
                            if (toolName === undefined) {
                                continue;
                            }
                            yield {
                                type: "tool_result",
                                toolCallId: block.tool_use_id,
                                toolName: friendlyToolName(toolName),
                                result: flattenToolResult(block.content),
                                isError: block.is_error === true
                            };
                        }
                        break;
                    }

                    case "result": {
                        if (message.subtype !== "success") {
                            const errors = "errors" in message && message.errors.length > 0
                                ? message.errors.join("; ")
                                : `Agent stopped: ${message.subtype}`;
                            yield { type: "error", error: errors };
                        }
                        yield {
                            type: "usage",
                            usage: {
                                promptTokens: message.usage.input_tokens,
                                completionTokens: message.usage.output_tokens,
                                totalTokens: message.usage.input_tokens + message.usage.output_tokens,
                                // No cost is reported: usage is covered by the subscription,
                                // so a per-turn dollar figure would only imply billing that
                                // doesn't happen. (The SDK's total_cost_usd is API-equivalent.)
                                model: modelDisplayName,
                                provider: this.name
                            }
                        };
                        // The turn is over, but the session stays open for the
                        // next one — this is what keeps the process warm.
                        turnComplete = true;
                        break;
                    }

                    case "system": {
                        // Diagnose a broken in-process MCP bridge: the init event
                        // reports each MCP server's connection status. If the
                        // note-tools server was wired but didn't connect, tool
                        // calls will silently fail — surface it in the log rather
                        // than leaving a mystery "the agent ignored my notes".
                        if (message.subtype === "init") {
                            const trilium = message.mcp_servers?.find(s => s.name === "trilium");
                            if (trilium && trilium.status !== "connected") {
                                getLog().error(`Claude Agent provider: note-tools MCP server failed to connect (status: ${trilium.status}); the agent has no note access this turn.`);
                            }
                        }
                        break;
                    }

                    default:
                        break;
                }

                if (turnComplete) {
                    break;
                }
            }

            if (config.chatNoteId && sessionId) {
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
            yield { type: "error", error: describeAgentError(error) };
        } finally {
            signal?.removeEventListener("abort", onAbort);
            if (held) {
                held.toolApprovals = undefined;
            }
            const reusable = held && config.chatNoteId && turnComplete && !held.closed && !signal?.aborted;
            if (reusable && held && config.chatNoteId) {
                // Keep the subprocess warm; the pool reaps it when idle.
                releaseSession(config.chatNoteId, held);
            } else {
                // A cancelled or failed turn stops mid-stream, so the session's
                // real state is unknown and the SDK may be wedged mid-`next()`
                // (interrupt() is not guaranteed to make it yield). Killing the
                // process is the one reliable way out: the next turn simply
                // pays a cold start rather than inheriting a broken session.
                if (held) {
                    closeSession(config.chatNoteId ?? "", held);
                }
                abortController.abort();
            }
        }
    }

    /**
     * Name a chat after its first message, in the session titles share. Titles
     * take turns, because a session answers one prompt at a time, and each is
     * followed by a `/clear` that the title does not wait for but the next one does.
     */
    async generateTitle(firstMessage: string): Promise<string> {
        const title = titleQueue.then(() => this.requestTitle(firstMessage));
        titleQueue = title.then(() => clearTitleSession());
        return title;
    }

    private async requestTitle(firstMessage: string): Promise<string> {
        let session: ClaudeSession | undefined;
        let answered = false;
        try {
            session = await this.titleSession();
            await pushUserTurn(session.input, buildTitlePrompt(firstMessage));
            const result = await nextResult(session);
            answered = result !== undefined;
            return result?.subtype === "success" ? cleanTitle(result.result) : "";
        } catch (error) {
            getLog().error(`Claude Agent title generation failed: ${describeAgentError(error)}`);
            return "";
        } finally {
            // A title that got no result leaves the session in an unknown state.
            if (session && answered) {
                releaseSession(TITLE_SESSION_KEY, session);
            } else if (session) {
                closeSession(TITLE_SESSION_KEY, session);
            }
        }
    }

    /** The warm title session, or a new one on {@link TITLE_MODEL}. */
    private async titleSession(): Promise<ClaudeSession> {
        const warm = takeWarmSession(TITLE_SESSION_KEY, TITLE_FINGERPRINT);
        if (warm) {
            return warm;
        }

        const query = await loadQuery();
        const input = new Pushable<SDKUserMessage>();
        const session: ClaudeSession = {
            query: query({
                prompt: input,
                options: {
                    ...await this.buildBaseOptions({ enableNoteTools: false }),
                    systemPrompt: TITLE_SYSTEM_PROMPT,
                    model: TITLE_MODEL,
                    maxTurns: 1,
                    persistSession: false
                }
            }),
            input,
            fingerprint: TITLE_FINGERPRINT,
            closed: false,
            busy: true,
            model: TITLE_MODEL
        };
        rememberWarmSession(TITLE_SESSION_KEY, session);
        return session;
    }

    /**
     * Build the same Trilium system prompt the AI-SDK providers use (skill
     * guidance, [[noteId]] links, Markdown-rendering capabilities), reflecting
     * this path's *actual* tool availability.
     */
    private composeSystemPrompt(messages: LlmMessage[], config: LlmProviderConfig): string {
        const noteToolsAvailable = areNoteToolsAvailable(config);

        // Coerce enableNoteTools to the effective boolean so the prompt's
        // note-tools guidance matches the wired tools exactly (buildBaseOptions
        // gates on the same predicate). `contextNoteId` passes through: chatChunks
        // injects the note metadata into the user turn (see buildNoteHint), so
        // the "you can see the current note's metadata above" notice is accurate.
        const promptConfig: LlmProviderConfig = { ...config, enableNoteTools: noteToolsAvailable };
        // buildSystemPrompt only returns undefined in its own documented-unreachable
        // no-parts case (the markdown hints are always appended).
        /* v8 ignore next */
        return buildSystemPrompt(messages, promptConfig) ?? "";
    }

    /**
     * Options shared by every agent invocation. `approvalsOf` gives the approvals of the turn
     * that drives the session when a note tool is called; without it, note tools run unasked.
     */
    private async buildBaseOptions(
        config: Pick<LlmProviderConfig, "enableNoteTools" | "enableWebSearch" | "enableExtendedThinking">,
        approvalsOf?: () => ToolApprovals | undefined
    ): Promise<AgentOptions> {
        // Built-in Claude Code tools (file access, bash, …) stay disabled — the
        // agent runs on the server host and must only ever touch notes. Web
        // search is the one opt-in exception.
        const builtinTools = config.enableWebSearch ? ["WebSearch", "WebFetch"] : [];
        const allowedTools = [...builtinTools];

        const binaryPath = await resolveClaudeBinaryPath();
        const options: AgentOptions = {
            // Bring-your-own-binary: the SDK's bundled native binary is stripped
            // at install time; drive the user's own installed Claude Code CLI.
            pathToClaudeCodeExecutable: binaryPath,
            cwd: getAgentCwd(),
            tools: builtinTools,
            settingSources: [],
            strictMcpConfig: true,
            permissionMode: "dontAsk",
            // A preset title stops Claude Code from spending a model call on one of
            // its own; Trilium names the chat note itself (see generateTitle()).
            title: "Trilium chat",
            // Extended thinking: `adaptive` lets these (modern) models decide how
            // much to think and stream summarized reasoning, mirroring the metered
            // Anthropic provider. Adaptive is the SDK's default for supporting
            // models, so the toggle's meaningful effect is the disabled path.
            thinking: config.enableExtendedThinking
                ? { type: "adaptive", display: "summarized" }
                : { type: "disabled" }
        };

        // On Windows the resolved binary is typically a .cmd batch file (npm
        // shim). Node's spawn() cannot execute .cmd files directly — it must
        // delegate to cmd.exe via `shell: true`. The SDK spawns without a
        // shell, so we override the spawn to add it.
        if (process.platform === "win32" && binaryPath.endsWith(".cmd")) {
            options.spawnClaudeCodeProcess = ({ command, args, cwd, env, signal }) => {
                return nodeSpawn(command, args, {
                    cwd, env, signal, shell: true, stdio: "pipe"
                }) as unknown as SpawnedProcess;
            };
        }

        if (areNoteToolsAvailable(config)) {
            // In-process MCP: hand the agent Trilium's own MCP server instance
            // (the same one createMcpServer builds for the /mcp HTTP endpoint,
            // with cls.init + sql.transactional wrapping baked in). The SDK
            // tunnels tool calls from the CLI subprocess back to this instance
            // over its stdio control channel — no localhost HTTP endpoint, no
            // open port, and no dependency on the user-facing `mcpEnabled`
            // toggle (which exists to expose notes to *external* clients).
            options.mcpServers = {
                trilium: { type: "sdk", name: "trilium", instance: await createMcpServer() }
            };
            if (approvalsOf) {
                options.permissionMode = "default";
                options.canUseTool = askBeforeNoteTool(approvalsOf);
            } else {
                // Bare server prefix auto-allows every tool from that server.
                allowedTools.push("mcp__trilium");
            }
        }

        options.allowedTools = allowedTools;
        return options;
    }
}

/**
 * Whether the chat requested note tools. With in-process MCP the tools have no
 * external dependency, so this is simply the chat toggle — the tool wiring and
 * the system prompt both gate on it so they never disagree.
 *
 * A config that does not mention them does not get them. That reading matches
 * `base_provider`, which every AI-SDK provider inherits, so what a request
 * leaves unsaid means the same thing whichever provider answers it; the
 * previous `!== false` handed the whole note tree to any caller that simply
 * had no opinion.
 */
function areNoteToolsAvailable(config: Pick<LlmProviderConfig, "enableNoteTools">): boolean {
    return !!config.enableNoteTools;
}

/**
 * Directory the agent subprocess runs in. Claude Code keys its on-disk session
 * storage by cwd, so a stable, dedicated directory keeps Trilium's sessions
 * grouped and away from any real project.
 */
let agentCwd: string | undefined;
function getAgentCwd(): string {
    if (!agentCwd) {
        // Resolve to an absolute path — TRILIUM_DATA_DIR may be relative (dev
        // runs use TRILIUM_DATA_DIR=data) and a relative spawn cwd would move
        // with the server process's own cwd.
        agentCwd = path.resolve(dataDirs.TRILIUM_DATA_DIR, "claude-agent");
        fs.mkdirSync(agentCwd, { recursive: true });

        // Claude Code resolves its "project" by walking up to the nearest git
        // root. If the data dir sits inside a repository (again, the dev-run
        // case), the agent inherits that repo's project state: its .mcp.json
        // approval list (a `disabledMcpjsonServers: ["trilium"]` entry silently
        // disables our MCP server by name), its CLAUDE.md, and its auto-memory
        // — none of which belong in a notes chat. A .git marker makes the agent
        // directory its own project root, isolating it from any enclosing repo.
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

/** For tests: forget the cached dynamic model list so the next call re-probes. */
export function resetSubscriptionModelCacheForTests(): void {
    subscriptionModelCache = undefined;
    subscriptionModelInFlight = undefined;
}

/** The subset of the Agent SDK's model-catalog entries the merge consumes. */
interface SubscriptionModelSource {
    /** The picker value — a family alias (`sonnet`) or a full model id. */
    value: string;
    /** The canonical wire id an alias resolves to (`sonnet` → `claude-sonnet-5`). */
    resolvedModel?: string;
    /** Human-readable name Claude Code shows for the model. */
    displayName?: string;
}

/**
 * Turn Claude Code's live catalog into Trilium's model list.
 *
 * The canonical wire id (`resolvedModel`) is preferred over the picker alias
 * (`value`) so a chat stores a concrete model id that matches the metered
 * Anthropic provider's ids; aliases resolving to the same model are deduped.
 * Names and order are Claude Code's. `prices` (the price table's `anthropic`
 * slice) supplies the context window, by the base id for a long-context variant
 * it doesn't list. The subscription covers every model, so every row is free.
 *
 * {@link DEFAULT_MODEL} is not listed: it would win the dedupe and label its model
 * "Default (recommended)". The model it resolves to is flagged as the default
 * instead, or the first one when the catalog has no default.
 */
export function buildSubscriptionModelList(sdkModels: SubscriptionModelSource[], prices: ProviderPrices): ModelInfo[] {
    const defaultId = sdkModels.find(m => m.value === DEFAULT_MODEL)?.resolvedModel;
    const models: ModelInfo[] = [];
    const seen = new Set<string>();
    for (const model of sdkModels) {
        const id = model.resolvedModel ?? model.value;
        if (model.value === DEFAULT_MODEL || !id || seen.has(id)) {
            continue;
        }
        seen.add(id);
        models.push({
            id,
            name: model.displayName ?? id,
            contextWindow: prices[id]?.ctx ?? prices[baseModelId(id)]?.ctx,
            pricing: { input: 0, output: 0 },
            isSubscription: true
        });
    }

    const defaultIndex = Math.max(models.findIndex(m => m.id === defaultId), 0);
    if (models.length > 0) {
        models[defaultIndex] = { ...models[defaultIndex], isDefault: true };
    }
    return models;
}

/** The suffix of a long-context model id, such as `[1m]` in `claude-opus-4-8[1m]`. */
const CONTEXT_VARIANT = /\[[^\]]+\]$/;

/** The model a long-context id varies (`claude-opus-4-8[1m]` → `claude-opus-4-8`); other ids unchanged. */
function baseModelId(id: string): string {
    return id.replace(CONTEXT_VARIANT, "");
}

/**
 * Friendly name for the model a chat turn ran on, for the usage row: the live
 * catalog's, then the stored selection's (for a chat sent before this process
 * listed the models), then the raw id. A turn on Claude Code's default has no id.
 */
function describeModel(model: string | undefined, providerId: string | undefined): string | undefined {
    if (!model) {
        return undefined;
    }
    return subscriptionModelCache?.models.find(m => m.id === model)?.name
        ?? getSelectedModel(providerId, model)?.name
        ?? model;
}

/**
 * Build the prompt for the current user turn. When the turn carries attachments
 * the model can consume natively, this returns a one-message stream of Anthropic
 * content blocks (the SDK's only multimodal input form); otherwise it returns a
 * plain string. `prefix` (reseed transcript + note hint) always leads.
 */
function buildPrompt(content: string | LlmMessagePart[], prefix: string, hasAttachments: boolean): string | AsyncIterable<SDKUserMessage> {
    if (hasAttachments && Array.isArray(content)) {
        const blocks = buildContentBlocks(content, prefix);
        if (blocks.some(b => b.type === "image" || b.type === "document")) {
            return streamSingleUserMessage(blocks);
        }
        // Nothing the model can take natively — collapse back to text so the
        // turn stays on the well-worn string path (and out of streaming-input
        // mode). Text blocks still carry inlined SVG/text-file content. The
        // non-text arm is unreachable: any image/document block returns above.
        /* v8 ignore next */
        return blocks.map(b => (b.type === "text" ? b.text : "")).filter(Boolean).join("\n\n");
    }
    const lastText = flattenContent(content);
    return prefix ? `${prefix}\n\n${lastText}` : lastText;
}

/**
 * Map the current user turn to Anthropic content blocks: real image/document
 * blocks for natively-supported attachments, text for everything else (plain
 * text parts, inlined SVG/text files, and placeholders for anything unresolved
 * or of a type no block accepts). `prefix` leads as a text block when non-empty.
 */
function buildContentBlocks(content: LlmMessagePart[], prefix: string): ContentBlockParam[] {
    const blocks: ContentBlockParam[] = [];
    if (prefix) {
        blocks.push({ type: "text", text: prefix });
    }
    for (const part of content) {
        if (part.type === "text") {
            blocks.push({ type: "text", text: part.text });
            continue;
        }
        const resolved = resolveAttachmentPart(part);
        if (!resolved || resolved.kind === "text") {
            // Unresolved (missing/protected/corrupt) or a type that degrades to
            // text (SVG source, inlined text file) — a placeholder keeps the
            // turn self-describing even when the bytes can't be sent.
            blocks.push({ type: "text", text: resolved?.kind === "text" ? resolved.text : attachmentPlaceholder(part) });
        } else if (resolved.kind === "image" && SUPPORTED_IMAGE_MIMES.has(resolved.mime)) {
            blocks.push({
                type: "image",
                source: { type: "base64", media_type: resolved.mime as SupportedImageMime, data: encodeBase64(resolved.bytes) }
            });
        } else if (resolved.kind === "file" && resolved.mime === "application/pdf") {
            blocks.push({
                type: "document",
                title: resolved.filename,
                source: { type: "base64", media_type: "application/pdf", data: encodeBase64(resolved.bytes) }
            });
        } else {
            // Resolvable bytes but a type no Anthropic block accepts (e.g. a
            // TIFF image or a .docx) — degrade to a text placeholder.
            blocks.push({ type: "text", text: attachmentPlaceholder(part) });
        }
    }
    return blocks;
}

/** One-shot streaming-input prompt: a single user message, then end of input. */
async function* streamSingleUserMessage(content: ContentBlockParam[]): AsyncIterable<SDKUserMessage> {
    yield { type: "user", message: { role: "user", content }, parent_tool_use_id: null };
}

/**
 * Empty the warm title session with `/clear`, which Claude Code runs in the
 * process without a model call, so the next title starts from no history. A
 * `/clear` that fails closes the session, and the next title starts another.
 */
async function clearTitleSession(): Promise<void> {
    const session = takeWarmSession(TITLE_SESSION_KEY, TITLE_FINGERPRINT);
    if (!session) {
        return;
    }
    try {
        await pushUserTurn(session.input, "/clear");
        if (await nextResult(session)) {
            releaseSession(TITLE_SESSION_KEY, session);
            return;
        }
    } catch (error) {
        getLog().info(`Claude Agent provider: clearing the title session failed (${describeAgentError(error)}).`);
    }
    closeSession(TITLE_SESSION_KEY, session);
}

/**
 * Read a title session up to the `result` of the turn just pushed, or undefined
 * when the stream ends first. Throws when no result comes within
 * {@link TITLE_TIMEOUT_MS}, since a wedged `query.next()` might never settle.
 * Iterates by hand, as in `chatChunks()`: breaking out of `for await` closes the query.
 */
async function nextResult(session: ClaudeSession): Promise<SDKResultMessage | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no reply within ${TITLE_TIMEOUT_MS / 1000} s`)), TITLE_TIMEOUT_MS);
    });
    try {
        for (;;) {
            const next = await Promise.race([session.query.next(), timeout]);
            if (next.done) {
                session.closed = true;
                return undefined;
            }
            if (next.value.type === "result") {
                return next.value;
            }
        }
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Feed one user turn into a live session's streaming input. Accepts both prompt
 * forms {@link buildPrompt} produces: a plain string, or the one-message stream
 * used for natively-consumable attachments (drained here, since a pooled
 * session's input is the only stream the SDK is reading).
 */
async function pushUserTurn(input: Pushable<SDKUserMessage>, prompt: string | AsyncIterable<SDKUserMessage>): Promise<void> {
    if (typeof prompt !== "string") {
        for await (const message of prompt) {
            input.push(message);
        }
        return;
    }
    input.push({
        type: "user",
        message: { role: "user", content: [{ type: "text", text: prompt }] },
        parent_tool_use_id: null
    });
}

/**
 * The name the client knows a tool by: Trilium's tools without their MCP prefix ("search_notes", not
 * "mcp__trilium__search_notes"), and Claude Code's web tools under the names the other providers give
 * theirs. Their inputs already carry the `query` and `url` the chat shows.
 */
/**
 * Ask the user before a call to one of Trilium's note tools, through the approvals of the turn that
 * makes it. Anything else is denied: the in-process server is the only one Trilium registers, and
 * the agent has no other tool that is not pre-approved.
 */
function askBeforeNoteTool(approvalsOf: () => ToolApprovals | undefined): CanUseTool {
    return async (toolName, input, { toolUseID, mcpServer }) => {
        const isNoteTool = toolName.startsWith("mcp__trilium__")
            && (mcpServer === undefined || (mcpServer.source === "sdk" && mcpServer.name === "trilium"));
        if (!isNoteTool) {
            getLog().info(`Claude Agent provider: denied the call to "${toolName}", which is not a note tool.`);
            return { behavior: "deny", message: "Only Trilium's note tools are available." };
        }

        const approvals = approvalsOf();
        const approved = !approvals || await approvals.request({
            toolCallId: toolUseID,
            toolName: friendlyToolName(toolName),
            toolInput: input
        });
        return approved
            ? { behavior: "allow", updatedInput: input }
            : { behavior: "deny", message: TOOL_CALL_DECLINED_REASON };
    };
}

function friendlyToolName(name: string): string {
    return BUILTIN_TOOL_NAMES[name] ?? name.replace(/^mcp__trilium__/, "");
}

const BUILTIN_TOOL_NAMES: Record<string, string> = {
    WebSearch: "web_search",
    WebFetch: "read_web_page"
};

function flattenToolResult(content: unknown): string {
    if (typeof content === "string") {
        return content;
    }
    if (Array.isArray(content)) {
        return content
            .map(block => (block && typeof block === "object" && "text" in block ? String(block.text) : ""))
            .filter(Boolean)
            .join("\n");
    }
    return content == null ? "" : JSON.stringify(content);
}

function takeSessionId(message: SDKMessage): string | undefined {
    return "session_id" in message && typeof message.session_id === "string" ? message.session_id : undefined;
}

/** Map SDK-level assistant errors to actionable messages. */
function describeAssistantError(message: SDKAssistantMessage): string | undefined {
    if (!message.error) {
        return undefined;
    }
    if (message.error === "authentication_failed" || message.error === "oauth_org_not_allowed") {
        return "Claude Code is not authenticated. Run `claude /login` on the machine running the Trilium server to sign in with your Claude subscription (or an API key).";
    }
    return `Claude Agent error: ${message.error}`;
}

function describeAgentError(error: unknown): string {
    const text = error instanceof Error ? error.message : String(error);
    if (/ENOENT|spawn/i.test(text)) {
        return `Failed to start Claude Code: ${text}`;
    }
    return text;
}

// Dynamically imported so the agent SDK only loads when an agent chat actually runs.
async function loadQuery(): Promise<typeof queryFn> {
    return (await import("@anthropic-ai/claude-agent-sdk")).query;
}
