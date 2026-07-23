/**
 * Self-hosted LLM provider — the single implementation behind the Ollama, LM
 * Studio and generic "OpenAI-compatible" provider cards.
 *
 * Every local runtime worth supporting (llama.cpp, vLLM, SGLang, LocalAI, Jan,
 * KoboldCpp, llamafile, LiteLLM, …) exposes the OpenAI-compatible `/v1`
 * surface, so that is the chat path in all cases. Two of them additionally
 * serve a *native* model listing carrying metadata `/v1/models` omits — Ollama's
 * `/api/tags` (parameter size, quantization) and LM Studio's `/api/v0/models`
 * (quantization, context length) — so listing probes those first and falls back
 * to `/v1/models` for everything else.
 *
 * The named cards exist only to prefill a URL and a setup hint in the UI; all
 * three dispatch here, and the card id arrives as {@link LocalProviderKind}.
 */

import { createOpenAI, type OpenAIProvider as OpenAISDKProvider } from "@ai-sdk/openai";
import { getLog } from "@triliumnext/core";

import type { ModelInfo, ModelPricing } from "../types.js";
import { BaseProvider, type RemoteModel } from "./base_provider.js";

/** Provider card ids that map to this implementation. */
export type LocalProviderKind = "ollama" | "lmstudio" | "openai-compatible";

/**
 * First-run URL per card. The generic card has none — an arbitrary
 * OpenAI-compatible endpoint cannot be guessed, so its URL is required.
 */
const DEFAULT_BASE_URLS: Record<LocalProviderKind, string | undefined> = {
    ollama: "http://localhost:11434",
    lmstudio: "http://localhost:1234/v1",
    "openai-compatible": undefined
};

/** Models served by a local runtime cost nothing to run. */
const FREE_PRICING: ModelPricing = { input: 0, output: 0 };

/** Sent when the endpoint needs no credential; local runtimes ignore it, the SDK requires it. */
const PLACEHOLDER_API_KEY = "local";

/** Timeout for a single model-listing request. */
const MODEL_LIST_TIMEOUT_MS = 10_000;

/** Below this parameter count (in billions) a model is cheap enough for titles. */
const TITLE_MODEL_MAX_PARAMS_B = 4;

/** Id shapes that suggest a small model, used when no parameter count is reported. */
const SMALL_MODEL_NAME = /small|mini|tiny|phi|gemma.*2b/i;

/** A listed model, plus the parameter count when the endpoint reports one. */
interface LocalModel extends RemoteModel {
    /** Parameter count in billions. */
    paramsB?: number;
}

export class LocalProvider extends BaseProvider {
    name: string;
    // Both are resolved from the live model list — a self-hosted endpoint serves
    // whatever the user installed, so there is nothing sensible to hardcode.
    protected defaultModel = "";
    protected titleModel = "";

    private readonly kind: LocalProviderKind;
    private openai: OpenAISDKProvider;
    /** Canonical endpoint root, without a trailing `/v1`. */
    private root: string;
    /**
     * Whether the models are known to come from a local runtime, and are
     * therefore free to run. The named cards are local by definition; the
     * generic card only counts once a native probe has identified the runtime,
     * since it may equally point at a proxy in front of a metered API.
     */
    private isLocalRuntime: boolean;

    constructor(kind: LocalProviderKind, apiKey = "", baseURL?: string) {
        super(apiKey, baseURL);
        this.kind = kind;
        this.name = kind;
        this.isLocalRuntime = kind !== "openai-compatible";
        this.root = resolveRoot(kind, this.baseURL);

        this.openai = createOpenAI({
            apiKey: apiKey || PLACEHOLDER_API_KEY,
            baseURL: `${this.root}/v1`
        });
    }

    protected createModel(modelId: string) {
        // Use the Chat Completions API explicitly — calling `this.openai(modelId)`
        // defaults to the OpenAI Responses API, which most self-hosted runtimes
        // don't implement (Ollama only since 0.13.3).
        return this.openai.chat(modelId);
    }

    /**
     * List the models the endpoint serves, preferring a native listing for its
     * richer metadata and falling back to the OpenAI-compatible one.
     */
    protected override async fetchRemoteModels(): Promise<RemoteModel[] | null> {
        const models = await this.listNativeModels() ?? await this.listOpenAiCompatibleModels();
        this.pickModelDefaults(models);
        return models;
    }

    /**
     * Models are free when they run locally. The base class would otherwise
     * look the id up in the committed price table, which covers only the
     * metered vendor APIs and never a self-hosted build.
     */
    override async listModels(): Promise<ModelInfo[]> {
        const models = await super.listModels();
        return this.isLocalRuntime
            ? models.map(model => ({ ...model, pricing: FREE_PRICING }))
            : models;
    }

    override getModelPricing(model: string): ModelPricing | undefined {
        return this.isLocalRuntime ? FREE_PRICING : super.getModelPricing(model);
    }

    /**
     * The title model is only known once the endpoint has been listed, so make
     * sure that happened before falling through to the base implementation
     * (which chats with {@link titleModel}). The list is cached by the base
     * class, so this is a no-op after the first call.
     */
    override async generateTitle(firstMessage: string): Promise<string> {
        if (!this.titleModel) {
            await this.listModels();
        }
        return super.generateTitle(firstMessage);
    }

    /**
     * Try the native listing endpoints, skipping the one the selected card
     * rules out. Returns null when neither is served here, so the caller falls
     * back to `/v1/models`.
     */
    private async listNativeModels(): Promise<LocalModel[] | null> {
        if (this.kind !== "lmstudio") {
            const payload = await this.probeJson(`${this.root}/api/tags`);
            const models = payload !== undefined ? parseOllamaTags(payload) : null;
            if (models) {
                this.isLocalRuntime = true;
                return models;
            }
            // The Ollama card pointed at something that answers /api/tags with
            // a foreign payload is a misconfiguration worth reporting, not a
            // reason to silently try the next endpoint.
            if (payload !== undefined && this.kind === "ollama") {
                throw new Error("Unexpected /api/tags response shape");
            }
        }
        if (this.kind !== "ollama") {
            const payload = await this.probeJson(`${this.root}/api/v0/models`);
            const models = payload !== undefined ? parseLmStudioModels(payload) : null;
            if (models) {
                this.isLocalRuntime = true;
                return models;
            }
            if (payload !== undefined && this.kind === "lmstudio") {
                throw new Error("Unexpected /api/v0/models response shape");
            }
        }
        return null;
    }

    /** The universal fallback: the OpenAI-compatible `/v1/models` listing. */
    private async listOpenAiCompatibleModels(): Promise<LocalModel[]> {
        const url = `${this.root}/v1/models`;
        const payload = await this.probeJson(url);
        if (payload === undefined) {
            throw new Error(`No model listing endpoint found at ${this.root} — is this an OpenAI-compatible server?`);
        }
        const data = (payload as { data?: unknown }).data;
        if (!Array.isArray(data)) {
            throw new Error(`Unexpected response shape from ${url}`);
        }
        return data
            .filter((m): m is { id: string } => typeof (m as { id?: unknown }).id === "string")
            .map(m => ({ id: m.id }));
    }

    /**
     * GET a JSON document from a listing endpoint.
     *
     * Returns undefined when the endpoint isn't served here (404/405), which is
     * how the probe chain advances. Everything else throws: an unreachable host
     * or a rejected credential is a real problem the add/edit-provider screen
     * must report, not a reason to keep trying other URLs.
     */
    private async probeJson(url: string): Promise<unknown | undefined> {
        let response: Response;
        try {
            response = await fetch(url, {
                headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
                signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS)
            });
        } catch (e) {
            throw new Error(`Could not reach ${url}: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (response.status === 404 || response.status === 405) {
            return undefined;
        }
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                throw new Error(`Authentication failed (HTTP ${response.status}) — check the API key and base URL.`);
            }
            throw new Error(`HTTP ${response.status} from ${url}`);
        }
        return await response.json();
    }

    /**
     * Remember which model to chat with by default and which to write chat
     * titles with. A self-hosted endpoint has no notion of a default, so the
     * first listed model wins; titles prefer the smallest model available,
     * since they are a throwaway one-liner and a 70B model would make opening a
     * chat sluggish.
     */
    private pickModelDefaults(models: LocalModel[]): void {
        if (models.length === 0) {
            return;
        }
        this.defaultModel = models[0].id;
        const small = models.find(m => m.paramsB !== undefined && m.paramsB < TITLE_MODEL_MAX_PARAMS_B)
            ?? models.find(m => SMALL_MODEL_NAME.test(m.id));
        this.titleModel = small?.id ?? this.defaultModel;
    }
}

/**
 * Canonical endpoint root for a card: the configured URL (validated), or the
 * card's own default, with any trailing `/v1` removed so both spellings a user
 * might enter — `http://localhost:1234` and `http://localhost:1234/v1` — resolve
 * to the same instance. The `/v1` is re-appended for the SDK and the
 * OpenAI-compatible listing; the native listings hang off the root.
 */
function resolveRoot(kind: LocalProviderKind, baseURL: string | undefined): string {
    const fallback = DEFAULT_BASE_URLS[kind];
    if (!baseURL) {
        if (!fallback) {
            throw new Error("A base URL is required for an OpenAI-compatible provider.");
        }
        return stripApiVersion(fallback);
    }
    try {
        const parsed = new URL(baseURL);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            throw new Error(`unsupported protocol ${parsed.protocol}`);
        }
        return stripApiVersion(baseURL);
    } catch (e) {
        if (!fallback) {
            throw new Error(`Invalid base URL "${baseURL}": ${e instanceof Error ? e.message : String(e)}`);
        }
        getLog().error(`${kind}: invalid base URL "${baseURL}" (${e}), falling back to ${fallback}`);
        return stripApiVersion(fallback);
    }
}

/** Trailing slashes are already gone (the base class normalizes them). */
function stripApiVersion(url: string): string {
    return url.endsWith("/v1") ? url.slice(0, -"/v1".length) : url;
}

/**
 * Shape of the Ollama `/api/tags` response.
 * See https://github.com/ollama/ollama/blob/main/docs/api.md#list-local-models
 */
interface OllamaTag {
    name: string;
    details?: {
        parameter_size?: string;
        quantization_level?: string;
    };
}

/** Parse an `/api/tags` payload, or null when it isn't one. */
function parseOllamaTags(payload: unknown): LocalModel[] | null {
    const models = (payload as { models?: unknown }).models;
    if (!Array.isArray(models)) {
        return null;
    }
    const tags = models.filter((m): m is OllamaTag => typeof (m as { name?: unknown }).name === "string");
    if (tags.length !== models.length) {
        return null;
    }
    return tags.map(m => ({
        id: m.name,
        name: describeModel(m.name, [m.details?.parameter_size, m.details?.quantization_level]),
        paramsB: parseParamSize(m.details?.parameter_size)
    }));
}

/**
 * Shape of the LM Studio `/api/v0/models` response — its own richer REST API,
 * alongside the OpenAI-compatible one.
 */
interface LmStudioModel {
    id: string;
    quantization?: string;
    max_context_length?: number;
}

/** Parse an `/api/v0/models` payload, or null when it isn't one. */
function parseLmStudioModels(payload: unknown): LocalModel[] | null {
    const data = (payload as { data?: unknown }).data;
    if (!Array.isArray(data)) {
        return null;
    }
    const models = data.filter((m): m is LmStudioModel => typeof (m as { id?: unknown }).id === "string");
    if (models.length !== data.length) {
        return null;
    }
    return models.map(m => ({
        id: m.id,
        name: describeModel(m.id, [m.quantization]),
        contextWindow: m.max_context_length
    }));
}

/**
 * Build a display name from whatever metadata the endpoint reported.
 * Example: "llama3.2:latest" + ["3.2B", "Q4_K_M"] → "llama3.2:latest (3.2B, Q4_K_M)"
 */
function describeModel(id: string, details: Array<string | undefined>): string {
    const parts = details.filter((part): part is string => !!part);
    return parts.length > 0 ? `${id} (${parts.join(", ")})` : id;
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
    // The pattern admits no other unit, so K needs no test of its own.
    const unit = match[2].toUpperCase();
    if (unit === "B") return value;
    if (unit === "M") return value / 1000;
    return value / 1_000_000;
}
