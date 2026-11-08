/**
 * Per-provider marks, chat and search alike, shared by the provider setup wizard, the chat model
 * picker and the chat's Tools menu.
 *
 * Keyed by provider *type* (`LlmProviderConfig.provider`), not by the user's configuration
 * id — two Ollama configurations show the same mark, which is why the model picker keeps its
 * per-configuration group headers rather than relying on the icon alone to tell them apart.
 *
 * The marks are glyphs of the built-in `tn-brand` icon pack, built from the SVGs in
 * `apps/icon-pack-builder/brand-icons`.
 */
export const PROVIDER_ICONS: Record<string, string> = {
    "anthropic": "tn-brand tn-brand-anthropic",
    "antigravity-agent": "tn-brand tn-brand-antigravity",
    "brave": "tn-brand tn-brand-brave",
    "claude-agent": "tn-brand tn-brand-claude",
    "codex-agent": "tn-brand tn-brand-codex",
    "copilot-agent": "tn-brand tn-brand-github-copilot",
    "deepseek": "tn-brand tn-brand-deepseek",
    "exa": "tn-brand tn-brand-exa",
    "google": "tn-brand tn-brand-gemini",
    "lmstudio": "tn-brand tn-brand-lmstudio",
    "ollama": "tn-brand tn-brand-ollama",
    "openai": "tn-brand tn-brand-openai",
    "openai-compatible": "bx bx-bot",
    "openrouter": "tn-brand tn-brand-openrouter",
    "perplexity": "tn-brand tn-brand-perplexity",
    "searxng": "tn-brand tn-brand-searxng",
    "serper": "tn-brand tn-brand-serper",
    "tavily": "tn-brand tn-brand-tavily"
};

/**
 * The icon class of a provider type's mark, falling back to the generic one so a provider added
 * later — or a configuration restored from a newer version — still gets a glyph rather than a gap
 * that would misalign the row.
 */
export function providerIcon(provider: string | undefined): string {
    return (provider && PROVIDER_ICONS[provider]) || PROVIDER_ICONS["openai-compatible"];
}
