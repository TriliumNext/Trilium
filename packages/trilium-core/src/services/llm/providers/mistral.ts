import { createMistral, type MistralProvider as MistralSDKProvider } from "@ai-sdk/mistral";
import type { LlmReasoningEffort } from "@triliumnext/commons";
import type { ToolSet } from "ai";

import type { LlmProviderConfig, ModelInfo } from "../types.js";
import { BaseProvider, type RemoteModel } from "./base_provider.js";
import { llmFetch } from "./fetch.js";

const OFFICIAL_BASE_URL = "https://api.mistral.ai/v1";

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
        this.mistral = createMistral({ apiKey, baseURL: this.baseURL ?? OFFICIAL_BASE_URL, fetch: llmFetch });
    }

    protected createModel(modelId: string) {
        return this.mistral.chat(modelId);
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
            throw new Error("Unexpected /models response shape");
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
     * The fallback list of known Mistral models with curated metadata.
     */
    override getAvailableModels(): ModelInfo[] {
        return [
            { id: "mistral-large-4", name: "Mistral Large 4", isDefault: true, recommended: true },
            { id: "mistral-large-4-0", name: "Mistral Large 4.0", recommended: true },
            { id: "mistral-medium-3-5", name: "Mistral Medium 3.5", recommended: true },
            { id: "mistral-medium-3-5-26-04", name: "Mistral Medium 3.5 (26-04)", recommended: true },
            { id: "mistral-small-4", name: "Mistral Small 4", recommended: true },
            { id: "mistral-small-2603", name: "Mistral Small (2603)", recommended: true },
            { id: "zai-glm-5-3", name: "GLM 5.3", recommended: true },
            { id: "zai-glm-5-3-flash", name: "GLM 5.3 Flash", recommended: true },
            // Legacy models
            { id: "mistral-large-2", name: "Mistral Large 2", isLegacy: true },
            { id: "mistral-large", name: "Mistral Large", isLegacy: true },
            { id: "mistral-medium", name: "Mistral Medium", isLegacy: true },
            { id: "mistral-small", name: "Mistral Small", isLegacy: true },
            { id: "mistral-tiny", name: "Mistral Tiny", isLegacy: true }
        ];
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

        // Find the effort level from config, falling back to model's default
        const effort = efforts.find(level => level === config.reasoningEffort)
            ?? (efforts.includes("high") ? "high" : efforts[0]);
        
        // For GLM models, "none" is not supported - they always reason
        // For Mistral Small/Medium, "none" means no thinking chunk
        // For Mistral Large 4, "none" is not valid - use "low" instead
        const validEffort = !efforts.includes("none") && effort === "none" ? "low" : effort;
        
        return { mistral: { reasoningEffort: validEffort } };
    }

    /**
     * Mistral models support images natively.
     */
    protected override acceptsAttachment(kind: "image" | "file", modelId: string): boolean {
        // Mistral vision models support images
        return kind === "image" && (modelId.includes("vision") || isMistralVisionModel(modelId));
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
        return `GLM ${version.replace("-", " ").toUpperCase()}`;
    }
    
    // Handle standard Mistral models
    const match = /^mistral-(\w+)(?:-(\d+(?:\.\d+)*))?$/.exec(id);
    if (match) {
        const [, tier, version] = match;
        const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);
        const versionStr = version ? ` ${version.replace("-", ".")}` : "";
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

/**
 * Whether a model id is a Mistral vision model.
 */
function isMistralVisionModel(id: string): boolean {
    return id.includes("vision") || id.includes("multimodal");
}
