/**
 * Shortening of model names for display.
 *
 * Vendors label their models with their own name in front — "Claude Sonnet 4.5",
 * "DeepSeek V4 Pro" — and in the picker that word is already carried by the provider's
 * mark and its group heading, so it is the least informative token on the row. It is also
 * the token truncation protects: ellipsis is left-anchored, so a squeezed selector shows
 * "DeepSeek V4…", spending its width on the redundant half and dropping the half that
 * identifies the model.
 *
 * Display only. Model names are persisted inside the `llmProviders` option and selection
 * matches on `id` (see `resolveSelectedModel`), so nothing here can disturb stored
 * configuration or which model actually gets sent.
 */

/**
 * The vendor word each provider puts in front of its model names. Keyed by provider *type*,
 * so an OpenAI-compatible endpoint serving someone else's weights is left alone rather than
 * guessed at. OpenAI is absent deliberately: it labels models "GPT-5", where "GPT" is the
 * family rather than the vendor, and dropping it would leave "-5".
 */
const VENDOR_PREFIXES: Record<string, string> = {
    anthropic: "Claude",
    "claude-agent": "Claude",
    deepseek: "DeepSeek",
    google: "Gemini"
};

/**
 * Drop the vendor word from a model name, but only when what remains still reads as a name.
 *
 * "Claude Sonnet 4.5" → "Sonnet 4.5" and "DeepSeek V4 Pro" → "V4 Pro" keep a family word and
 * lose nothing. "Gemini 3.1 Pro" would become "3.1 Pro" — a bare version — so it keeps its
 * prefix: for Gemini the vendor word *is* the family word, and it is load-bearing. The guard
 * is what makes one rule serve both cases instead of needing a per-vendor decision.
 */
export function shortModelName(name: string, provider: string | undefined): string {
    const prefix = provider && VENDOR_PREFIXES[provider];
    if (!prefix || !name.startsWith(`${prefix} `)) {
        return name;
    }

    const remainder = name.slice(prefix.length + 1).trimStart();
    return /^\p{L}/u.test(remainder) ? remainder : name;
}
