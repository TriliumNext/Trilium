/**
 * Base class for LLM providers. Handles shared logic for system prompt building,
 * tool assembly, model pricing, and title generation.
 */

import { type LlmMessage, type LlmMessagePart } from "@triliumnext/commons";
import { type FilePart, generateText, type ImagePart, type LanguageModel, type ModelMessage, stepCountIs, streamText, type SystemModelMessage, type TextPart, type ToolSet } from "ai";

import { resolveAttachmentPart } from "../attachment_content.js";
import { buildNoteHint } from "../note_hint.js";
import { buildSystemPrompt as composeSystemPrompt } from "../system_prompt.js";
import { allToolRegistries } from "../tools/index.js";
import type { LlmProvider, LlmProviderConfig, ModelInfo, ModelPricing, StreamResult } from "../types.js";
import MODEL_PRICES_JSON from "./model_prices.json" with { type: "json" };

const DEFAULT_MAX_TOKENS = 8096;
const TITLE_MAX_TOKENS = 30;

/**
 * A model as reported by a provider's models endpoint. Only what the listing
 * APIs actually return — pricing is never part of it.
 */
export interface RemoteModel {
    id: string;
    /** Human-readable name, when the API provides one (e.g. Anthropic's `display_name`). */
    name?: string;
    /** Context window in tokens, when the API provides one (e.g. Google's `inputTokenLimit`). */
    contextWindow?: number;
}

/**
 * Per-model pricing/metadata, sourced from the committed `model_prices.json`
 * (pruned from LiteLLM — see `scripts/update-model-prices.ts`). This is the
 * single source of truth for cost/context data now that the hand-curated
 * per-provider model arrays are gone; the endpoint (dynamic listing) remains the
 * source of truth for which models exist and their display names.
 */
export interface ModelPrice {
    /** USD per million input tokens. */
    input: number;
    /** USD per million output tokens. */
    output: number;
    /** Context window in tokens, when known. */
    ctx?: number;
}

/** One provider's pricing, keyed by model id. */
export type ProviderPrices = Record<string, ModelPrice>;

/** The whole committed price table: provider name → model id → pricing. */
export type ModelPriceTable = Record<string, ProviderPrices>;

/**
 * The committed pricing/context table — the single source of truth for cost
 * metadata now that per-provider model arrays are gone. Keyed by provider name
 * then model id; regenerated from LiteLLM by `scripts/update-model-prices.ts`.
 */
const MODEL_PRICES = MODEL_PRICES_JSON as ModelPriceTable;

/** How long a successfully fetched dynamic model list is served from cache. */
const MODEL_LIST_TTL_MS = 60 * 60 * 1000;
/** Timeout for a single models-endpoint request. */
const MODEL_LIST_TIMEOUT_MS = 10_000;

/**
 * Resolve a single LlmMessagePart to its AI SDK ModelMessage part form, mapping
 * the provider-neutral {@link resolveAttachmentPart} result into `ai`'s block
 * shapes. Returns null (and the caller drops the part) when it can't resolve.
 */
function resolveMessagePart(part: LlmMessagePart): TextPart | ImagePart | FilePart | null {
    const resolved = resolveAttachmentPart(part);
    if (!resolved) {
        return null;
    }
    switch (resolved.kind) {
        case "text":
            return { type: "text", text: resolved.text };
        case "image":
            return { type: "image", image: resolved.bytes, mediaType: resolved.mime };
        case "file":
            return { type: "file", data: resolved.bytes, mediaType: resolved.mime, filename: resolved.filename };
    }
}

/**
 * Build a single ModelMessage from an LlmMessage. Plain string content stays
 * as-is; multimodal content is resolved into AI SDK text/image/file parts.
 */
export function buildModelMessage(m: LlmMessage): ModelMessage {
    const role = m.role as "user" | "assistant";
    if (typeof m.content === "string") {
        return { role, content: m.content };
    }
    const resolved = m.content
        .map(resolveMessagePart)
        .filter((p): p is TextPart | ImagePart | FilePart => p !== null);
    // Assistant turns can only carry TextParts (per the AI SDK type), so
    // strip any stray attachments — they only make sense on user turns anyway.
    if (role === "assistant") {
        const textOnly: TextPart[] = resolved.filter((p): p is TextPart => p.type === "text");
        return { role: "assistant", content: textOnly };
    }
    return { role: "user", content: resolved };
}

/**
 * A hard-coded model definition that always carries pricing. Used only by the
 * Claude Agent (subscription) provider, whose fixed catalog and zero pricing
 * come from the CLI rather than the metered LiteLLM price table.
 */
type CuratedModel = ModelInfo & { pricing: ModelPricing };

/**
 * Split a curated model array into the `{ models, pricing }` pair the subscription
 * provider needs (the model list plus an id → pricing lookup).
 */
export function buildModelList(baseModels: CuratedModel[]): {
    models: ModelInfo[];
    pricing: Record<string, ModelPricing>;
} {
    const pricing = Object.fromEntries(baseModels.map(m => [m.id, m.pricing]));
    return { models: baseModels, pricing };
}

/**
 * Merge a live-fetched model list with a base metadata list (the provider's
 * price-table slice, see {@link BaseProvider.getAvailableModels}).
 *
 * The remote list is the source of truth for *availability* and *display name*:
 * base entries absent from it are dropped, remote models unknown to the base
 * list are included with whatever metadata the endpoint reported (no pricing).
 * The base list supplies pricing and context window (and, offline, a fallback
 * name) for the models it knows; the endpoint's display name always wins when
 * present.
 *
 * Shared by {@link BaseProvider.listModels} and the Claude Agent provider, which
 * merges the CLI's catalog rather than an HTTP endpoint's but needs the same rules.
 *
 * Ordering: base-known models first (in base order), then unknown remote models
 * alphabetically. An existing default keeps its flag; otherwise the first merged
 * model becomes the default so callers relying on `find(m => m.isDefault)` keep
 * working.
 */
export function mergeModelLists(curated: ModelInfo[], remote: RemoteModel[]): ModelInfo[] {
    const remoteById = new Map(remote.map(m => [m.id, m]));

    const known = curated
        .filter(m => remoteById.has(m.id))
        .map(m => {
            const remoteModel = remoteById.get(m.id);
            return {
                ...m,
                // The endpoint is authoritative for display names (e.g. Anthropic's
                // `display_name`); the base name is only an offline fallback.
                name: remoteModel?.name ?? m.name,
                contextWindow: m.contextWindow ?? remoteModel?.contextWindow
            };
        });

    const curatedIds = new Set(curated.map(m => m.id));
    const unknown = remote
        .filter(m => !curatedIds.has(m.id))
        .sort((a, b) => a.id.localeCompare(b.id))
        .map<ModelInfo>(m => ({
            id: m.id,
            name: m.name ?? m.id,
            contextWindow: m.contextWindow
        }));

    const merged = [...known, ...unknown];
    if (merged.length > 0 && !merged.some(m => m.isDefault)) {
        merged[0] = { ...merged[0], isDefault: true };
    }
    return merged;
}

/**
 * Normalize a custom endpoint override: strip trailing slashes, and treat an
 * empty result as "no override".
 *
 * Written as an index scan rather than `replace(/\/+$/, "")`: that pattern
 * backtracks polynomially on a value ending in many slashes, and the base URL
 * arrives straight from a request body (CodeQL js/polynomial-redos).
 */
function normalizeBaseUrl(baseURL: string | undefined): string | undefined {
    if (!baseURL) {
        return undefined;
    }
    let end = baseURL.length;
    while (end > 0 && baseURL.charAt(end - 1) === "/") {
        end--;
    }
    return baseURL.slice(0, end) || undefined;
}

export abstract class BaseProvider implements LlmProvider {
    abstract name: string;

    protected abstract defaultModel: string;
    protected abstract titleModel: string;

    protected apiKey: string;
    /** Custom endpoint override (self-hosted Ollama/vLLM, proxies). Normalized without a trailing slash. */
    protected baseURL?: string;

    private modelListCache?: { models: ModelInfo[]; fetchedAt: number };
    private modelListInFlight?: Promise<ModelInfo[]>;

    constructor(apiKey = "", baseURL?: string) {
        this.apiKey = apiKey;
        this.baseURL = normalizeBaseUrl(baseURL);
    }

    /** Create a language model instance for the given model ID. */
    protected abstract createModel(modelId: string): LanguageModel;

    /**
     * Fetch the raw model list from the provider's models endpoint. Returns
     * null when the provider doesn't support dynamic listing. Overridden by
     * providers that do; a fetch failure propagates to {@link listModels}' caller.
     */
    protected async fetchRemoteModels(): Promise<RemoteModel[] | null> {
        return null;
    }

    /**
     * GET a JSON document with the standard model-listing timeout. Shared
     * helper for {@link fetchRemoteModels} implementations. An auth failure is
     * reported as such so the add/edit-provider screen can tell the user their
     * API key (or base URL) is wrong rather than a generic HTTP error.
     */
    protected async fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
        const response = await fetch(url, { headers, signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS) });
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                throw new Error(`Authentication failed (HTTP ${response.status}) — check the API key${this.baseURL ? " and base URL" : ""}.`);
            }
            throw new Error(`HTTP ${response.status} from ${url}`);
        }
        return await response.json();
    }

    /**
     * Dynamic model listing: the live endpoint list merged with curated
     * metadata, cached for {@link MODEL_LIST_TTL_MS}. Returns the curated list
     * when the provider doesn't support dynamic listing, but a listing *failure*
     * (bad API key, unreachable endpoint) propagates — the sole caller is the
     * add/edit-provider screen, which must surface a bad credential instead of
     * masking it as success by quietly showing the curated defaults.
     */
    async listModels(): Promise<ModelInfo[]> {
        const now = Date.now();
        if (this.modelListCache && now - this.modelListCache.fetchedAt < MODEL_LIST_TTL_MS) {
            return this.modelListCache.models;
        }
        if (!this.modelListInFlight) {
            this.modelListInFlight = this.fetchAndMergeModels().finally(() => {
                this.modelListInFlight = undefined;
            });
        }
        return this.modelListInFlight;
    }

    private async fetchAndMergeModels(): Promise<ModelInfo[]> {
        const remote = await this.fetchRemoteModels();
        if (!remote || remote.length === 0) {
            // The provider doesn't support dynamic listing, or the endpoint
            // returned nothing — the price-table catalog is the answer, not an error.
            return this.getAvailableModels();
        }
        const merged = mergeModelLists(this.getAvailableModels(), remote);
        this.modelListCache = { models: merged, fetchedAt: Date.now() };
        return merged;
    }

    /**
     * Build the system prompt. Delegates to the shared `system_prompt` module;
     * kept as an overridable method so providers can post-process the result
     * (e.g. Google appends a web-search/note-tool conflict notice).
     */
    protected buildSystemPrompt(messages: LlmMessage[], config: LlmProviderConfig): string | undefined {
        return composeSystemPrompt(messages, config);
    }

    /**
     * Build the ModelMessage array from LlmMessages (no provider-specific options).
     *
     * Only user/assistant turns are included here — the system prompt is passed
     * separately via the `system` option of `streamText` (see `buildSystemMessage`),
     * which is resilient against prompt injection.
     */
    protected buildMessages(chatMessages: LlmMessage[]): ModelMessage[] {
        return chatMessages.map(m => buildModelMessage(m));
    }

    /**
     * Attach the current-note metadata hint to the last user message.
     *
     * The hint is deliberately kept OUT of the system prompt: it changes whenever
     * the context note changes, and the system prompt carries the provider's
     * prompt-cache breakpoint — embedding volatile content there would invalidate
     * the cached system+tools prefix on every note edit. The last user message is
     * regenerated every turn and never cached, so it is the right home for it.
     */
    protected applyNoteHint(chatMessages: LlmMessage[], config: LlmProviderConfig): LlmMessage[] {
        if (!config.contextNoteId) {
            return chatMessages;
        }

        const lastUserIndex = chatMessages.map(m => m.role).lastIndexOf("user");
        if (lastUserIndex === -1) {
            return chatMessages;
        }

        const lastUserContent = chatMessages[lastUserIndex].content;
        const hasAttachments = Array.isArray(lastUserContent)
            && lastUserContent.some(p => p.type !== "text");

        const noteHint = buildNoteHint(config.contextNoteId, hasAttachments);
        if (!noteHint) {
            return chatMessages;
        }

        return chatMessages.map((m, i) => {
            if (i !== lastUserIndex) return m;
            if (typeof m.content === "string") {
                return { ...m, content: `${noteHint}\n\n${m.content}` };
            }
            // For multimodal content, prepend the hint as a leading text part so
            // any attached images still travel with the message.
            return {
                ...m,
                content: [{ type: "text" as const, text: noteHint }, ...m.content]
            };
        });
    }

    /**
     * Build the value for the `system` option of `streamText`. Subclasses can
     * override to attach provider-specific metadata (e.g. cache control).
     */
    protected buildSystemMessage(systemPrompt: string | undefined): string | SystemModelMessage | undefined {
        return systemPrompt;
    }

    /**
     * Add provider-specific web search tool. Override in subclasses that support it.
     */
    protected addWebSearchTool(_tools: ToolSet): void {}

    /**
     * Build the tool set based on config.
     */
    protected buildTools(config: LlmProviderConfig): ToolSet {
        const tools: ToolSet = {};

        if (config.enableWebSearch) {
            this.addWebSearchTool(tools);
        }

        if (config.enableNoteTools) {
            for (const registry of allToolRegistries) {
                Object.assign(tools, registry.toToolSet());
            }
        }

        return tools;
    }

    chat(messages: LlmMessage[], config: LlmProviderConfig): StreamResult {
        const systemPrompt = this.buildSystemPrompt(messages, config);
        const chatMessages = this.applyNoteHint(messages.filter(m => m.role !== "system"), config);
        const coreMessages = this.buildMessages(chatMessages);

        const streamOptions: Parameters<typeof streamText>[0] = {
            model: this.createModel(config.model || this.defaultModel),
            system: this.buildSystemMessage(systemPrompt),
            messages: coreMessages,
            maxOutputTokens: config.maxTokens || DEFAULT_MAX_TOKENS,
            // Reject any system message smuggled into `messages` (prompt injection guard).
            allowSystemInMessages: false,
            // The AI SDK's default onError handler dumps the raw error object straight
            // to stdout, bypassing Trilium's logger. The error is still delivered through
            // `fullStream`, where `streamToChunks` turns it into a detailed message that
            // the chat route logs — so suppress the unstructured stdout dump here.
            onError: () => {}
        };

        const tools = this.buildTools(config);
        if (Object.keys(tools).length > 0) {
            streamOptions.tools = tools;
            streamOptions.stopWhen = stepCountIs(15);
            streamOptions.toolChoice = "auto";
        }

        return streamText(streamOptions);
    }

    /**
     * This provider's slice of the committed price table. Overridable so tests
     * can inject a table without a real JSON file.
     */
    protected getProviderPrices(): ProviderPrices {
        return MODEL_PRICES[this.name] ?? {};
    }

    /**
     * Friendly display name for a model id when the endpoint doesn't supply one
     * (offline fallback / OpenAI, whose `/models` has no names). Defaults to the
     * raw id; overridden per provider.
     */
    protected modelName(id: string): string {
        return id;
    }

    getModelPricing(model: string): ModelPricing | undefined {
        const price = this.getProviderPrices()[model];
        return price ? { input: price.input, output: price.output } : undefined;
    }

    /**
     * The static, offline-safe model list, built from the price table. Also the
     * base list {@link listModels} merges the live endpoint against. The model
     * matching {@link defaultModel} is flagged so `find(m => m.isDefault)` works.
     */
    getAvailableModels(): ModelInfo[] {
        return Object.entries(this.getProviderPrices())
            .map(([id, price]) => ({
                id,
                name: this.modelName(id),
                pricing: { input: price.input, output: price.output },
                contextWindow: price.ctx,
                ...(id === this.defaultModel ? { isDefault: true } : {})
            }))
            .sort((a, b) => a.id.localeCompare(b.id));
    }

    /**
     * The ids pre-selected by default when adding or resetting this provider.
     * The generic rule — everything that is neither a preview nor a legacy model
     * — is overridden by providers whose id shape carries a usable recency
     * signal (see {@link OpenAiProvider} and {@link AnthropicProvider}).
     */
    recommendedModelIds(models: ModelInfo[]): Set<string> {
        return new Set(models.filter(m => !m.isLegacy && !/preview/i.test(m.id)).map(m => m.id));
    }

    async generateTitle(firstMessage: string): Promise<string> {
        const { text } = await generateText({
            model: this.createModel(this.titleModel),
            maxOutputTokens: TITLE_MAX_TOKENS,
            messages: [
                {
                    role: "user",
                    content: `Summarize the following message as a very short chat title (max 6 words). Reply with ONLY the title, no quotes or punctuation at the end.\n\nMessage: ${firstMessage}`
                }
            ]
        });

        return text.trim();
    }
}
