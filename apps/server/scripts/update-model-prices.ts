/**
 * Regenerates `src/services/llm/providers/model_prices.json` — the committed,
 * pruned pricing/context table that is the single source of truth for LLM model
 * cost metadata (the hand-curated per-provider model arrays were removed).
 *
 * Source: LiteLLM's community-maintained `model_prices_and_context_window.json`
 * (MIT). We keep only the bare, unprefixed ids that Trilium's own `/models`
 * endpoints return for the three metered providers we support, projected down to
 * `{ input, output, ctx }` (USD per **million** tokens; LiteLLM stores per-token).
 *
 * Not run at build time — the build imports the committed JSON directly and stays
 * hermetic. This runs on demand (or from the weekly `update-model-prices.yml`
 * workflow, which opens a PR when the output changes). Usage:
 *
 *   pnpm --filter server update-model-prices
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { ModelPrice, ModelPriceTable, ProviderPrices } from "../src/services/llm/providers/base_provider.js";

const SOURCE_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

const OUTPUT_PATH = fileURLToPath(
    new URL("../src/services/llm/providers/model_prices.json", import.meta.url)
);

/**
 * Match a LiteLLM entry to one of our provider names by *bare key shape*, not by
 * its `litellm_provider` tag — the tag is unreliable (Google's bare `gemini-*`
 * keys, which are exactly what the generativelanguage endpoint returns, are
 * tagged `vertex_ai-language-models`, while the `gemini`-tagged entries are the
 * `gemini/…`-prefixed duplicates we don't want). Prefixed keys (`bedrock/…`,
 * `vertex_ai/…`, `azure/…`) never match our endpoints, so they are excluded.
 */
function classify(key: string, provider: string | undefined): string | null {
    if (key.includes("/")) {
        return null; // prefixed vendor route — never what our endpoints return
    }
    if (/^claude-/.test(key) && provider === "anthropic") {
        return "anthropic";
    }
    if (/^(gpt-|o\d|chatgpt-)/.test(key) && provider === "openai") {
        return "openai";
    }
    if (/^gemini-/.test(key)) {
        return "google"; // provider tag is unreliable here; key shape is not
    }
    if (/^deepseek-/.test(key) && provider === "deepseek") {
        return "deepseek";
    }
    return null;
}

/** LiteLLM stores costs per token; we display per million tokens. */
const PER_MILLION = 1_000_000;

/**
 * At least this many models per provider, or the upstream file is assumed broken.
 * DeepSeek's floor is low because its catalog genuinely is — a handful of rolling
 * aliases rather than a wall of dated snapshots.
 */
const SANITY_FLOOR: Record<string, number> = { anthropic: 5, openai: 10, google: 5, deepseek: 2 };

interface LiteLlmEntry {
    litellm_provider?: string;
    mode?: string;
    input_cost_per_token?: number;
    output_cost_per_token?: number;
    max_input_tokens?: number;
    max_tokens?: number;
}

async function main() {
    const response = await fetch(SOURCE_URL);
    if (!response.ok) {
        throw new Error(`Failed to fetch LiteLLM price list: HTTP ${response.status}`);
    }
    const raw = (await response.json()) as Record<string, LiteLlmEntry>;

    const table: ModelPriceTable = {};
    for (const [key, entry] of Object.entries(raw)) {
        if (!entry || typeof entry !== "object" || entry.mode !== "chat") {
            continue;
        }
        const provider = classify(key, entry.litellm_provider);
        if (!provider) {
            continue;
        }
        const input = entry.input_cost_per_token;
        if (typeof input !== "number" || input <= 0) {
            continue; // no meaningful price → skip (leaves the model unpriced, not $0)
        }
        const price: ModelPrice = {
            input: round(input * PER_MILLION),
            output: round((entry.output_cost_per_token ?? 0) * PER_MILLION)
        };
        const ctx = entry.max_input_tokens ?? entry.max_tokens;
        if (typeof ctx === "number" && ctx > 0) {
            price.ctx = ctx;
        }
        (table[provider] ??= {})[key] = price;
    }

    for (const [provider, floor] of Object.entries(SANITY_FLOOR)) {
        const count = Object.keys(table[provider] ?? {}).length;
        if (count < floor) {
            throw new Error(`Only ${count} ${provider} models parsed (expected >= ${floor}); refusing to overwrite. Upstream format may have changed.`);
        }
    }

    writeFileSync(OUTPUT_PATH, `${JSON.stringify(sortTable(table), null, 2)}\n`);
    const summary = Object.entries(table).map(([p, m]) => `${p}: ${Object.keys(m).length}`).join(", ");
    console.log(`Wrote ${OUTPUT_PATH}\n  ${summary}`);
}

/** Round to 4 decimals (sub-cent per-MTok granularity), dropping float noise. */
function round(value: number): number {
    return Number(value.toFixed(4));
}

/** Sort providers and their model ids so refreshes produce minimal, reviewable diffs. */
function sortTable(table: ModelPriceTable): ModelPriceTable {
    const sorted: ModelPriceTable = {};
    for (const provider of Object.keys(table).sort()) {
        const models: ProviderPrices = {};
        for (const id of Object.keys(table[provider]).sort()) {
            models[id] = table[provider][id];
        }
        sorted[provider] = models;
    }
    return sorted;
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
