import { t } from "./i18n";
import options from "./options";

export interface ExperimentalFeature {
    id: string;
    name: string;
    description: string;
}

export const experimentalFeatures = [
    {
        id: "llm",
        name: t("experimental_features.llm_name"),
        description: t("experimental_features.llm_description"),
    }
] as const satisfies ExperimentalFeature[];

export type ExperimentalFeatureId = typeof experimentalFeatures[number]["id"];

/** Returns experimental features available for the current platform. */
export function getAvailableExperimentalFeatures() {
    return experimentalFeatures;
}

let enabledFeatures: Set<ExperimentalFeatureId> | null = null;

export function isExperimentalFeatureEnabled(featureId: ExperimentalFeatureId): boolean {
    if (featureId === "llm") {
        return options.is("aiEnabled");
    }

    return getEnabledFeatures().has(featureId);
}

export function getEnabledExperimentalFeatureIds() {
    const values = [ ...getEnabledFeatures().values() ];
    if (options.is("aiEnabled")) {
        values.push("llm");
    }
    return values;
}

function getEnabledFeatures() {
    if (!enabledFeatures) {
        let features: ExperimentalFeatureId[] = [];
        try {
            features = JSON.parse(options.get("experimentalFeatures")) as ExperimentalFeatureId[];
        } catch (e) {
            console.warn("Failed to parse experimental features from options:", e);
        }
        enabledFeatures = new Set(features);
        enabledFeatures.delete("llm"); // handled separately, via the aiEnabled option.
    }
    return enabledFeatures;
}
