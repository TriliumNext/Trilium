import { createGoogleGenerativeAI, type GoogleGenerativeAIProvider } from "@ai-sdk/google";
import type { LlmMessage } from "@triliumnext/commons";
import { getLog } from "@triliumnext/core";
import { stepCountIs, streamText, type ToolSet } from "ai";

import type { LlmProviderConfig, StreamResult } from "../types.js";
import { BaseProvider, type RemoteModel } from "./base_provider.js";

const OFFICIAL_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

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

export class GoogleProvider extends BaseProvider {
    name = "google";
    protected defaultModel = "gemini-2.5-flash";
    protected titleModel = "gemini-2.5-flash-lite";

    private google: GoogleGenerativeAIProvider;

    constructor(apiKey: string, baseURL?: string) {
        super(apiKey, baseURL);
        if (!apiKey) {
            throw new Error("API key is required for Google provider");
        }
        this.google = createGoogleGenerativeAI({ apiKey, ...(baseURL && { baseURL }) });
    }

    protected createModel(modelId: string) {
        return this.google(modelId);
    }

    /**
     * List models from the Gemini API. Only `generateContent`-capable models
     * are kept (the endpoint also lists embedding/imagen/veo models), and the
     * `models/` id prefix is stripped to match what `createModel` expects.
     */
    protected override async fetchRemoteModels(): Promise<RemoteModel[] | null> {
        const payload = await this.fetchJson(`${this.baseURL ?? OFFICIAL_BASE_URL}/models?pageSize=1000`, {
            "x-goog-api-key": this.apiKey
        });
        const models = (payload as { models?: unknown }).models;
        if (!Array.isArray(models)) {
            throw new Error("Unexpected /models response shape");
        }
        return models
            .filter((m): m is { name: string; displayName?: string; inputTokenLimit?: number; supportedGenerationMethods?: string[] } =>
                typeof (m as { name?: unknown }).name === "string")
            .filter(m => m.supportedGenerationMethods?.includes("generateContent"))
            .map(m => ({
                id: m.name.replace(/^models\//, ""),
                name: m.displayName,
                contextWindow: m.inputTokenLimit
            }))
            .filter(m => isGoogleChatModel(m.id));
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

/**
 * Chat-model filter for the Gemini API. The endpoint's `supportedGenerationMethods`
 * is not enough: image (Nano Banana), robotics, computer-use, and speech models
 * all advertise `generateContent` too. Filter by id shape instead:
 *
 * - Only `gemini-*` ids are chat candidates — this drops the non-Gemini
 *   families wholesale (`lyria-*` music, `veo-*` video, `imagen-*`, `gemma-*`
 *   open models, `deep-research-*`, `antigravity-*` agents, embeddings, AQA).
 * - Within `gemini-*`, drop non-conversational variants by token: image
 *   generation, speech (tts/live/native-audio), video (omni), robotics,
 *   computer use, embeddings, and tool-variant builds (custom-tools).
 * - Drop `-latest` rolling aliases and `-NNN` pinned revisions — both are
 *   duplicates of a stable id that is also in the list.
 */
const GOOGLE_NON_CHAT = /image|tts|live|audio|dialog|robotics|computer-use|embedding|omni|custom-?tools/i;

export function isGoogleChatModel(id: string): boolean {
    return /^gemini-/.test(id)
        && !GOOGLE_NON_CHAT.test(id)
        && !/-latest$/.test(id)
        && !/-\d{3}$/.test(id);
}
