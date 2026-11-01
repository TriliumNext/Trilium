import type { AiQuickActionFooter } from "@triliumnext/ckeditor5";
import type { LlmChatConfig } from "@triliumnext/commons";

import { t } from "../../../services/i18n.js";
import { type ModelOption, readSelectedModels, resolveSelectedModel } from "../../../services/llm_providers.js";
import options from "../../../services/options.js";
import { shortModelName } from "../llm_chat/model_name.js";

/**
 * The row closing the assistant's menu: which model a run speaks to, and a submenu to change it.
 *
 * The models are the ones the chat's own picker lists — both read `llmProviders` through
 * `readSelectedModels`, so the two can never disagree about what is on offer. What differs is where
 * the *choice* is kept: a chat stores it in its own note, and the assistant has no note of its own,
 * so it goes to the synced `aiAssistantModel` option and holds across notes and devices.
 *
 * Returns nothing when there is one model or none to choose between — a picker offering a single
 * answer is a row that only takes up space.
 */
export function buildAiModelPicker(): AiQuickActionFooter[] {
    const { models, groups } = readSelectedModels();

    // What a run resolves to, not what was stored: before anything is picked the row would
    // otherwise say "Default", which names no model and leaves the question it exists to answer —
    // which one am I about to spend tokens on — unanswered.
    const current = resolveModel(models);

    // A picker offering the only answer there is takes up space and settles nothing.
    if (!current || models.length < 2) {
        return [];
    }

    const name = (model: ModelOption) => shortModelName(model.name, model.provider);

    return [{
        // The row above the list still has to name one model out of several providers on its own,
        // with no heading over it to say whose it is.
        label: t("ai_assistant.model", { model: nameWithProvider(current, groups.length) }),
        iconClass: "bx bx-chip",
        children: groups.flatMap((group) => group.models.map((model, index) => ({
            label: name(model),
            // Headed by the provider it belongs to, as the chat's picker heads them — the same
            // model can be reached through two of them, and a name saying so in brackets on every
            // row says it over and over.
            ...(index === 0 && groups.length > 1 ? { heading: group.name } : {}),
            isCurrent: model === current,
            // The tick every checked row in Trilium wears, and the reserver that keeps the labels
            // of the unticked ones lined up with it. Only the menu needs them: the dialog's picker
            // has a check column of its own and reads `isCurrent`.
            iconClass: model === current ? "bx bx-check" : "bx bx-empty",
            run: () => void options.save("aiAssistantModel", JSON.stringify({
                model: model.id,
                provider: model.provider,
                providerId: model.providerId
            } satisfies StoredModel))
        })))
    }];
}

/**
 * The provider and model a run is made with.
 *
 * The provider is always named, even when no model can be: the server falls back to
 * `getProviderByType("anthropic")` for a request that names none (`runChat` in
 * `packages/trilium-core/src/services/llm/chat.ts`), which would fail outright for an
 * OpenAI-only setup and silently use the wrong provider for a mixed one. Naming the provider
 * without a model instead lets the server resolve that provider's own default.
 *
 * Nothing is said about the note tools, which is how the assistant asks for none of them: a
 * request that does not mention them does not get them, on every provider.
 */
export function pickModel(): LlmChatConfig {
    const { models, groups } = readSelectedModels();

    const chosen = resolveModel(models);
    if (chosen) {
        return { model: chosen.id, provider: chosen.provider, providerId: chosen.providerId };
    }

    const [first] = groups;
    return first ? { provider: first.provider, providerId: first.id } : {};
}

/**
 * The model a run answers with: the stored one while it is still on offer, and otherwise the same
 * first-provider default the assistant used before there was anything to store — a model can be
 * deselected, or its provider deleted, long after it was picked.
 *
 * The menu asks this too rather than asking what was stored, so the model it names and ticks is the
 * one that will actually answer.
 */
function resolveModel(models: ModelOption[]): ModelOption | undefined {
    return resolveStoredModel(models) ?? models.find((model) => model.isDefault) ?? models[0];
}

/**
 * A model named for somewhere with no heading to lean on — the row over the list. The provider
 * comes along only when more than one is configured, since that is the only time it distinguishes.
 */
function nameWithProvider(model: ModelOption, providerCount: number): string {
    const short = shortModelName(model.name, model.provider);
    return providerCount > 1 && model.providerName ? `${short} (${model.providerName})` : short;
}

/** What the `aiAssistantModel` option holds — the three fields it takes to name a model exactly. */
interface StoredModel {
    model: string;
    provider?: string;
    providerId?: string;
}

function resolveStoredModel(models: ModelOption[]): ModelOption | undefined {
    const stored = options.getJson("aiAssistantModel") as StoredModel | null;
    return stored
        ? resolveSelectedModel(models, stored.model, stored.provider, stored.providerId)
        : undefined;
}

