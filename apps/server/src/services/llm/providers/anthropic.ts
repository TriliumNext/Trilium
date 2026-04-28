import { createAnthropic, type AnthropicProvider as AnthropicSDKProvider } from "@ai-sdk/anthropic";
import { stepCountIs, streamText, type ModelMessage, type ToolSet } from "ai";
import type { LlmMessage } from "@triliumnext/commons";

import type { LlmProviderConfig, StreamResult } from "../types.js";
import { BaseProvider, buildModelList } from "./base_provider.js";

/**
 * Available Anthropic models with pricing (USD per million tokens).
 * Source: https://docs.anthropic.com/en/docs/about-claude/models
 */
const { models: AVAILABLE_MODELS, pricing: MODEL_PRICING } = buildModelList([
    // ===== Current Models =====
    {
        id: "claude-opus-4-7",
        name: "Claude Opus 4.7",
        pricing: { input: 5, output: 25 },
        contextWindow: 1000000
    },
    {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
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
    protected defaultModel = "claude-sonnet-4-6";
    protected titleModel = "claude-haiku-4-5-20251001";
    protected availableModels = AVAILABLE_MODELS;
    protected modelPricing = MODEL_PRICING;

    private anthropic: AnthropicSDKProvider;

    constructor(apiKey: string) {
        super();
        if (!apiKey) {
            throw new Error("API key is required for Anthropic provider");
        }
        this.anthropic = createAnthropic({ apiKey });
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
     * Override buildMessages to add Anthropic-specific cache control breakpoints.
     */
    protected override buildMessages(chatMessages: LlmMessage[], systemPrompt: string | undefined): ModelMessage[] {
        const CACHE_CONTROL = { anthropic: { cacheControl: { type: "ephemeral" as const } } };
        const coreMessages: ModelMessage[] = [];

        if (systemPrompt) {
            coreMessages.push({
                role: "system",
                content: systemPrompt,
                providerOptions: CACHE_CONTROL
            });
        }

        for (let i = 0; i < chatMessages.length; i++) {
            const m = chatMessages[i];
            const isLastBeforeNewTurn = i === chatMessages.length - 2;
            // Anthropic rejects empty text content blocks. Replace empty
            // content (e.g. tool-only assistant turns) with a placeholder
            // to preserve conversation flow.
            const content = m.content || "(tool use)";
            coreMessages.push({
                role: m.role as "user" | "assistant",
                content,
                ...(isLastBeforeNewTurn && { providerOptions: CACHE_CONTROL })
            });
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
        const chatMessages = messages.filter(m => m.role !== "system");
        const coreMessages = this.buildMessages(chatMessages, systemPrompt);

        const thinkingBudget = config.thinkingBudget || 10000;
        const maxTokens = Math.max(config.maxTokens || 8096, thinkingBudget + 4000);

        const streamOptions: Parameters<typeof streamText>[0] = {
            model: this.createModel(config.model || this.defaultModel),
            messages: coreMessages,
            maxOutputTokens: maxTokens,
            providerOptions: {
                anthropic: {
                    thinking: {
                        type: "enabled",
                        budgetTokens: thinkingBudget
                    }
                }
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
