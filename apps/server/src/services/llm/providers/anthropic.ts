import { type AnthropicProvider as AnthropicSDKProvider,createAnthropic } from "@ai-sdk/anthropic";
import type { LlmMessage } from "@triliumnext/commons";
import { type ModelMessage, stepCountIs, streamText, type SystemModelMessage, type ToolSet } from "ai";

import type { LlmProviderConfig, StreamResult } from "../types.js";
import { BaseProvider, buildModelList, buildModelMessage } from "./base_provider.js";

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

/**
 * Available Anthropic models with pricing (USD per million tokens).
 * Source: https://docs.anthropic.com/en/docs/about-claude/models
 */
const { models: AVAILABLE_MODELS, pricing: MODEL_PRICING } = buildModelList([
    // ===== Current Models =====
    {
        id: "claude-opus-4-8",
        name: "Claude Opus 4.8",
        pricing: { input: 5, output: 25 },
        contextWindow: 1000000
    },
    {
        id: "claude-opus-4-7",
        name: "Claude Opus 4.7",
        pricing: { input: 5, output: 25 },
        contextWindow: 1000000
    },
    {
        id: "claude-sonnet-5",
        name: "Claude Sonnet 5",
        // Standard pricing. Introductory $2/$10 per MTok applies through 2026-08-31.
        pricing: { input: 3, output: 15 },
        contextWindow: 1000000,
        isDefault: true
    },
    {
        id: "claude-haiku-4-5-20251001",
        name: "Claude Haiku 4.5",
        pricing: { input: 1, output: 5 },
        contextWindow: 200000
    },
    // ===== Legacy Models =====
    {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        pricing: { input: 3, output: 15 },
        contextWindow: 1000000,
        isLegacy: true
    },
    {
        id: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        pricing: { input: 5, output: 25 },
        contextWindow: 1000000,
        isLegacy: true
    },
    {
        id: "claude-sonnet-4-5-20250929",
        name: "Claude Sonnet 4.5",
        pricing: { input: 3, output: 15 },
        contextWindow: 200000,
        isLegacy: true
    },
    {
        id: "claude-opus-4-5-20251101",
        name: "Claude Opus 4.5",
        pricing: { input: 5, output: 25 },
        contextWindow: 200000,
        isLegacy: true
    },
    {
        id: "claude-opus-4-1-20250805",
        name: "Claude Opus 4.1",
        pricing: { input: 15, output: 75 },
        contextWindow: 200000,
        isLegacy: true
    },
    {
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet 4.0",
        pricing: { input: 3, output: 15 },
        contextWindow: 200000,
        isLegacy: true
    },
    {
        id: "claude-opus-4-20250514",
        name: "Claude Opus 4.0",
        pricing: { input: 15, output: 75 },
        contextWindow: 200000,
        isLegacy: true
    }
]);

export class AnthropicProvider extends BaseProvider {
    name = "anthropic";
    protected defaultModel = "claude-sonnet-5";
    protected titleModel = "claude-haiku-4-5-20251001";
    protected availableModels = AVAILABLE_MODELS;
    protected modelPricing = MODEL_PRICING;

    private anthropic: AnthropicSDKProvider;

    constructor(apiKey: string, baseURL?: string) {
        super();
        if (!apiKey) {
            throw new Error("API key is required for Anthropic provider");
        }
        this.anthropic = createAnthropic({ apiKey, ...(baseURL && { baseURL }) });
    }

    protected createModel(modelId: string) {
        return this.anthropic(modelId);
    }

    protected override addWebSearchTool(tools: ToolSet): void {
        tools.web_search = this.anthropic.tools.webSearch_20250305({
            maxUses: 5
        });
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
