import { beforeEach, describe, expect, it, vi } from "vitest";

// Shared, mutable control state for the utils mock. `vi.hoisted` runs before
// the hoisted `vi.mock` factory, so the factory can safely reference it.
const ctrl = vi.hoisted(() => ({ standalone: false, mobile: false }));

// Partial-mock ./utils so we can flip `isStandalone` (a const in the target,
// read here as a live getter) and `isMobile` at runtime, while keeping the
// rest of the real module intact (e.g. `isShare` used by options.ts).
vi.mock("./utils.js", async (orig) => {
    const actual = (await orig()) as Record<string, unknown>;
    return {
        ...actual,
        isMobile: () => ctrl.mobile,
        get isStandalone() {
            return ctrl.standalone;
        }
    };
});

// `enabledFeatures` is module-level cached on first read of getEnabledFeatures,
// so each scenario re-imports a fresh module copy. The fresh copy binds to a
// fresh `options` singleton, so we re-import and spy on THAT instance.
async function freshModule(stored: unknown, isNewLayout: boolean) {
    vi.resetModules();
    const options = (await import("./options.js")).default;
    vi.spyOn(options, "get").mockReturnValue(
        typeof stored === "string" ? stored : JSON.stringify(stored)
    );
    vi.spyOn(options, "is").mockReturnValue(isNewLayout);
    const mod = (await import("./experimental_features.js")) as typeof import("./experimental_features.js");
    return { mod, options };
}

describe("experimental_features", () => {
    beforeEach(() => {
        ctrl.standalone = false;
        ctrl.mobile = false;
        vi.restoreAllMocks();
    });

    it("lists all features when not standalone, hides llm in standalone", async () => {
        const { mod } = await freshModule([], false);

        ctrl.standalone = false;
        expect(mod.getAvailableExperimentalFeatures().map((f) => f.id)).toEqual(["new-layout", "llm"]);

        ctrl.standalone = true;
        expect(mod.getAvailableExperimentalFeatures().map((f) => f.id)).toEqual(["new-layout"]);
    });

    it("new-layout is enabled via mobile or the newLayout option", async () => {
        // neither mobile nor option -> disabled
        const { mod } = await freshModule([], false);
        ctrl.mobile = false;
        expect(mod.isExperimentalFeatureEnabled("new-layout")).toBe(false);

        // mobile short-circuits to enabled
        ctrl.mobile = true;
        expect(mod.isExperimentalFeatureEnabled("new-layout")).toBe(true);

        // not mobile but the option is true -> enabled
        const opt = await freshModule([], true);
        ctrl.mobile = false;
        expect(opt.mod.isExperimentalFeatureEnabled("new-layout")).toBe(true);
    });

    it("llm is always disabled in standalone mode", async () => {
        const { mod } = await freshModule(["llm"], false);
        ctrl.standalone = true;
        expect(mod.isExperimentalFeatureEnabled("llm")).toBe(false);
    });

    it("non-standalone llm enablement is driven by the persisted feature set", async () => {
        ctrl.standalone = false;

        const enabled = await freshModule(["llm"], false);
        expect(enabled.mod.isExperimentalFeatureEnabled("llm")).toBe(true);

        const disabled = await freshModule([], false);
        expect(disabled.mod.isExperimentalFeatureEnabled("llm")).toBe(false);
    });

    it("drops new-layout from the persisted set and re-derives it separately", async () => {
        ctrl.standalone = false;
        ctrl.mobile = false;

        // new-layout in the stored set is stripped; only llm survives, and
        // with the option off it is not re-added
        const stripped = await freshModule(["new-layout", "llm"], false);
        expect(stripped.mod.getEnabledExperimentalFeatureIds()).toEqual(["llm"]);

        // newLayout option true re-adds "new-layout"
        const readded = await freshModule(["llm"], true);
        expect(readded.mod.getEnabledExperimentalFeatureIds().sort()).toEqual(["llm", "new-layout"]);
    });

    it("adds new-layout via mobile and filters llm out in standalone", async () => {
        const { mod } = await freshModule(["llm"], false);
        ctrl.standalone = true;
        ctrl.mobile = true;
        // mobile -> new-layout added; standalone -> llm removed
        expect(mod.getEnabledExperimentalFeatureIds()).toEqual(["new-layout"]);
    });

    it("warns and treats the set as empty when persisted JSON is invalid", async () => {
        ctrl.standalone = false;
        ctrl.mobile = false;
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { mod } = await freshModule("not-json", false);
        expect(mod.getEnabledExperimentalFeatureIds()).toEqual([]);
        expect(warn).toHaveBeenCalled();
    });

    it("toggleExperimentalFeature adds/removes a feature and persists the set", async () => {
        ctrl.standalone = false;
        const { mod, options } = await freshModule([], false);
        const save = vi.spyOn(options, "save").mockResolvedValue(undefined);

        await mod.toggleExperimentalFeature("llm", true);
        expect(save).toHaveBeenLastCalledWith("experimentalFeatures", JSON.stringify(["llm"]));

        await mod.toggleExperimentalFeature("llm", false);
        expect(save).toHaveBeenLastCalledWith("experimentalFeatures", JSON.stringify([]));
    });
});
