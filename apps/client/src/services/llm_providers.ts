import { isProviderOfKind, type LlmAttachmentKind, type LlmModelInfo, type LlmProviderKind } from "@triliumnext/commons";

import { formatModelCost } from "./llm_model_cost.js";
import options from "./options.js";

export interface ModelOption extends LlmModelInfo {
    costDescription?: string;
}

/** A configured provider and the models the user selected for it (possibly none). */
export interface ModelProviderGroup {
    /** Provider config id — stable group key. */
    id: string;
    /** User-given provider name, shown as the group header. */
    name: string;
    /** Provider type (e.g. "openai"). */
    provider: string;
    /** Selected models for this provider; empty for configs migrated from before selection existed. */
    models: ModelOption[];
}

/**
 * Read the user's selected models per configured provider. Returns:
 * - `groups`: one entry per configured provider (in config order), each with its
 *   selected models — the group is kept even when it has none, so a provider
 *   migrated from before selection existed still shows up with an empty group.
 * - `models`: the flattened list across all groups (for default selection and
 *   the active-model lookup).
 * - `hasProvider`: whether any provider is configured at all.
 *
 * Read straight from the synced `llmProviders` option, so every surface offering a model — the
 * chat's picker, the text editor's assistant — lists the same thing without a round-trip.
 */
export function readSelectedModels(): { models: ModelOption[]; groups: ModelProviderGroup[]; hasProvider: boolean } {
    const configs = ((options.getJson("llmProviders") as StoredProviderConfig[] | null) ?? [])
        .filter(config => isProviderOfKind(config, "llm"));
    const groups: ModelProviderGroup[] = configs.map(config => ({
        id: config.id,
        name: config.name,
        provider: config.provider,
        models: (config.selectedModels ?? []).map(model => ({
            ...model,
            provider: config.provider,
            providerId: config.id,
            providerName: config.name,
            costDescription: formatModelCost(model)
        }))
    }));
    const models = groups.flatMap(g => g.models);
    return { models, groups, hasProvider: configs.length > 0 };
}

/** A configured search provider, as the chat's Tools menu lists it. */
export interface SearchProviderOption {
    id: string;
    name: string;
    provider: string;
}

/** The search providers configured in the `llmProviders` option, in config order. */
export function readSearchProviders(): SearchProviderOption[] {
    return ((options.getJson("llmProviders") as StoredProviderConfig[] | null) ?? [])
        .filter(config => isProviderOfKind(config, "search"))
        .map(({ id, name, provider }) => ({ id, name, provider }));
}

/** Provider types whose models search the web themselves when `enableWebSearch` is set. */
const BUILT_IN_WEB_SEARCH = new Set([ "anthropic", "openai", "google", "claude-agent", "antigravity-agent", "codex-agent" ]);

/** Provider types that run their own agent loop, which takes no tool from Trilium's chat. */
const OWN_AGENT_LOOP = new Set([ "claude-agent", "copilot-agent", "antigravity-agent", "codex-agent" ]);

/** The web search of a chat turn, as the Tools menu shows it and as the turn is sent. */
export interface WebSearchState {
    /** The marked choice: `"disabled"`, `"builtin"`, or the config id of a search provider. */
    choice: string;
    /** The i18n key saying why the model's built-in search can't be used, if it can't. */
    builtInUnavailableKey?: string;
    /** The i18n key saying why a search provider can't be used with this model, if it can't. */
    searchProviderUnavailableKey?: string;
    /** Whether the turn searches the web. False when the marked choice can't be used. */
    enableWebSearch: boolean;
    /** The search provider the turn searches through, in place of the built-in search. */
    webSearchProviderId?: string;
}

/**
 * Resolve the chat's web search for a model of `modelProvider`. `searchProviderId` is the
 * `llmWebSearchProvider` option; one that names no configured search provider means built-in.
 */
export function resolveWebSearch({ modelProvider, enableWebSearch, enableNoteTools, searchProviderId, searchProviders }: {
    modelProvider: string | undefined;
    enableWebSearch: boolean;
    enableNoteTools: boolean;
    searchProviderId: string;
    searchProviders: SearchProviderOption[];
}): WebSearchState {
    let builtInUnavailableKey: string | undefined;
    if (modelProvider && !BUILT_IN_WEB_SEARCH.has(modelProvider)) {
        builtInUnavailableKey = "llm_chat.web_search_builtin_unsupported";
    } else if (modelProvider === "google" && enableNoteTools) {
        builtInUnavailableKey = "llm_chat.web_search_unavailable_gemini";
    }
    const searchProviderUnavailableKey = modelProvider && OWN_AGENT_LOOP.has(modelProvider)
        ? "llm_chat.web_search_provider_unsupported"
        : undefined;

    const isSearchProvider = searchProviders.some(p => p.id === searchProviderId);
    const choice = !enableWebSearch ? "disabled" : isSearchProvider ? searchProviderId : "builtin";
    const usable = choice === "builtin" ? !builtInUnavailableKey : choice !== "disabled" && !searchProviderUnavailableKey;
    return {
        choice,
        builtInUnavailableKey,
        searchProviderUnavailableKey,
        enableWebSearch: usable,
        webSearchProviderId: usable && isSearchProvider ? searchProviderId : undefined
    };
}

/**
 * Resolve the active model from the available list. Several providers can expose
 * the same model ID (e.g. an Anthropic API key and a Claude subscription, or two
 * OpenAI-compatible endpoints), so the recorded provider type/config id narrow
 * the match; when they're absent (chats saved before they existed) we fall back
 * to the first ID match. Returns undefined when nothing matches — e.g. a saved
 * model ID that has since been deselected — which callers treat as "no model".
 */
export function resolveSelectedModel(
    availableModels: ModelOption[],
    selectedModel: string,
    selectedProvider: string | undefined,
    selectedProviderId: string | undefined
): ModelOption | undefined {
    if (!selectedModel) return undefined;
    return availableModels.find(m =>
        m.id === selectedModel
        && (!selectedProvider || m.provider === selectedProvider)
        && (!selectedProviderId || m.providerId === selectedProviderId));
}

/**
 * The attachments `model` cannot read natively. Text files and SVGs reach every model as text, and
 * a model without `attachmentKinds`, or no model at all, restricts nothing.
 */
export function unreadableAttachments<T extends { type: string; mime: string }>(model: LlmModelInfo | undefined, attachments: T[]): T[] {
    return attachments.filter(att => {
        const kind = nativeAttachmentKind(att.type, att.mime);
        return kind !== null && !readsAttachmentKind(model, kind);
    });
}

/** Whether `model` reads an attachment of `kind` natively. */
export function readsAttachmentKind(model: LlmModelInfo | undefined, kind: LlmAttachmentKind): boolean {
    return !model?.attachmentKinds || model.attachmentKinds.includes(kind);
}

/** The kind a model must read natively to take an attachment, or null for one every model gets as text. */
export function nativeAttachmentKind(type: string, mime: string): LlmAttachmentKind | null {
    if (type === "image") {
        return mime === "image/svg+xml" ? null : "image";
    }
    return type === "file" ? "file" : null;
}

/** Minimal shape of a provider config as stored in the `llmProviders` option. */
interface StoredProviderConfig {
    id: string;
    name: string;
    provider: string;
    kind?: LlmProviderKind;
    selectedModels?: LlmModelInfo[];
}
