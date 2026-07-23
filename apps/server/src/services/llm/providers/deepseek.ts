import { createOpenAI, type OpenAIProvider as OpenAISDKProvider } from "@ai-sdk/openai";

import type { ModelInfo } from "../types.js";
import { BaseProvider, type RemoteModel } from "./base_provider.js";

/**
 * DeepSeek's OpenAI-compatible endpoint. The `/v1` here is the compatibility
 * path their SDK guide uses and has nothing to do with the model version — the
 * bare host answers identically.
 */
const OFFICIAL_BASE_URL = "https://api.deepseek.com/v1";

/**
 * DeepSeek, over its OpenAI-compatible API. It could be reached through the
 * generic custom-endpoint card, but a card of its own is what makes its models
 * priced: {@link BaseProvider.getProviderPrices} keys the committed table by
 * provider name, and DeepSeek publishes bare ids (`deepseek-chat`) that the
 * table carries verbatim — so cost and context windows resolve, which they never
 * can for an endpoint we can't name.
 */
export class DeepSeekProvider extends BaseProvider {
    name = "deepseek";
    /**
     * Only the pre-listing fallback. DeepSeek retires ids between generations —
     * an account provisioned for the v4 line lists neither of these — so the real
     * defaults come from {@link pickModelDefaults} once the endpoint has answered.
     */
    protected defaultModel = "deepseek-chat";
    protected titleModel = "deepseek-chat";

    /** Whether the two above have been replaced by ids the endpoint actually offers. */
    private defaultsFromListing = false;

    private openai: OpenAISDKProvider;

    constructor(apiKey: string, baseURL?: string) {
        super(apiKey, baseURL);
        if (!apiKey) {
            throw new Error("API key is required for DeepSeek provider");
        }
        this.openai = createOpenAI({ apiKey, baseURL: this.baseURL ?? OFFICIAL_BASE_URL });
    }

    /**
     * Chat Completions rather than the Responses API, which DeepSeek doesn't
     * implement — the same reason the self-hosted provider pins `.chat()`.
     */
    protected createModel(modelId: string) {
        return this.openai.chat(modelId);
    }

    /** Everything DeepSeek lists is a chat model, so nothing is filtered out. */
    protected override async fetchRemoteModels(): Promise<RemoteModel[] | null> {
        const payload = await this.fetchJson(`${this.baseURL ?? OFFICIAL_BASE_URL}/models`, {
            Authorization: `Bearer ${this.apiKey}`
        });
        const data = (payload as { data?: unknown }).data;
        if (!Array.isArray(data)) {
            throw new Error("Unexpected /models response shape");
        }
        const models = data
            .filter((m): m is { id: string } => typeof (m as { id?: unknown }).id === "string")
            .map(m => ({ id: m.id, name: deepSeekModelName(m.id) }));
        this.pickModelDefaults(models.map(m => m.id));
        return models;
    }

    /**
     * Point the defaults at ids the account actually has. Titles go to the
     * cheapest listed model — a title is one line, generated for every new chat —
     * and conversation to the dearest, which is DeepSeek's flagship tier.
     *
     * Both take the *first* of a tied group rather than the last, so a chat and a
     * reasoner priced identically default to chat: same cost per token, but the
     * reasoner spends far more of them thinking.
     */
    private pickModelDefaults(ids: string[]): void {
        if (ids.length === 0) {
            return;
        }
        const prices = this.getProviderPrices();
        // Ids the table doesn't know (a gateway serving something else) can't be
        // ranked on cost, so they decide nothing unless nothing at all is priced.
        const priced = ids.filter(id => prices[id]);
        const ranked = priced.length > 0 ? priced : ids;
        const cost = (id: string) => prices[id]?.output ?? 0;

        // Strict comparisons, so a tie leaves the first-listed id in place.
        let cheapest = ranked[0];
        let dearest = ranked[0];
        for (const id of ranked) {
            if (cost(id) < cost(cheapest)) {
                cheapest = id;
            }
            if (cost(id) > cost(dearest)) {
                dearest = id;
            }
        }

        this.titleModel = cheapest;
        this.defaultModel = dearest;
        this.defaultsFromListing = true;
    }

    /**
     * The title model is only known once the endpoint has been listed, so make
     * sure that has happened. The base class caches the list, so this is a no-op
     * after the first call; a listing failure falls through to the alias above
     * rather than costing the user a title.
     */
    override async generateTitle(firstMessage: string): Promise<string> {
        if (!this.defaultsFromListing) {
            await this.listModels().catch(() => undefined);
        }
        return super.generateTitle(firstMessage);
    }

    protected override modelName(id: string): string {
        return deepSeekModelName(id);
    }

    /**
     * The catalog is small enough to recommend wholesale, minus the coder line —
     * `deepseek-coder` was folded into `deepseek-chat` and lingers only for
     * callers pinned to it, so pre-selecting it would put a superseded model in
     * front of the user.
     */
    override recommendedModelIds(models: ModelInfo[]): Set<string> {
        return new Set(
            models
                .filter(m => !m.isLegacy && !/preview/i.test(m.id) && !/^deepseek-coder/.test(m.id))
                .map(m => m.id)
        );
    }
}

/**
 * `deepseek-chat` → "DeepSeek Chat", `deepseek-v4-pro` → "DeepSeek V4 Pro". The
 * `/models` response carries ids only, and an unprefixed id (a proxy serving
 * something else) is left exactly as it came.
 */
export function deepSeekModelName(id: string): string {
    const match = /^deepseek-(.+)$/.exec(id);
    if (!match) {
        return id;
    }
    const words = match[1]
        .split("-")
        .map(word => (/^v\d+$/i.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)));
    return `DeepSeek ${words.join(" ")}`;
}
