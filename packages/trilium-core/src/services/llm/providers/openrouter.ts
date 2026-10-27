import { createOpenRouter, type OpenRouterProvider as OpenRouterSDKProvider } from "@openrouter/ai-sdk-provider";
import type { LlmAttachmentKind, LlmReasoningEffort } from "@triliumnext/commons";
import type { LanguageModel } from "ai";

import type { LlmProviderConfig, ModelInfo, ModelPricing, TurnReport, TurnSteps } from "../types.js";
import { BaseProvider, type RemoteModel } from "./base_provider.js";
import { llmFetch } from "./fetch.js";

const OFFICIAL_BASE_URL = "https://openrouter.ai/api/v1";

/** The effort levels offered on a model that reasons; OpenRouter maps each to the model's own switch. */
const REASONING_EFFORTS = [ "low", "medium", "high" ] as const satisfies LlmReasoningEffort[];
type ReasoningEffort = (typeof REASONING_EFFORTS)[number];
/** The level OpenRouter applies when a request asks for reasoning without naming one. */
const DEFAULT_REASONING_EFFORT: ReasoningEffort = "medium";

/** The prefix of OpenRouter's rolling aliases (`~anthropic/claude-sonnet-latest`), which it repoints at each release. */
const ALIAS_PREFIX = "~";

/**
 * Batch variants (`anthropic/claude-opus-5.5:batch`) are served through a deferred queue, so a chat
 * would wait on them for minutes.
 */
const BATCH_SUFFIX = ":batch";

/** One entry of OpenRouter's `/models` listing, reduced to the fields read here. */
interface OpenRouterModel {
    id: string;
    /** The dated slug (`anthropic/claude-haiku-5.5-20261007`), which a response can name in place of the id. */
    canonical_slug?: string;
    name?: string;
    created?: number;
    context_length?: number;
    /** USD per token, as decimal strings; `"-1"` on a router whose price depends on the model it picks. */
    pricing?: { prompt?: string; completion?: string };
    architecture?: { input_modalities?: string[]; output_modalities?: string[] };
    supported_parameters?: string[];
    /** Set on a model OpenRouter has scheduled for removal. */
    expiration_date?: string | null;
}

/**
 * OpenRouter: one key for the models of every major lab, billed through OpenRouter's credits.
 *
 * Unlike the vendor APIs, its `/models` listing carries prices, context windows, input
 * modalities and supported parameters, so every model is priced and described from the listing
 * rather than from the committed price table, which has no `openrouter` slice.
 */
export class OpenRouterProvider extends BaseProvider {
    name = "openrouter";
    /** OpenRouter's own router, which picks a model per request. */
    protected defaultModel = "openrouter/auto";
    /** A rolling alias, so titles keep working as Anthropic releases new Haiku models. Haiku thinks only when asked to. */
    protected titleModel = "~anthropic/claude-haiku-latest";

    private openrouter: OpenRouterSDKProvider;

    /** The last listing, by id, for the metadata `/models` carries beyond what {@link RemoteModel} holds. */
    private catalog = new Map<string, OpenRouterModel>();

    constructor(apiKey: string, baseURL?: string) {
        super(apiKey, baseURL);
        if (!apiKey) {
            throw new Error("API key is required for OpenRouter provider");
        }
        this.openrouter = createOpenRouter({
            apiKey,
            baseURL: this.baseURL ?? OFFICIAL_BASE_URL,
            compatibility: "strict",
            appName: "Trilium Notes",
            appUrl: "https://triliumnotes.org",
            fetch: llmFetch
        });
    }

    protected createModel(modelId: string): LanguageModel {
        return this.openrouter.chat(modelId);
    }

    /**
     * Lists the chat models. `/models` answers without a key, so `/key` is read alongside it to
     * report a wrong key on the add-provider screen instead of a model list that fails later.
     */
    protected override async fetchRemoteModels(): Promise<RemoteModel[] | null> {
        const base = this.baseURL ?? OFFICIAL_BASE_URL;
        const headers = { Authorization: `Bearer ${this.apiKey}` };
        const [ , payload ] = await Promise.all([
            this.fetchJson(`${base}/key`, headers),
            this.fetchJson(`${base}/models`, headers)
        ]);
        const data = (payload as { data?: unknown }).data;
        if (!Array.isArray(data)) {
            throw new Error("Unexpected /models response shape");
        }

        const models = (data as OpenRouterModel[]).filter(isChatModel);
        this.catalog = new Map(models.map(m => [ m.id, m ]));
        return models.map(m => ({
            id: m.id,
            name: m.name,
            contextWindow: m.context_length,
            pricing: openRouterPricing(m)
        }));
    }

    /** Adds what only OpenRouter's listing knows: effort levels, and the models due for removal. */
    override async listModels(): Promise<ModelInfo[]> {
        const models = await super.listModels();
        return models.map(model => {
            const entry = this.catalog.get(model.id);
            return {
                ...model,
                ...(entry?.expiration_date && { isLegacy: true }),
                ...(entry && reasons(entry) && {
                    reasoningEfforts: [ ...REASONING_EFFORTS ],
                    defaultReasoningEffort: DEFAULT_REASONING_EFFORT
                })
            };
        });
    }

    /**
     * The fallback list, and the base `listModels()` merges the listing into. The committed price
     * table has no OpenRouter slice, so it holds the Auto Router alone, as the default.
     */
    override getAvailableModels(): ModelInfo[] {
        return [ { id: this.defaultModel, name: "Auto Router", isDefault: true } ];
    }

    override getModelPricing(model: string): ModelPricing | undefined {
        const entry = this.catalog.get(model);
        return entry ? openRouterPricing(entry) : super.getModelPricing(model);
    }

    /**
     * Reports the model that wrote the answer, which differs from the one asked for when a router or
     * a rolling alias picked it, and the sum of what OpenRouter billed each step.
     */
    async describeTurn(steps: TurnSteps, requestedModel: string, modelName: (id: string) => string | undefined): Promise<TurnReport> {
        const costs = steps.map(step => billedCost(step.providerMetadata));
        const cost = costs.length > 0 && costs.every(c => c !== undefined)
            ? costs.reduce((sum, c) => sum + c, 0)
            : undefined;

        const answeredBy = steps.at(-1)?.response.modelId;
        if (!answeredBy || answeredBy === requestedModel) {
            return { cost };
        }
        const stored = modelName(answeredBy);
        if (stored) {
            return { cost, model: stored };
        }
        const listed = await this.findListed(answeredBy);
        if (listed?.id === requestedModel) {
            return { cost };
        }
        return { cost, model: listed?.name ?? answeredBy };
    }

    /** The listing's entry for an id or a dated slug, listing the models first if this instance hasn't. */
    private async findListed(id: string): Promise<OpenRouterModel | undefined> {
        if (this.catalog.size === 0) {
            await this.listModels().catch(() => undefined);
        }
        return this.catalog.get(id) ?? [ ...this.catalog.values() ].find(m => m.canonical_slug === id);
    }

    /**
     * Sends the chat's effort. The client sends one only for a model that lists effort levels; without
     * one, the model runs at its own default.
     */
    protected override chatProviderOptions(config: LlmProviderConfig) {
        const effort = REASONING_EFFORTS.find(level => level === config.reasoningEffort);
        return effort ? { openrouter: { reasoning: { effort } } } : undefined;
    }

    /**
     * Reads the model's input modalities, which become the stored model's `attachmentKinds` that a
     * chat turn filters by instead. A model not listed yet is sent everything.
     */
    protected override acceptsAttachment(kind: LlmAttachmentKind, modelId: string): boolean {
        const modalities = this.catalog.get(modelId)?.architecture?.input_modalities;
        return !modalities || modalities.includes(kind);
    }

    /**
     * Pre-selects OpenRouter's rolling `~…-latest` aliases that can call tools. OpenRouter repoints
     * them at each release, so the selection stays current without the user editing it.
     */
    override recommendedModelIds(models: ModelInfo[]): Set<string> {
        return new Set(models
            .filter(m => m.id.startsWith(ALIAS_PREFIX) && !m.isLegacy)
            .filter(m => this.catalog.get(m.id)?.supported_parameters?.includes("tools"))
            .map(m => m.id));
    }
}

/** What OpenRouter billed for one step, from the `usage` it reports in the step's metadata. */
function billedCost(metadata: TurnSteps[number]["providerMetadata"]): number | undefined {
    const usage = metadata?.openrouter?.usage;
    const cost = usage && typeof usage === "object" && "cost" in usage ? usage.cost : undefined;
    return typeof cost === "number" ? cost : undefined;
}

/** A model that answers in text and replies straight away, which excludes image generators and batch variants. */
function isChatModel(m: OpenRouterModel): boolean {
    return typeof m.id === "string"
        && !m.id.endsWith(BATCH_SUFFIX)
        && (m.architecture?.output_modalities?.includes("text") ?? true);
}

function reasons(m: OpenRouterModel): boolean {
    return m.supported_parameters?.includes("reasoning") ?? false;
}

/**
 * The listing's per-token prices as USD per million tokens. A router's `"-1"` depends on the model
 * it picks, so it has no price.
 */
export function openRouterPricing(m: OpenRouterModel): ModelPricing | undefined {
    const input = Number(m.pricing?.prompt);
    const output = Number(m.pricing?.completion);
    if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) {
        return undefined;
    }
    return { input: perMillion(input), output: perMillion(output) };
}

/** Rounded to a millionth of a dollar, so `0.0000001` reads as 0.1 rather than 0.09999999999999999. */
function perMillion(perToken: number): number {
    return Math.round(perToken * 1e12) / 1e6;
}
