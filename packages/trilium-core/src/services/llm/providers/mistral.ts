import { createMistral, type MistralProvider as MistralSDKProvider } from "@ai-sdk/mistral";
import type { LlmReasoningEffort } from "@triliumnext/commons";
import type { LanguageModel, ToolSet } from "ai";
import { t } from "i18next";

import type { LlmProviderConfig, ModelInfo } from "../types.js";
import { BaseProvider, type RemoteModel } from "./base_provider.js";
import { llmFetch } from "./fetch.js";

const OFFICIAL_BASE_URL = "https://api.mistral.ai/v1";

/**
 * Model-id prefixes of Mistral's image-reading chat models: the Pixtral line and the
 * Large/Medium/Small chat lines. GLM models served on the API are text-only.
 */
const MISTRAL_VISION_MODELS = [ "pixtral-", "mistral-large", "mistral-medium", "mistral-small" ];

/**
 * Mistral models that support reasoning with `reasoning_effort` parameter.
 * These models return thinking chunks when reasoning is enabled.
 */
const MISTRAL_REASONING_MODELS = [
    "mistral-small-2603",
    "mistral-small-4",
    "mistral-medium-3-5",
    "mistral-medium-3-5-26-04",
    "mistral-large-4",
    "mistral-large-4-0",
    "zai-glm-5-3",
    "zai-glm-5-3-flash"
];

/**
 * The reasoning efforts supported by Mistral models, weakest first.
 * Mistral Small and Medium support: none, high
 * Mistral Large 4 supports: low, medium, high
 * GLM 5.3 supports: low, high, max (no none)
 */
const MISTRAL_REASONING_EFFORTS = [ "none", "low", "medium", "high", "max" ] as const satisfies LlmReasoningEffort[];
type MistralReasoningEffort = (typeof MISTRAL_REASONING_EFFORTS)[number];

/**
 * Default reasoning effort for Mistral models that support it.
 * Mistral Large 4 defaults to "high" per Mistral's documentation.
 */
const DEFAULT_REASONING_EFFORT: MistralReasoningEffort = "high";

/**
 * Models that support reasoning and their specific supported efforts.
 * Mistral Small 4 and Medium 3.5: none, high
 * Mistral Large 4: low, medium, high
 * GLM 5.3 and 5.3 Flash: low, high, max
 */
const MODEL_REASONING_EFFORTS: Record<string, LlmReasoningEffort[]> = {
    "mistral-small-2603": ["none", "high"],
    "mistral-small-4": ["none", "high"],
    "mistral-medium-3-5": ["none", "high"],
    "mistral-medium-3-5-26-04": ["none", "high"],
    "mistral-large-4": ["low", "medium", "high"],
    "mistral-large-4-0": ["low", "medium", "high"],
    "zai-glm-5-3": ["low", "high", "max"],
    "zai-glm-5-3-flash": ["low", "high", "max"]
};

/**
 * Mistral AI provider using the official Mistral API.
 * Supports both standard chat models and reasoning-enabled models.
 */
export class MistralProvider extends BaseProvider {
    name = "mistral";
    protected defaultModel = "mistral-large-4";
    protected titleModel = "mistral-small-4";

    private mistral: MistralSDKProvider;

    constructor(apiKey: string, baseURL?: string) {
        super(apiKey, baseURL);
        if (!apiKey) {
            throw new Error("API key is required for Mistral provider");
        }
        this.mistral = createMistral({ apiKey, ...(baseURL && { baseURL }), fetch: llmFetch });
    }

    protected createModel(modelId: string): LanguageModel {
        return this.mistral.chat(modelId);
    }

    /** Friendly display names for the price-table list and the endpoint's unnamed entries. */
    protected override modelName(id: string): string {
        return mistralModelName(id);
    }

    /**
     * List models from the Mistral API. Only chat-capable models are kept.
     */
    protected override async fetchRemoteModels(): Promise<RemoteModel[] | null> {
        const payload = await this.fetchJson(`${this.baseURL ?? OFFICIAL_BASE_URL}/models`, {
            Authorization: `Bearer ${this.apiKey}`
        });
        const data = (payload as { data?: unknown }).data;
        if (!Array.isArray(data)) {
            throw new Error(t("llm_providers.unexpected_models_response"));
        }
        return data
            .filter((m): m is { id: string; object?: string; created?: number; context_length?: number } =>
                typeof (m as { id?: unknown }).id === "string")
            .filter(m => isMistralChatModel(m.id))
            .map(m => ({
                id: m.id,
                name: mistralModelName(m.id),
                contextWindow: m.context_length
            }));
    }

    /**
     * Adds reasoning effort information to models that support it.
     */
    override async listModels(): Promise<ModelInfo[]> {
        const models = await super.listModels();
        return models.map(model => {
            const efforts = MODEL_REASONING_EFFORTS[model.id];
            if (efforts) {
                return {
                    ...model,
                    reasoningEfforts: [...efforts],
                    defaultReasoningEffort: efforts.includes("high") ? "high" : efforts[0]
                };
            }
            return model;
        });
    }

    /**
     * Sends the reasoning_effort parameter for models that support it.
     * Mistral uses `reasoning_effort` instead of OpenAI's reasoning parameter.
     */
    protected override chatProviderOptions(config: LlmProviderConfig) {
        const modelId = config.model || this.defaultModel;
        const efforts = MODEL_REASONING_EFFORTS[modelId];
        
        if (!efforts) {
            // Model doesn't support reasoning
            return undefined;
        }

        // For models that don't support "none" (Large 4, GLM), convert to "low"
        if (config.reasoningEffort === "none" && !efforts.includes("none")) {
            return { mistral: { reasoningEffort: "low" } };
        }
        
        // Find the effort level from config, falling back to model's default
        const effort = efforts.find(level => level === config.reasoningEffort)
            ?? (efforts.includes("high") ? "high" as LlmReasoningEffort : efforts[0]);
        
        return { mistral: { reasoningEffort: effort } };
    }

    /**
     * Mistral's chat models read images natively; GLM models served on the API are text-only.
     */
    protected override acceptsAttachment(kind: "image" | "file", modelId: string): boolean {
        return kind === "image" && MISTRAL_VISION_MODELS.some(prefix => modelId.startsWith(prefix));
    }

    /**
     * Recommend the newest Mistral models that support reasoning.
     */
    override recommendedModelIds(models: ModelInfo[]): Set<string> {
        // Prefer Mistral Large 4, then Medium 3.5, then Small 4
        const preferred = ["mistral-large-4", "mistral-large-4-0", "mistral-medium-3-5", "mistral-medium-3-5-26-04", "mistral-small-4", "mistral-small-2603"];
        const preferredSet = new Set(preferred);
        return new Set(models.filter(m => preferredSet.has(m.id) && !m.isLegacy).map(m => m.id));
    }
}

/**
 * Friendly display name for a Mistral model id.
 */
export function mistralModelName(id: string): string {
    // Handle dated variants
    if (id === "mistral-medium-3-5-26-04") {
        return "Mistral Medium 3.5 (26-04)";
    }
    
    // Handle GLM models
    if (id.startsWith("zai-glm-")) {
        const version = id.replace("zai-glm-", "");
        return `GLM ${version.split("-").join(" ").toUpperCase()}`;
    }
    
    // Handle standard Mistral models
    const match = /^mistral-(\w+?)(?:-(\d+(?:[.-]\d+)*))?$/.exec(id);
    if (match) {
        const [, tier, version] = match;
        const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);
        const versionStr = version ? ` ${version.replace(/-/g, ".")}` : "";
        return `Mistral ${tierName}${versionStr}`;
    }
    
    return id;
}

/**
 * Whether a model id is a Mistral chat model (not embedding, etc.).
 */
export function isMistralChatModel(id: string): boolean {
    // Mistral chat models start with mistral- or zai-glm-
    if (/^(mistral-|zai-glm-)/.test(id)) {
        // Exclude known non-chat models
        const nonChat = /embedding|instruct/i;
        if (nonChat.test(id)) {
            return false;
        }
        return true;
    }
    return false;
}
