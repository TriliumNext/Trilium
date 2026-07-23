import { type AnthropicProvider as AnthropicSDKProvider,createAnthropic } from "@ai-sdk/anthropic";
import type { LlmMessage } from "@triliumnext/commons";
import { type ModelMessage, stepCountIs, streamText, type SystemModelMessage, type ToolSet } from "ai";

import type { LlmProviderConfig, ModelInfo, StreamResult } from "../types.js";
import { BaseProvider, buildModelMessage, type RemoteModel } from "./base_provider.js";

const OFFICIAL_BASE_URL = "https://api.anthropic.com/v1";

/** Anthropic ephemeral prompt-caching breakpoint. */
const CACHE_CONTROL = { anthropic: { cacheControl: { type: "ephemeral" as const } } };

/**
 * Models that support adaptive extended thinking. Opus 4.7 / 4.8 and Sonnet 5
 * reject the manual `{ type: "enabled", budgetTokens }` form with a 400 and
 * accept adaptive only; Opus 4.6 and Sonnet 4.6 accept both but prefer adaptive.
 * Everything else (older Opus/Sonnet, Haiku 4.5) only supports the manual budget
 * form.
 */
const ADAPTIVE_THINKING_MODELS = /^claude-(?:opus-4-[678]|sonnet-(?:4-6|5))/;

export class AnthropicProvider extends BaseProvider {
    name = "anthropic";
    protected defaultModel = "claude-sonnet-5";
    protected titleModel = "claude-haiku-4-5-20251001";

    private anthropic: AnthropicSDKProvider;

    constructor(apiKey: string, baseURL?: string) {
        super(apiKey, baseURL);
        if (!apiKey) {
            throw new Error("API key is required for Anthropic provider");
        }
        this.anthropic = createAnthropic({ apiKey, ...(baseURL && { baseURL }) });
    }

    protected createModel(modelId: string) {
        return this.anthropic(modelId);
    }

    /** List models from Anthropic's `/models` endpoint (all are chat models). */
    protected override async fetchRemoteModels(): Promise<RemoteModel[] | null> {
        const payload = await this.fetchJson(`${this.baseURL ?? OFFICIAL_BASE_URL}/models?limit=1000`, {
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01"
        });
        const data = (payload as { data?: unknown }).data;
        if (!Array.isArray(data)) {
            throw new Error("Unexpected /models response shape");
        }
        return data
            .filter((m): m is { id: string; display_name?: string } => typeof (m as { id?: unknown }).id === "string")
            .map(m => ({ id: m.id, name: m.display_name }));
    }

    protected override addWebSearchTool(tools: ToolSet): void {
        tools.web_search = this.anthropic.tools.webSearch_20250305({
            maxUses: 5
        });
    }

    override recommendedModelIds(models: ModelInfo[]): Set<string> {
        return anthropicRecommendedIds(models);
    }

    /**
     * Override buildSystemMessage to add an Anthropic cache control breakpoint
     * on the system prompt.
     */
    protected override buildSystemMessage(systemPrompt: string | undefined): SystemModelMessage | undefined {
        if (!systemPrompt) {
            return undefined;
        }

        return {
            role: "system",
            content: systemPrompt,
            providerOptions: CACHE_CONTROL
        };
    }

    /**
     * Override buildMessages to add Anthropic-specific cache control breakpoints.
     */
    protected override buildMessages(chatMessages: LlmMessage[]): ModelMessage[] {
        const coreMessages: ModelMessage[] = [];

        for (let i = 0; i < chatMessages.length; i++) {
            const m = chatMessages[i];
            const isLastBeforeNewTurn = i === chatMessages.length - 2;
            // Anthropic rejects empty text content blocks. For purely-empty
            // string content (e.g. tool-only assistant turns), substitute a
            // placeholder so the turn still has a body.
            const normalized: LlmMessage = (typeof m.content === "string" && !m.content)
                ? { ...m, content: "(tool use)" }
                : m;
            const base = buildModelMessage(normalized);
            coreMessages.push(
                isLastBeforeNewTurn
                    ? { ...base, providerOptions: CACHE_CONTROL }
                    : base
            );
        }

        return coreMessages;
    }

    /**
     * Override chat to add Anthropic-specific extended thinking support.
     */
    override chat(messages: LlmMessage[], config: LlmProviderConfig): StreamResult {
        if (!config.enableExtendedThinking) {
            return super.chat(messages, config);
        }

        const systemPrompt = this.buildSystemPrompt(messages, config);
        const chatMessages = this.applyNoteHint(messages.filter(m => m.role !== "system"), config);
        const coreMessages = this.buildMessages(chatMessages);

        const model = config.model || this.defaultModel;
        const thinkingBudget = config.thinkingBudget || 10000;
        const maxTokens = Math.max(config.maxTokens || 8096, thinkingBudget + 4000);

        // Adaptive-capable models let Claude decide depth (and stream visible
        // reasoning via `display: "summarized"`); older models take a manual budget.
        const thinking = ADAPTIVE_THINKING_MODELS.test(model)
            ? { type: "adaptive" as const, display: "summarized" as const }
            : { type: "enabled" as const, budgetTokens: thinkingBudget };

        const streamOptions: Parameters<typeof streamText>[0] = {
            model: this.createModel(model),
            system: this.buildSystemMessage(systemPrompt),
            messages: coreMessages,
            maxOutputTokens: maxTokens,
            // Reject any system message smuggled into `messages` (prompt injection guard).
            allowSystemInMessages: false,
            providerOptions: {
                anthropic: { thinking }
            }
        };

        const tools = this.buildTools(config);
        if (Object.keys(tools).length > 0) {
            streamOptions.tools = tools;
            streamOptions.stopWhen = stepCountIs(5);
            streamOptions.toolChoice = "auto";
        }

        return streamText(streamOptions);
    }
}

/**
 * Anthropic model id shape: `claude-<family>-<major>[-<minor>][-<YYYYMMDD>]`.
 * The optional trailing 8-digit snapshot date is not part of the version —
 * `claude-sonnet-4-20250514` is Sonnet 4.0, not 4.20250514 — so the minor
 * group is capped at two digits to force the date into the snapshot group.
 */
const ANTHROPIC_MODEL = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/;

/**
 * Recommend the newest version within each Claude family (Opus, Sonnet, Haiku,
 * Fable, and any future one) — one model per family, so today's Opus 4.8,
 * Sonnet 5, Haiku 4.5 and Fable 5. Older revisions and dated snapshots stay in
 * the picker, unchecked.
 *
 * Exported because the Claude Code subscription provider serves the same
 * `claude-*` catalog and must apply the same rule, without inheriting from
 * {@link AnthropicProvider} (it runs the Agent SDK, not the AI SDK).
 */
export function anthropicRecommendedIds(models: ModelInfo[]): Set<string> {
    const byFamily = new Map<string, { id: string; version: number }[]>();
    for (const model of models) {
        const parsed = parseAnthropicModel(model.id);
        if (!parsed) {
            continue;
        }
        const members = byFamily.get(parsed.family) ?? [];
        members.push({ id: model.id, version: parsed.version });
        byFamily.set(parsed.family, members);
    }
    const recommended = new Set<string>();
    for (const members of byFamily.values()) {
        // Strict `>` so the earliest listed model wins a version tie.
        const newest = members.reduce((best, m) => (m.version > best.version ? m : best));
        recommended.add(newest.id);
    }
    return recommended;
}

/**
 * `claude-opus-4-8` → `{ family: "opus", version: 4.8 }`, `claude-sonnet-5` →
 * version 5, `claude-sonnet-4-20250514` → version 4 (the trailing date is a
 * snapshot, not a minor). Null for ids outside the `claude-<family>-<version>`
 * shape, which the caller skips.
 *
 * Family and version are parsed together so the regex runs once per model
 * rather than again on both sides of every version comparison.
 */
function parseAnthropicModel(id: string): { family: string; version: number } | null {
    const match = ANTHROPIC_MODEL.exec(id);
    if (!match) {
        return null;
    }
    const [, family, major, minor] = match;
    return { family, version: parseFloat(minor ? `${major}.${minor}` : major) };
}
