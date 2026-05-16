import { t } from "./i18n";
import options from "./options";
import { isMobile, isStandalone } from "./utils";

export interface ExperimentalFeature {
    id: string;
    name: string;
    description: string;
}

export const experimentalFeatures = [
    {
        id: "new-layout",
        name: t("experimental_features.new_layout_name"),
        description: t("experimental_features.new_layout_description"),
    },
    {
        id: "llm",
        name: t("experimental_features.llm_name"),
        description: t("experimental_features.llm_description"),
    }
] as const satisfies ExperimentalFeature[];

export type ExperimentalFeatureId = typeof experimentalFeatures[number]["id"];

/** Returns experimental features available for the current platform (excludes LLM in standalone mode). */
export function getAvailableExperimentalFeatures() {
    return experimentalFeatures.filter(f => !(f.id === "llm" && isStandalone));
}

let enabledFeatures: Set<ExperimentalFeatureId> | null = null;

export function isExperimentalFeatureEnabled(featureId: ExperimentalFeatureId): boolean {
    if (featureId === "new-layout") {
        return (isMobile() || options.is("newLayout"));
    }

    // LLM features require server-side API calls that don't work in standalone mode
    // due to CORS restrictions from LLM providers (OpenAI, Google don't allow browser requests)
    if (featureId === "llm" && isStandalone) {
        return false;
    }

    return getEnabledFeatures().has(featureId);
}

export function getEnabledExperimentalFeatureIds() {
    let values = [ ...getEnabledFeatures().values() ];
    if (isMobile() || options.is("newLayout")) {
        values.push("new-layout");
    }
    // LLM is not available in standalone mode
    if (isStandalone) {
        values = values.filter(v => v !== "llm");
    }
    return values;
}

export async function toggleExperimentalFeature(featureId: ExperimentalFeatureId, enable: boolean) {
    const features = new Set(getEnabledFeatures());
    if (enable) {
        features.add(featureId);
    } else {
        features.delete(featureId);
    }
    await options.save("experimentalFeatures", JSON.stringify(Array.from(features)));
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
        enabledFeatures.delete("new-layout"); // handled separately.
    }
    return enabledFeatures;
}
