import { beforeEach, describe, expect, it, vi } from "vitest";

// `enabledFeatures` is module-level cached on first read of getEnabledFeatures,
// so each scenario re-imports a fresh module copy. The fresh copy binds to a
// fresh `options` singleton, so we re-import and spy on THAT instance.
async function freshModule(stored: unknown, opts: { aiEnabled?: boolean } = {}) {
    vi.resetModules();
    const options = (await import("./options.js")).default;
    vi.spyOn(options, "get").mockReturnValue(
        typeof stored === "string" ? stored : JSON.stringify(stored)
    );
    vi.spyOn(options, "is").mockImplementation((name) => {
        if (name === "aiEnabled") return opts.aiEnabled ?? false;
        return false;
    });
    const mod = (await import("./experimental_features.js")) as typeof import("./experimental_features.js");
    return { mod, options };
}

describe("experimental_features", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("lists every feature", async () => {
        const { mod } = await freshModule([]);
        expect(mod.getAvailableExperimentalFeatures().map((f) => f.id)).toEqual(["llm"]);
    });

    it("llm enablement is driven by the aiEnabled option", async () => {
        const enabled = await freshModule([], { aiEnabled: true });
        expect(enabled.mod.isExperimentalFeatureEnabled("llm")).toBe(true);

        // a stale "llm" entry in the persisted experimental set no longer counts
        const disabled = await freshModule(["llm"]);
        expect(disabled.mod.isExperimentalFeatureEnabled("llm")).toBe(false);
    });

    it("drops llm from the persisted set and re-derives it from the aiEnabled option", async () => {
        const stripped = await freshModule(["llm"]);
        expect(stripped.mod.getEnabledExperimentalFeatureIds()).toEqual([]);

        const readded = await freshModule([], { aiEnabled: true });
        expect(readded.mod.getEnabledExperimentalFeatureIds()).toEqual(["llm"]);
    });

    it("warns and treats the set as empty when persisted JSON is invalid", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { mod } = await freshModule("not-json");
        expect(mod.getEnabledExperimentalFeatureIds()).toEqual([]);
        expect(warn).toHaveBeenCalled();
    });
});
