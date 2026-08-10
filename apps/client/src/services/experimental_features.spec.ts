import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared, mutable control state for the utils mock. `vi.hoisted` runs before
// the hoisted `vi.mock` factory, so the factory can safely reference it.
const ctrl = vi.hoisted(() => ({ mobile: false }));

// Partial-mock ./utils so we can flip `isMobile` at runtime, while keeping the
// rest of the real module intact (e.g. `isShare` used by options.ts).
vi.mock("./utils.js", async (orig) => {
    const actual = (await orig()) as Record<string, unknown>;
    return {
        ...actual,
        isMobile: () => ctrl.mobile
    };
});

// `enabledFeatures` is module-level cached on first read of getEnabledFeatures,
// so each scenario re-imports a fresh module copy. The fresh copy binds to a
// fresh `options` singleton, so we re-import and spy on THAT instance.
async function freshModule(stored: unknown, opts: { newLayout?: boolean; aiEnabled?: boolean } = {}) {
    vi.resetModules();
    const options = (await import("./options.js")).default;
    vi.spyOn(options, "get").mockReturnValue(
        typeof stored === "string" ? stored : JSON.stringify(stored)
    );
    vi.spyOn(options, "is").mockImplementation((name) => {
        if (name === "newLayout") return opts.newLayout ?? false;
        if (name === "aiEnabled") return opts.aiEnabled ?? false;
        return false;
    });
    const mod = (await import("./experimental_features.js")) as typeof import("./experimental_features.js");
    return { mod, options };
}

describe("experimental_features", () => {
    beforeEach(() => {
        ctrl.mobile = false;
        vi.restoreAllMocks();
    });

    it("lists every feature", async () => {
        const { mod } = await freshModule([]);
        expect(mod.getAvailableExperimentalFeatures().map((f) => f.id)).toEqual(["new-layout", "llm"]);
    });

    it("new-layout is enabled via mobile or the newLayout option", async () => {
        // neither mobile nor option -> disabled
        const { mod } = await freshModule([]);
        ctrl.mobile = false;
        expect(mod.isExperimentalFeatureEnabled("new-layout")).toBe(false);

        // mobile short-circuits to enabled
        ctrl.mobile = true;
        expect(mod.isExperimentalFeatureEnabled("new-layout")).toBe(true);

        // not mobile but the option is true -> enabled
        const opt = await freshModule([], { newLayout: true });
        ctrl.mobile = false;
        expect(opt.mod.isExperimentalFeatureEnabled("new-layout")).toBe(true);
    });

    it("llm enablement is driven by the aiEnabled option", async () => {
        const enabled = await freshModule([], { aiEnabled: true });
        expect(enabled.mod.isExperimentalFeatureEnabled("llm")).toBe(true);

        // a stale "llm" entry in the persisted experimental set no longer counts
        const disabled = await freshModule(["llm"]);
        expect(disabled.mod.isExperimentalFeatureEnabled("llm")).toBe(false);
    });

    it("drops new-layout and llm from the persisted set and re-derives them separately", async () => {
        ctrl.mobile = false;

        // both stored entries are stripped; with the options off nothing is re-added
        const stripped = await freshModule(["new-layout", "llm"]);
        expect(stripped.mod.getEnabledExperimentalFeatureIds()).toEqual([]);

        // the dedicated options re-add the respective features
        const readded = await freshModule([], { newLayout: true, aiEnabled: true });
        expect(readded.mod.getEnabledExperimentalFeatureIds().sort()).toEqual(["llm", "new-layout"]);
    });

    it("adds new-layout via mobile alongside an option-driven llm", async () => {
        const { mod } = await freshModule([], { aiEnabled: true });
        ctrl.mobile = true;
        expect(mod.getEnabledExperimentalFeatureIds()).toEqual(["new-layout", "llm"]);
    });

    it("warns and treats the set as empty when persisted JSON is invalid", async () => {
        ctrl.mobile = false;
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { mod } = await freshModule("not-json");
        expect(mod.getEnabledExperimentalFeatureIds()).toEqual([]);
        expect(warn).toHaveBeenCalled();
    });

    it("toggleExperimentalFeature adds/removes a feature and persists the set", async () => {
        const { mod, options } = await freshModule([]);
        const save = vi.spyOn(options, "save").mockResolvedValue(undefined);

        await mod.toggleExperimentalFeature("llm", true);
        expect(save).toHaveBeenLastCalledWith("experimentalFeatures", JSON.stringify(["llm"]));

        await mod.toggleExperimentalFeature("llm", false);
        expect(save).toHaveBeenLastCalledWith("experimentalFeatures", JSON.stringify([]));
    });
});
