/**
 * Claude Agent provider — drives the Claude Agent SDK (Claude Code as a
 * subprocess) instead of calling the Anthropic API directly. This lets users
 * with a Claude Pro/Max subscription use the in-app chat without an API key:
 * authentication is owned entirely by Claude Code (`claude /login` once on the
 * machine running the server), and billing goes to the subscription.
 *
 * Bring-your-own-binary: the SDK's ~250 MB bundled native binary is stripped at
 * install time (root .pnpmfile.cjs); the provider drives the user's own
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

import { type Options as AgentOptions, query, type SDKAssistantMessage, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources";
import type { LlmMessage, LlmMessagePart, LlmStreamChunk } from "@triliumnext/commons";
import { getLog } from "@triliumnext/core";
import { encodeBase64 } from "@triliumnext/core/src/services/utils/binary.js";
import fs from "fs";
import path from "path";

import dataDirs from "../../data_dir.js";
import { createMcpServer } from "../../mcp/mcp_server.js";
import type { LlmProvider, LlmProviderConfig, ModelInfo, ModelPricing, StreamResult } from "../types.js";
import { resolveAttachmentPart } from "./attachment_content.js";
import { buildModelList } from "./base_provider.js";
import { resolveClaudeBinaryPath } from "./claude_binary.js";
import { buildNoteHint } from "./note_hint.js";
import { buildSystemPrompt } from "./system_prompt.js";
import { attachmentPlaceholder, buildHistoryReplay, flattenContent, hashTranscript } from "./transcript.js";

// Re-exported for existing importers (specs, siblings); the implementations
// now live in the shared transcript module.
export { buildSeededPrompt, hashTranscript } from "./transcript.js";

/** Image media types Anthropic accepts as a base64 image block. */
type SupportedImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
const SUPPORTED_IMAGE_MIMES = new Set<string>(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/**
 * Models offered under a Claude subscription, mirroring Claude Code's own `/model`
 * picker (the Agent SDK accepts any of these). Pricing is zero because usage is
 * covered by the subscription — the per-turn `usage` chunk still reports the
 * API-equivalent cost as informational metadata from the agent's result.
 */
const { models: AVAILABLE_MODELS, pricing: MODEL_PRICING } = buildModelList([
    // ===== Current Models =====
    {
        id: "claude-fable-5",
        name: "Claude Fable 5",
        pricing: { input: 0, output: 0 },
        contextWindow: 1000000,
        isSubscription: true
    },
    {
        id: "claude-opus-4-8",
        name: "Claude Opus 4.8",
        pricing: { input: 0, output: 0 },
        contextWindow: 1000000,
        isSubscription: true
    },
    {
        id: "claude-opus-4-7",
        name: "Claude Opus 4.7",
        pricing: { input: 0, output: 0 },
        contextWindow: 1000000,
        isSubscription: true
    },
    {
        id: "claude-sonnet-5",
        name: "Claude Sonnet 5",
        pricing: { input: 0, output: 0 },
        contextWindow: 1000000,
        isDefault: true,
        isSubscription: true
    },
    {
        id: "claude-haiku-4-5-20251001",
        name: "Claude Haiku 4.5",
        pricing: { input: 0, output: 0 },
        contextWindow: 200000,
        isSubscription: true
    },
    // ===== Legacy Models =====
    {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        pricing: { input: 0, output: 0 },
        contextWindow: 1000000,
        isLegacy: true,
        isSubscription: true
    },
    {
        id: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        pricing: { input: 0, output: 0 },
        contextWindow: 1000000,
        isLegacy: true,
        isSubscription: true
    },
    {
        id: "claude-sonnet-4-5-20250929",
        name: "Claude Sonnet 4.5",
        pricing: { input: 0, output: 0 },
        contextWindow: 200000,
        isLegacy: true,
        isSubscription: true
    },
    {
        id: "claude-opus-4-5-20251101",
        name: "Claude Opus 4.5",
        pricing: { input: 0, output: 0 },
        contextWindow: 200000,
        isLegacy: true,
        isSubscription: true
    }
]);

const TITLE_MODEL = "claude-haiku-4-5-20251001";

/** Upper bound on assistant↔tool round-trips within one chat turn. */
const MAX_TURNS = 25;

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

    getModelPricing(model: string): ModelPricing | undefined {
        return MODEL_PRICING[model];
    }

    getAvailableModels(): ModelInfo[] {
        return AVAILABLE_MODELS;
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

        const model = config.model || AVAILABLE_MODELS.find(m => m.isDefault)?.id;
        // Report the friendly name in usage metadata (the chat pane renders it
        // verbatim); `model` itself must stay the raw ID for the query() call.
        const modelDisplayName = AVAILABLE_MODELS.find(m => m.id === model)?.name ?? model;
        let sessionId: string | undefined;
        let assistantText = "";
        // tool_use id → name, for labelling results; also serves as the guard
        // that only results belonging to *this* turn's tool calls are emitted.
        const toolNamesById = new Map<string, string>();
        // streaming block index → tool_use id, for input-delta attribution
        const toolIdsByBlockIndex = new Map<number, string>();

        try {
            const response = query({
                prompt,
                options: {
                    ...await this.buildBaseOptions(config),
                    systemPrompt: this.composeSystemPrompt(messages, config),
                    model,
                    resume,
                    includePartialMessages: true,
                    maxTurns: MAX_TURNS,
                    abortController
                }
            });

            for await (const message of response) {
                sessionId = takeSessionId(message) ?? sessionId;

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
                                model: modelDisplayName
                            }
                        };
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
            abortController.abort();
        }
    }

    async generateTitle(firstMessage: string): Promise<string> {
        try {
            const response = query({
                prompt: `Generate a short title (at most 5 words) summarizing this chat message. Reply with only the title, no quotes or punctuation around it:\n\n${firstMessage.substring(0, 500)}`,
                options: {
                    ...await this.buildBaseOptions({ enableNoteTools: false }),
                    systemPrompt: "You generate short, descriptive titles. Reply with only the title text — no quotes, no punctuation around it.",
                    model: TITLE_MODEL,
                    maxTurns: 1,
                    persistSession: false
                }
            });

            for await (const message of response) {
                if (message.type === "result" && message.subtype === "success") {
                    return message.result.trim().replace(/^["']|["']$/g, "").substring(0, 100);
                }
            }
        } catch (error) {
            getLog().error(`Claude Agent title generation failed: ${describeAgentError(error)}`);
        }
        return "";
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

    /** Options shared by every agent invocation. */
    private async buildBaseOptions(config: Pick<LlmProviderConfig, "enableNoteTools" | "enableWebSearch" | "enableExtendedThinking">): Promise<AgentOptions> {
        // Built-in Claude Code tools (file access, bash, …) stay disabled — the
        // agent runs on the server host and must only ever touch notes. Web
        // search is the one opt-in exception.
        const builtinTools = config.enableWebSearch ? ["WebSearch", "WebFetch"] : [];
        const allowedTools = [...builtinTools];

        const options: AgentOptions = {
            // Bring-your-own-binary: the SDK's bundled native binary is stripped
            // at install time; drive the user's own installed Claude Code CLI.
            pathToClaudeCodeExecutable: await resolveClaudeBinaryPath(),
            cwd: getAgentCwd(),
            tools: builtinTools,
            settingSources: [],
            strictMcpConfig: true,
            permissionMode: "dontAsk",
            // Extended thinking: `adaptive` lets these (modern) models decide how
            // much to think and stream summarized reasoning, mirroring the metered
            // Anthropic provider. Adaptive is the SDK's default for supporting
            // models, so the toggle's meaningful effect is the disabled path.
            thinking: config.enableExtendedThinking
                ? { type: "adaptive", display: "summarized" }
                : { type: "disabled" }
        };

        if (areNoteToolsAvailable(config)) {
            // In-process MCP: hand the agent Trilium's own MCP server instance
            // (the same one createMcpServer builds for the /mcp HTTP endpoint,
            // with cls.init + sql.transactional wrapping baked in). The SDK
            // tunnels tool calls from the CLI subprocess back to this instance
            // over its stdio control channel — no localhost HTTP endpoint, no
            // open port, and no dependency on the user-facing `mcpEnabled`
            // toggle (which exists to expose notes to *external* clients).
            options.mcpServers = {
                trilium: { type: "sdk", name: "trilium", instance: createMcpServer() }
            };
            // Bare server prefix auto-allows every tool from that server.
            allowedTools.push("mcp__trilium");
        }

        options.allowedTools = allowedTools;
        return options;
    }
}

/**
 * Whether the chat requested note tools. With in-process MCP the tools have no
 * external dependency, so this is simply the chat toggle — the tool wiring and
 * the system prompt both gate on it so they never disagree.
 */
function areNoteToolsAvailable(config: Pick<LlmProviderConfig, "enableNoteTools">): boolean {
    return config.enableNoteTools !== false;
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

/** Strip the MCP prefix so the client shows "search_notes", not "mcp__trilium__search_notes". */
function friendlyToolName(name: string): string {
    return name.replace(/^mcp__trilium__/, "");
}

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
