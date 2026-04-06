/**
 * Ollama provider — uses the OpenAI-compatible API that Ollama exposes.
 *
 * Because Ollama runs locally with a dynamic model list, this provider
 * fetches available models from the Ollama instance at runtime instead
 * of using a hardcoded list.
 */

import { createOpenAI, type OpenAIProvider as OpenAISDKProvider } from "@ai-sdk/openai";

import log from "../../log.js";
import { BaseProvider } from "./base_provider.js";
import type { ModelInfo, ModelPricing } from "../types.js";

const DEFAULT_BASE_URL = "http://localhost:11434";

/** Ollama models are local and free. */
const FREE_PRICING: ModelPricing = { input: 0, output: 0 };

/**
 * Shape of the Ollama `/api/tags` response.
 * See https://github.com/ollama/ollama/blob/main/docs/api.md#list-local-models
 */
interface OllamaTagsResponse {
    models: Array<{
        name: string;
        model: string;
        modified_at?: string;
        size?: number;
        digest?: string;
        details?: {
            parent_model?: string;
            format?: string;
            family?: string;
            families?: string[];
            parameter_size?: string;
            quantization_level?: string;
        };
    }>;
}

/**
 * Parse a parameter_size string like "7.6B" or "3.2B" into a number of billions.
 * Returns undefined if the string cannot be parsed.
 */
function parseParamSize(paramSize?: string): number | undefined {
    if (!paramSize) return undefined;
    const match = paramSize.match(/^([\d.]+)\s*([BMK])/i);
    if (!match) return undefined;
    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    if (unit === "B") return value;
    if (unit === "M") return value / 1000;
    if (unit === "K") return value / 1_000_000;
    return undefined;
}

/**
 * Build a human-readable display name from Ollama model metadata.
 * Example: "llama3.2:latest" → "llama3.2:latest (3.2B, Q4_K_M)"
 */
function formatModelName(m: OllamaTagsResponse["models"][number]): string {
    const parts: string[] = [];
    if (m.details?.parameter_size) {
        parts.push(m.details.parameter_size);
    }
    if (m.details?.quantization_level) {
        parts.push(m.details.quantization_level);
    }
    if (parts.length > 0) {
        return `${m.name} (${parts.join(", ")})`;
    }
    return m.name;
}

export class OllamaProvider extends BaseProvider {
    name = "ollama";
    protected defaultModel = "";
    protected titleModel = "";
    protected availableModels: ModelInfo[] = [];
    protected modelPricing: Record<string, ModelPricing> = {};

    private openai: OpenAISDKProvider;
    private baseUrl: string;
    private modelsLoaded = false;

    constructor(baseUrl?: string) {
        super();
        this.baseUrl = baseUrl || DEFAULT_BASE_URL;

        // Ollama exposes an OpenAI-compatible endpoint at /v1
        this.openai = createOpenAI({
            apiKey: "ollama", // Ollama ignores this but the SDK requires it
            baseURL: `${this.baseUrl}/v1`
        });
    }

    protected createModel(modelId: string) {
        return this.openai(modelId);
    }

    override getAvailableModels(): ModelInfo[] {
        if (!this.modelsLoaded) {
            // Synchronously return whatever we have; the route handler
            // calls loadModels() async before returning.
            return this.availableModels;
        }
        return this.availableModels;
    }

    /**
     * Fetch available models from the Ollama instance.
     * Called by the route handler before returning models to the client.
     */
    async loadModels(): Promise<ModelInfo[]> {
        try {
            const res = await fetch(`${this.baseUrl}/api/tags`, {
                signal: AbortSignal.timeout(5000)
            });
            if (!res.ok) {
                log.error(`Ollama: failed to fetch models (${res.status})`);
                return [];
            }

            const data = (await res.json()) as OllamaTagsResponse;
            this.availableModels = data.models.map((m, i) => ({
                id: m.name,
                name: formatModelName(m),
                pricing: FREE_PRICING,
                costMultiplier: 0,
                isDefault: i === 0
            }));

            this.modelPricing = Object.fromEntries(
                this.availableModels.map((m) => [m.id, FREE_PRICING])
            );

            if (this.availableModels.length > 0) {
                this.defaultModel = this.availableModels[0].id;
                // Prefer smaller model for titles if available (under 4B params)
                const smallModel = data.models.find((m) => {
                    const size = parseParamSize(m.details?.parameter_size);
                    return size !== undefined && size < 4;
                }) ?? data.models.find((m) =>
                    /small|mini|tiny|phi|gemma.*2b/i.test(m.name)
                );
                this.titleModel = smallModel?.name || this.defaultModel;
            }

            this.modelsLoaded = true;
            return this.availableModels;
        } catch (e) {
            log.error(`Ollama: failed to connect to ${this.baseUrl}: ${e}`);
            return [];
        }
    }
}
