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
import { encodeBase64 } from "@triliumnext/core/src/services/utils/binary.js";
import fs from "fs";
import path from "path";

import dataDirs from "../../data_dir.js";
import type { LlmProvider, LlmProviderConfig, ModelInfo, ModelPricing, StreamResult } from "../types.js";
import { AcpError } from "./acp_client.js";
import { resolveAttachmentPart } from "./attachment_content.js";
import { needsShell, resolveCopilotBinaryPath } from "./copilot_binary.js";
import {
    acquireClient,
    addSessionListener,
    type ClientLease,
    INIT_TIMEOUT_MS,
    releaseClient,
    removeSessionListener,
    setAgentRequestHandler
} from "./copilot_client_pool.js";
import { getCopilotMcpEndpointUrl } from "./copilot_mcp_endpoint.js";
import { buildNoteHint } from "./note_hint.js";
import { buildSystemPrompt } from "./system_prompt.js";
import { attachmentPlaceholder, buildHistoryReplay, hashTranscript } from "./transcript.js";

/** Image media types the ACP prompt accepts as a base64 image block. */
const SUPPORTED_IMAGE_MIMES = new Set<string>(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/**
 * Models offered under a Copilot subscription, mirroring the CLI's own model
 * picker (as reported by `session/new`). Pricing is zero because usage is
 * covered by the subscription; `costMultiplier` carries the CLI-reported
 * premium-request multiplier instead (e.g. 0.33x, 1x).
 */
const AVAILABLE_MODELS: ModelInfo[] = [
    { id: "auto", name: "Auto", pricing: { input: 0, output: 0 }, isDefault: true, isSubscription: true },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5", pricing: { input: 0, output: 0 }, costMultiplier: 1, isSubscription: true },
    { id: "claude-haiku-4.5", name: "Claude Haiku 4.5", pricing: { input: 0, output: 0 }, costMultiplier: 0.3, isSubscription: true },
    { id: "gpt-5.4", name: "GPT-5.4", pricing: { input: 0, output: 0 }, costMultiplier: 1, isSubscription: true },
    { id: "gpt-5.3-codex", name: "GPT-5.3-Codex", pricing: { input: 0, output: 0 }, costMultiplier: 1, isSubscription: true },
    { id: "gpt-5.4-mini", name: "GPT-5.4 mini", pricing: { input: 0, output: 0 }, costMultiplier: 0.3, isSubscription: true },
    { id: "gpt-5-mini", name: "GPT-5 mini", pricing: { input: 0, output: 0 }, costMultiplier: 0, isSubscription: true }
];

/** Free-tier model used for the cheap title turn. */
const TITLE_MODEL = "gpt-5-mini";

const SESSION_TIMEOUT_MS = 120_000;
/** Upper bound for a whole prompt turn (agentic loops included). */
const PROMPT_TIMEOUT_MS = 15 * 60_000;

/** Session mappings kept per chat note; bounded to avoid unbounded growth. */
const MAX_TRACKED_SESSIONS = 200;

interface SessionEntry {
    sessionId: string;
    /** Hash of the transcript as it stood when the session last responded. */
    transcriptHash: string;
    /**
     * The pooled agent process the session was created on. A session only
     * exists inside the process that created it, so a mismatch means the
     * session must be re-loaded from disk rather than prompted directly.
     */
    generation: number;
    /**
     * Whether the session was created with the note-tools MCP server attached.
     * MCP servers are fixed at `session/new`, so flipping the chat's note
     * access forces a new session rather than a resume.
     */
    noteToolsEnabled: boolean;
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

export class CopilotAgentProvider implements LlmProvider {
    name = "copilot-agent";

    getModelPricing(model: string): ModelPricing | undefined {
        return AVAILABLE_MODELS.some(m => m.id === model) ? { input: 0, output: 0 } : undefined;
    }

    getAvailableModels(): ModelInfo[] {
        return AVAILABLE_MODELS;
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

        const noteToolsEnabled = config.enableNoteTools !== false;
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
        let lease: ClientLease | undefined;
        let listeningTo: string | undefined;
        let assistantText = "";

        try {
            // Held in a const too: `lease` is captured by the cleanup below, so
            // narrowing it to non-undefined here wouldn't survive.
            const acquired = await acquireSharedClient();
            lease = acquired;
            const client = acquired.client;

            // MCP servers are fixed at session/new, so a flipped note-tools
            // toggle can't reuse the mapped session at all — neither by
            // prompting it nor by loading it back with a different config.
            const resumable = resume !== undefined && stored?.noteToolsEnabled === noteToolsEnabled
                ? resume
                : undefined;
            // The fast path: the session is still loaded in this very agent
            // process, so the turn skips session/new (and the ~2.4 s auth and
            // model-list refresh the first one pays) and prompts it directly.
            const isLive = resumable !== undefined && stored?.generation === acquired.generation;

            // Resolved through a local the closures below don't capture, so it
            // still narrows to a definite string once every branch has run.
            let resolved: string | undefined;
            if (isLive) {
                resolved = resumable;
            } else if (resumable !== undefined) {
                // The session outlived its process (reaped, crashed, or the
                // server restarted). session/load replays its history from
                // disk; no listener is registered yet, so that replay is
                // dropped rather than streamed to the user as a fresh reply.
                const mcpServers = noteToolsEnabled ? await buildMcpServersConfig() : [];
                try {
                    await client.request("session/load", { sessionId: resumable, cwd: getAgentCwd(), mcpServers }, SESSION_TIMEOUT_MS);
                    resolved = resumable;
                } catch (err) {
                    getLog().info(`Copilot Agent provider: session/load failed (${describeError(err)}); reseeding a fresh session.`);
                }
            }

            if (!resolved) {
                const mcpServers = noteToolsEnabled ? await buildMcpServersConfig() : [];
                const created = await client.request<{ sessionId: string }>(
                    "session/new",
                    { cwd: getAgentCwd(), mcpServers },
                    SESSION_TIMEOUT_MS
                );
                resolved = created.sessionId;
            }
            const activeSession = resolved;
            collector.sessionId = activeSession;
            // Subscribe only now: everything above is setup whose notifications
            // (session/load's replay, session/new's config announcements) must
            // not reach the chat.
            listeningTo = activeSession;
            addSessionListener(activeSession, params => collector.onNotification("session/update", params));

            if (model !== "auto") {
                // Model selection is an optional ACP capability — degrade to the
                // agent's default rather than failing the turn.
                try {
                    await client.request("session/set_model", { sessionId: activeSession, modelId: model }, INIT_TIMEOUT_MS);
                } catch (err) {
                    getLog().error(`Copilot Agent provider: failed to select model "${model}" (${describeError(err)}); continuing with the agent's default.`);
                }
            }

            // Text that precedes this turn's own content: the system
            // instructions and replayed transcript when the session is fresh,
            // then the volatile current-note metadata hint (kept out of the
            // transcript hash so a later turn can still resume).
            const isFreshSession = activeSession !== resumable;
            const hasAttachments = Array.isArray(lastMessage.content) && lastMessage.content.some(p => p.type !== "text");
            const noteHint = config.contextNoteId ? buildNoteHint(config.contextNoteId, hasAttachments) : null;
            const prefix = [
                isFreshSession ? wrapSystemInstructions(this.composeSystemPrompt(messages, { ...config, enableNoteTools: noteToolsEnabled })) : null,
                (isFreshSession && history.length > 0) ? buildHistoryReplay(history) : null,
                noteHint
            ].filter((s): s is string => Boolean(s)).join("\n\n");

            const onAbort = () => {
                // Cancel the turn in-band. The client is shared with every
                // other chat now, so disposing it here would kill their turns
                // too — reaping is the pool's job alone.
                client.notify("session/cancel", { sessionId: activeSession });
                // Wake the drain loop below: an agent slow to honour the cancel
                // (or ignoring it) would otherwise keep this generator — and its
                // subprocess — suspended until PROMPT_TIMEOUT_MS elapses.
                wakeup?.();
            };
            signal?.addEventListener("abort", onAbort, { once: true });

            try {
                const promptPromise = client.request<{ stopReason?: string }>(
                    "session/prompt",
                    { sessionId: activeSession, prompt: buildPromptBlocks(lastMessage.content, prefix) },
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
            if (config.chatNoteId && !signal?.aborted) {
                rememberSession(config.chatNoteId, {
                    sessionId: activeSession,
                    transcriptHash: hashTranscript([
                        ...conversation,
                        { role: "assistant", content: assistantText }
                    ]),
                    generation: acquired.generation,
                    noteToolsEnabled
                });
            }

            yield { type: "done" };
        } catch (error) {
            yield { type: "error", error: describeCopilotError(error) };
        } finally {
            // Stop listening, then hand the client back. The subprocess stays
            // warm for the next turn; the pool reaps it once nothing is using
            // it (see copilot_client_pool.ts).
            if (listeningTo) {
                removeSessionListener(listeningTo);
            }
            if (lease) {
                releaseClient();
            }
        }
    }

    async generateTitle(firstMessage: string): Promise<string> {
        let lease: ClientLease | undefined;
        let listeningTo: string | undefined;
        try {
            let title = "";
            const acquired = await acquireSharedClient();
            lease = acquired;
            const client = acquired.client;

            const { sessionId } = await client.request<{ sessionId: string }>(
                "session/new",
                { cwd: getAgentCwd(), mcpServers: [] },
                SESSION_TIMEOUT_MS
            );
            listeningTo = sessionId;
            addSessionListener(sessionId, params => {
                const update = (params as AcpSessionUpdate).update;
                if (update?.sessionUpdate === "agent_message_chunk" && update.content && "text" in update.content && update.content.type === "text") {
                    title += update.content.text;
                }
            });
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
            if (listeningTo) {
                removeSessionListener(listeningTo);
            }
            if (lease) {
                releaseClient();
            }
        }
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
 * Borrow the shared agent process for one turn, resolving the user's binary on
 * first use. The permission policy is installed from here rather than owned by
 * the pool, so the security decision stays beside the CLI flags that back it.
 */
async function acquireSharedClient(): Promise<ClientLease> {
    setAgentRequestHandler(handleAgentRequest);
    const binary = await resolveCopilotBinaryPath();
    return acquireClient(binary, getAgentCwd(), needsShell(binary));
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
