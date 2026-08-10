/**
 * Per-provider marks, shared by the provider setup wizard and the chat model picker.
 *
 * Keyed by provider *type* (`LlmProviderConfig.provider`), not by the user's configuration
 * id — two Ollama configurations show the same mark, which is why the model picker keeps its
 * per-configuration group headers rather than relying on the icon alone to tell them apart.
 *
 * Rendered through `MaskedIcon`, so these are tinted monochrome with `currentColor` rather
 * than shown in brand colours: the shape is what distinguishes them, and monochrome sits
 * with the rest of Trilium's chrome.
 */

import anthropicIcon from "./icons/anthropic.svg?url";
import claudeAgentIcon from "./icons/claude-ai.svg?url";
import deepseekIcon from "./icons/deepseek.svg?url";
import geminiIcon from "./icons/gemini.svg?url";
import lmStudioIcon from "./icons/lmstudio.svg?url";
import ollamaIcon from "./icons/ollama.svg?url";
import openaiIcon from "./icons/openai.svg?url";
import openAiCompatibleIcon from "./icons/robot.svg?url";

export const PROVIDER_ICONS: Record<string, string> = {
    anthropic: anthropicIcon,
    "claude-agent": claudeAgentIcon,
    deepseek: deepseekIcon,
    google: geminiIcon,
    lmstudio: lmStudioIcon,
    ollama: ollamaIcon,
    openai: openaiIcon,
    "openai-compatible": openAiCompatibleIcon
};

/**
 * The mark for a provider type, falling back to the generic one so a provider added later —
 * or a configuration restored from a newer version — still gets a glyph rather than a gap
 * that would misalign the row.
 */
export function providerIconUrl(provider: string | undefined): string {
    return (provider && PROVIDER_ICONS[provider]) || openAiCompatibleIcon;
}
