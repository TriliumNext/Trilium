import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../services/i18n.js", () => ({
    t: (key: string, values?: Record<string, string>) => (values
        ? `${key}(${Object.entries(values).map(([name, value]) => `${name}=${value}`).join(",")})`
        : key)
}));
vi.mock("../../../services/options.js", () => ({
    default: {
        getJson: (key: string) => stored[key] ?? null,
        save: vi.fn(async (key: string, value: string) => {
            stored[key] = JSON.parse(value);
        })
    }
}));

import options from "../../../services/options.js";
import { buildAiModelPicker, pickModel } from "./ai_model_picker.js";

/** Whatever the mocked options store holds, keyed as the option names. */
let stored: Record<string, unknown> = {};

const TWO_PROVIDERS = [
    {
        id: "cfg-anthropic",
        name: "Anthropic",
        provider: "anthropic",
        selectedModels: [
            { id: "claude-opus-5", name: "Claude Opus 5" },
            { id: "claude-sonnet-5", name: "Claude Sonnet 5", isDefault: true }
        ]
    },
    {
        id: "cfg-openai",
        name: "OpenAI",
        provider: "openai",
        selectedModels: [{ id: "gpt-5", name: "GPT-5" }]
    }
];

/** Each row as it reads: the heading it opens a block with, its label, and its icon slot. */
function rowsOf(picker: ReturnType<typeof buildAiModelPicker>) {
    return (picker[0]?.children ?? []).map((row) => [row.heading ?? "", row.label, row.iconClass]);
}

describe("the AI assistant's model picker", () => {
    beforeEach(() => {
        stored = {};
        vi.mocked(options.save).mockClear();
    });

    it("lists every configured model, ticking the stored one and naming it in the row above", () => {
        stored.llmProviders = TWO_PROVIDERS;
        stored.aiAssistantModel = { model: "gpt-5", provider: "openai", providerId: "cfg-openai" };

        const picker = buildAiModelPicker();
        // More than one provider is configured, so a row says which one it means: the same model id
        // can be reached through two of them.
        expect(picker[0].label).toBe("ai_assistant.model(model=GPT-5 (OpenAI))");
        // Headed by their provider rather than trailing it in brackets on every row.
        expect(rowsOf(picker)).toEqual([
            ["Anthropic", "Opus 5", "bx bx-empty"],
            ["", "Sonnet 5", "bx bx-empty"],
            ["OpenAI", "GPT-5", "bx bx-check"]
        ]);
    });

    // Before anything is picked the row still names a model — the one a run would resolve to —
    // rather than saying "Default", which answers nothing. The provider goes with one configured.
    it("names what a run would resolve to while nothing has been picked", () => {
        stored.llmProviders = [TWO_PROVIDERS[0]];

        const picker = buildAiModelPicker();
        expect(picker[0].label).toBe("ai_assistant.model(model=Sonnet 5)");
        // One provider distinguishes nothing, so no heading and no bracket.
        expect(rowsOf(picker)).toEqual([["", "Opus 5", "bx bx-empty"], ["", "Sonnet 5", "bx bx-check"]]);
    });

    // Nothing flagged, so the first one answers — and the row says so.
    it("falls back to the first model when none is flagged as the default", () => {
        stored.llmProviders = [{ ...TWO_PROVIDERS[0], selectedModels: TWO_PROVIDERS[0].selectedModels.map(({ id, name }) => ({ id, name })) }];

        expect(buildAiModelPicker()[0].label).toBe("ai_assistant.model(model=Opus 5)");
    });

    // The stored model is gone, so the row names the one that replaced it rather than a stale name.
    it("names the fallback once the stored model is no longer on offer", () => {
        stored.llmProviders = TWO_PROVIDERS;
        stored.aiAssistantModel = { model: "gpt-4", provider: "openai", providerId: "cfg-openai" };

        const picker = buildAiModelPicker();
        expect(picker[0].label).toBe("ai_assistant.model(model=Sonnet 5 (Anthropic))");
        expect(rowsOf(picker).filter(([, , icon]) => icon === "bx bx-check"))
            .toEqual([["", "Sonnet 5", "bx bx-check"]]);
    });

    // A row offering the only answer there is takes up space and settles nothing.
    it("offers no picker when there is nothing to choose between", () => {
        expect(buildAiModelPicker()).toEqual([]);

        stored.llmProviders = [{ ...TWO_PROVIDERS[1] }];
        expect(buildAiModelPicker()).toEqual([]);
    });

    it("stores the model picked, provider and all", () => {
        stored.llmProviders = TWO_PROVIDERS;

        buildAiModelPicker()[0].children?.[0].run?.();

        expect(options.save).toHaveBeenCalledWith("aiAssistantModel", JSON.stringify({
            model: "claude-opus-5", provider: "anthropic", providerId: "cfg-anthropic"
        }));
    });

    describe("pickModel", () => {
        it("runs on the stored model", () => {
            stored.llmProviders = TWO_PROVIDERS;
            stored.aiAssistantModel = { model: "gpt-5", provider: "openai", providerId: "cfg-openai" };

            expect(pickModel()).toEqual({ model: "gpt-5", provider: "openai", providerId: "cfg-openai" });
        });

        // A model can be deselected, or its provider deleted, long after it was picked.
        it("falls back to the flagged default when the stored model is no longer on offer", () => {
            stored.llmProviders = TWO_PROVIDERS;
            stored.aiAssistantModel = { model: "gpt-4", provider: "openai", providerId: "cfg-openai" };

            expect(pickModel()).toMatchObject({ model: "claude-sonnet-5", providerId: "cfg-anthropic" });
        });

        // Naming no provider at all makes the server fall back to Anthropic, which is wrong for an
        // OpenAI-only setup; naming one without a model lets it resolve that provider's own default.
        it("names the provider even when it has no model to name", () => {
            stored.llmProviders = [{ id: "cfg-openai", name: "OpenAI", provider: "openai" }];

            expect(pickModel()).toEqual({ provider: "openai", providerId: "cfg-openai" });
            expect(pickModel()).not.toHaveProperty("model");
        });

        it("names nothing at all when no provider is configured", () => {
            expect(pickModel()).toEqual({});
        });
    });
});
