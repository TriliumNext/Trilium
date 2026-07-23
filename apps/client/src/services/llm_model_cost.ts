import type { LlmModelInfo } from "@triliumnext/commons";

import { t } from "./i18n.js";

/**
 * Human-readable per-model cost hint for the model pickers: "Subscription" for
 * subscription-covered models, "$3 / $15 per Mtok" (input / output, USD per
 * million tokens) for metered ones, and undefined when pricing is unknown —
 * dynamically discovered models the price table doesn't cover. Replaces the old
 * relative "Nx" multiplier, which was only comparable within a single provider.
 */
export function formatModelCost(model: Pick<LlmModelInfo, "isSubscription" | "pricing">): string | undefined {
    if (model.isSubscription) {
        return t("llm_chat.model_cost_included");
    }
    if (!model.pricing) {
        return undefined;
    }
    // Models that run on the user's own hardware (Ollama) are priced at zero —
    // "Free" reads better there than "$0 / $0 per Mtok".
    if (model.pricing.input === 0 && model.pricing.output === 0) {
        return t("llm_chat.free");
    }
    return t("llm.model_cost_per_mtok", { input: model.pricing.input, output: model.pricing.output });
}
