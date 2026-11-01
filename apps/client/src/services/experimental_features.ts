import options from "./options";

export interface ExperimentalFeature {
    id: string;
    name: string;
    description: string;
}

// Not translated: experimental features are temporary.
export const experimentalFeatures = [
    {
        id: "llm",
        name: "AI / LLM Chat",
        description: "Enable the AI chat sidebar and LLM chat notes powered by large language "
            + "models."
    },
    {
        id: "extendedCodeBlocks",
        name: "Extended code blocks",
        description: "A faster code block with a more advanced syntax highlighting engine and "
            + "code folding."
    },
    {
        id: "sortSelection",
        name: "Sort selection in text editor",
        description: "Sort the selected paragraphs, list items or table rows of a text note from "
            + "the formatting toolbar, the block handle and the context menu."
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
