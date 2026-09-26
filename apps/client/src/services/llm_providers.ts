import type { LlmAttachmentKind, LlmModelInfo } from "@triliumnext/commons";

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
    const configs = (options.getJson("llmProviders") as StoredProviderConfig[] | null) ?? [];
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
    selectedModels?: LlmModelInfo[];
}
