import { createOpenAI, type OpenAIProvider as OpenAISDKProvider } from "@ai-sdk/openai";
import type { ToolSet } from "ai";

import type { ModelInfo } from "../types.js";
import { BaseProvider, type RemoteModel } from "./base_provider.js";

const OFFICIAL_BASE_URL = "https://api.openai.com/v1";

export class OpenAiProvider extends BaseProvider {
    name = "openai";
    protected defaultModel = "gpt-4.1";
    protected titleModel = "gpt-4.1-mini";

    /** The `/models` endpoint returns no display names, so derive friendly ones. */
    protected override modelName(id: string): string {
        return openAiModelName(id);
    }

    private openai: OpenAISDKProvider;

    constructor(apiKey: string, baseURL?: string) {
        super(apiKey, baseURL);
        if (!apiKey) {
            throw new Error("API key is required for OpenAI provider");
        }
        this.openai = createOpenAI({ apiKey, ...(baseURL && { baseURL }) });
    }

    protected createModel(modelId: string) {
        return this.openai(modelId);
    }

    /**
     * List models from the OpenAI-compatible `/models` endpoint. On the
     * official endpoint the list is full of non-chat models (embeddings,
     * whisper, TTS, ...), which are filtered out; a custom baseURL (Ollama,
     * vLLM, LM Studio, LiteLLM) lists exactly what the endpoint offers.
     */
    protected override async fetchRemoteModels(): Promise<RemoteModel[] | null> {
        const payload = await this.fetchJson(`${this.baseURL ?? OFFICIAL_BASE_URL}/models`, {
            Authorization: `Bearer ${this.apiKey}`
        });
        const data = (payload as { data?: unknown }).data;
        if (!Array.isArray(data)) {
            throw new Error("Unexpected /models response shape");
        }
        const ids = data
            .filter((m): m is { id: string } => typeof (m as { id?: unknown }).id === "string")
            .map(m => m.id);
        // Custom endpoints list exactly what they serve; the official one is
        // filtered to chat models and deduped of pinned snapshots.
        const chatIds = this.baseURL ? ids : ids.filter(isOpenAiChatModel);
        // OpenAI's /models has no display names, so derive friendly ones.
        return chatIds.map(id => ({ id, name: openAiModelName(id) }));
    }

    protected override addWebSearchTool(tools: ToolSet): void {
        tools.web_search = this.openai.tools.webSearch();
    }

    /**
     * Recommend only the newest generation of each OpenAI line, core tiers only.
     *
     * The recency signal is the version number, across two parallel lines (the
     * GPT line `gpt-<version>` and the reasoning o-series `o<n>`) — so today's
     * `gpt-5.6-{sol,terra,luna}` and `o4-mini`, not the dozens of older gpt-4
     * through 5.5 and o1/o3 models (which stay in the picker, unchecked). When
     * gpt-5.7 / o5 ship they win automatically. A self-hosted endpoint serving
     * neither line recommends nothing.
     */
    override recommendedModelIds(models: ModelInfo[]): Set<string> {
        // Premium (`-pro`) and rolling-alias (`-chat-latest`) variants are never a
        // default; drop them before picking the newest generation.
        const core = models.filter(m => !/-pro$/.test(m.id) && !/-chat-latest$/.test(m.id));
        return new Set([
            ...newestOfLine(core, /^gpt-/, gptVersion),
            ...newestOfLine(core, /^o\d/, oSeriesVersion)
        ]);
    }
}

/**
 * Model-id families returned by the official OpenAI `/models` endpoint that are
 * not chat models (embeddings, audio/speech, image, video, moderation,
 * computer-use, coding agents, legacy completions). Only applied on the
 * official endpoint — custom base URLs (Ollama, vLLM, LiteLLM, LM Studio) list
 * exactly what the user installed, so nothing is filtered there.
 */
const OPENAI_NON_CHAT = /embedding|whisper|tts|dall-e|moderation|realtime|audio|transcribe|image|sora|computer-use|codex|instruct|deep-research|babbage|davinci|search/i;

/**
 * Pinned-snapshot suffixes that duplicate a rolling base id — `-2024-05-13`
 * (dated) and `-0125` / `-1106` (legacy MMDD). Dropped so the list shows
 * `gpt-4o`, not `gpt-4o` plus five of its dated revisions.
 */
const OPENAI_SNAPSHOT = /-\d{4}(-\d{2}-\d{2})?$/;

export function isOpenAiChatModel(id: string): boolean {
    // `chat-latest` is a bare rolling alias (current ChatGPT Instant model) —
    // redundant with the versioned `gpt-*-chat-latest` handles and uninformative
    // on its own, so it's dropped.
    return id !== "chat-latest" && !OPENAI_NON_CHAT.test(id) && !OPENAI_SNAPSHOT.test(id);
}

/**
 * Friendly display name for an OpenAI model id, since the `/models` endpoint
 * returns none. Only the GPT family is reshaped — `gpt-4.1-mini` →
 * "GPT-4.1 Mini", `gpt-5.6-sol` → "GPT-5.6 Sol". The o-series keeps OpenAI's
 * canonical lowercase-hyphenated form (`o4-mini`, `o1-pro`), which is both its
 * proper style and what keeps it visually distinct from "GPT-4o Mini".
 * Non-OpenAI ids (self-hosted `llama3.2`) are left untouched.
 */
export function openAiModelName(id: string): string {
    const gptMatch = /^gpt-([^-]+)(?:-(.+))?$/.exec(id);
    if (!gptMatch) {
        return id;
    }
    const [, version, suffix] = gptMatch;
    const suffixName = suffix
        ? ` ${suffix.split("-").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")}`
        : "";
    return `GPT-${version}${suffixName}`;
}

/** Ids in `models` matching `line` whose parsed version equals the line's maximum. */
function newestOfLine(models: ModelInfo[], line: RegExp, version: (id: string) => number): string[] {
    const family = models.filter(m => line.test(m.id));
    if (family.length === 0) {
        return [];
    }
    const max = Math.max(...family.map(m => version(m.id)));
    return family.filter(m => version(m.id) === max).map(m => m.id);
}

/**
 * `gpt-5.6-sol` → 5.6, `gpt-4.1` → 4.1, `gpt-4o` → 4. Version 0 for a `gpt-`
 * id carrying no version at all (self-hosted `gpt-oss-120b`), which leaves such
 * a model recommendable only when nothing versioned outranks it.
 */
function gptVersion(id: string): number {
    const match = /^gpt-(\d+(?:\.\d+)?)/.exec(id);
    return match ? parseFloat(match[1]) : 0;
}

/** `o4-mini` → 4, `o3` → 3. Only reached for `/^o\d/` ids, so the digits are guaranteed. */
function oSeriesVersion(id: string): number {
    return parseInt(id.slice(1), 10);
}
