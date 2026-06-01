import { createGoogleGenerativeAI, type GoogleGenerativeAIProvider } from "@ai-sdk/google";
import { streamText, stepCountIs, type ToolSet } from "ai";
import type { LlmMessage } from "@triliumnext/commons";

import { getLog } from "@triliumnext/core";
import type { LlmProviderConfig, StreamResult } from "../types.js";
import { BaseProvider, buildModelList } from "./base_provider.js";

/**
 * Gemini 2.x models (every model we currently expose) cannot combine
 * provider-defined tools like `googleSearch` with function declarations in a
 * single request — Google's API rejects the combination. Combined tool use is
 * Gemini-3-only and even there is flagged as Preview. When both are requested
 * we silently drop `googleSearch` and keep function tools, since note access
 * is Trilium's higher-value capability and is what the user explicitly toggled.
 */
function geminiHasToolConflict(config: LlmProviderConfig): boolean {
    return !!(config.enableWebSearch && config.enableNoteTools);
}

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

    constructor(apiKey: string, baseURL?: string) {
        super();
        if (!apiKey) {
            throw new Error("API key is required for Google provider");
        }
        this.google = createGoogleGenerativeAI({ apiKey, ...(baseURL && { baseURL }) });
    }

    protected createModel(modelId: string) {
        return this.google(modelId);
    }

    protected override addWebSearchTool(tools: ToolSet): void {
        tools.google_search = this.google.tools.googleSearch({});
    }

    protected override buildTools(config: LlmProviderConfig): ToolSet {
        if (geminiHasToolConflict(config)) {
            getLog().info("Gemini: dropping google_search because note tools are enabled (Google API does not allow combining provider-defined tools with function declarations)");
            return super.buildTools({ ...config, enableWebSearch: false });
        }
        return super.buildTools(config);
    }

    protected override buildSystemPrompt(messages: LlmMessage[], config: LlmProviderConfig): string | undefined {
        const basePrompt = super.buildSystemPrompt(messages, config);
        if (!geminiHasToolConflict(config) || !basePrompt) {
            return basePrompt;
        }
        return `${basePrompt}\n\nNote: web search is unavailable in this turn because note tools are enabled — Google's Gemini API does not allow combining the two. If the user asks you to search the web, tell them they need to either switch to a different provider (OpenAI/Anthropic) or disable note tools.`;
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
        const chatMessages = this.applyNoteHint(messages.filter(m => m.role !== "system"), config);
        const coreMessages = this.buildMessages(chatMessages);

        const streamOptions: Parameters<typeof streamText>[0] = {
            model: this.createModel(config.model || this.defaultModel),
            system: this.buildSystemMessage(systemPrompt),
            messages: coreMessages,
            maxOutputTokens: config.maxTokens || 8096,
            // Reject any system message smuggled into `messages` (prompt injection guard).
            allowSystemInMessages: false,
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
