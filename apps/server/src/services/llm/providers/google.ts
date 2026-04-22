import { createGoogleGenerativeAI, type GoogleGenerativeAIProvider } from "@ai-sdk/google";
import { streamText, stepCountIs, type ToolSet } from "ai";
import type { LlmMessage } from "@triliumnext/commons";

import type { LlmProviderConfig, StreamResult } from "../types.js";
import { BaseProvider, buildModelList } from "./base_provider.js";

/**
 * Available Google Gemini models with pricing (USD per million tokens).
 * Source: https://ai.google.dev/gemini-api/docs/pricing
 */
const { models: AVAILABLE_MODELS, pricing: MODEL_PRICING } = buildModelList([
    // ===== Current Models =====
    {
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        pricing: { input: 1.25, output: 10 },
        contextWindow: 1048576
    },
    {
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        pricing: { input: 0.3, output: 2.5 },
        contextWindow: 1048576,
        isDefault: true
    },
    {
        id: "gemini-2.5-flash-lite",
        name: "Gemini 2.5 Flash-Lite",
        pricing: { input: 0.1, output: 0.4 },
        contextWindow: 1048576
    },
    {
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash",
        pricing: { input: 0.1, output: 0.4 },
        contextWindow: 1048576,
        isLegacy: true
    }
]);

export class GoogleProvider extends BaseProvider {
    name = "google";
    protected defaultModel = "gemini-2.5-flash";
    protected titleModel = "gemini-2.5-flash-lite";
    protected availableModels = AVAILABLE_MODELS;
    protected modelPricing = MODEL_PRICING;

    private google: GoogleGenerativeAIProvider;

    constructor(apiKey: string) {
        super();
        if (!apiKey) {
            throw new Error("API key is required for Google provider");
        }
        this.google = createGoogleGenerativeAI({ apiKey });
    }

    protected createModel(modelId: string) {
        return this.google(modelId);
    }

    protected override addWebSearchTool(tools: ToolSet): void {
        tools.google_search = this.google.tools.googleSearch({});
    }

    /**
     * Override chat to add Google-specific extended thinking support.
     * Gemini 2.5 uses thinkingBudget, Gemini 3.x uses thinkingLevel.
     */
    override chat(messages: LlmMessage[], config: LlmProviderConfig): StreamResult {
        if (!config.enableExtendedThinking) {
            return super.chat(messages, config);
        }

        const systemPrompt = this.buildSystemPrompt(messages, config);
        const chatMessages = messages.filter(m => m.role !== "system");
        const coreMessages = this.buildMessages(chatMessages, systemPrompt);

        const streamOptions: Parameters<typeof streamText>[0] = {
            model: this.createModel(config.model || this.defaultModel),
            messages: coreMessages,
            maxOutputTokens: config.maxTokens || 8096,
            providerOptions: {
                google: {
                    thinkingConfig: {
                        thinkingBudget: config.thinkingBudget || 10000
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
