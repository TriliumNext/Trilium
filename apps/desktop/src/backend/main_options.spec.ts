import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({
    getOption: vi.fn<(name: string) => string>(),
    getOptionBool: vi.fn<(name: string) => boolean>()
}));

vi.mock("@triliumnext/core", () => ({ options: core }));

const { applyOptionChange, getOption, getOptionBool, isBackendOutOfProcess, readOptionSnapshot, useOptionReplica } =
    await import("./main_options.js");

describe("main process option reads", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // The module is stateful and the replica is a one-way switch, so the in-process
    // assertions have to run before anything installs one. Kept in one test for that
    // ordering rather than split across two that vitest may reorder.
    it("falls through to core until a replica is installed, then answers from it alone", () => {
        core.getOption.mockReturnValue("en-GB,de");
        core.getOptionBool.mockReturnValue(true);

        expect(isBackendOutOfProcess()).toBe(false);
        expect(getOption("spellCheckLanguageCode")).toBe("en-GB,de");
        expect(getOptionBool("spellCheckEnabled")).toBe(true);
        expect(core.getOption).toHaveBeenCalledWith("spellCheckLanguageCode");
        expect(core.getOptionBool).toHaveBeenCalledWith("spellCheckEnabled");

        // A change with no replica has nothing to write to, and must not resurrect one.
        applyOptionChange("closeToTray", "true");
        expect(isBackendOutOfProcess()).toBe(false);

        useOptionReplica({ spellCheckEnabled: "false", spellCheckLanguageCode: "fr" });
        vi.clearAllMocks();

        expect(isBackendOutOfProcess()).toBe(true);
        expect(getOptionBool("spellCheckEnabled")).toBe(false);
        expect(getOption("spellCheckLanguageCode")).toBe("fr");
        // Whatever the value, core is no longer here to ask.
        expect(core.getOption).not.toHaveBeenCalled();
        expect(core.getOptionBool).not.toHaveBeenCalled();

        // Anything the snapshot did not carry reads as absent rather than as core's value.
        expect(getOption("closeToTray")).toBeUndefined();
        expect(getOptionBool("closeToTray")).toBe(false);

        applyOptionChange("closeToTray", "true");
        expect(getOptionBool("closeToTray")).toBe(true);
    });

    it("snapshots only the options the database actually holds", () => {
        const stored: Record<string, string> = { disableTray: "true", spellCheckEnabled: "false" };
        const snapshot = readOptionSnapshot((name) => stored[name] ?? null);

        expect(snapshot).toEqual({ disableTray: "true", spellCheckEnabled: "false" });
        expect("closeToTray" in snapshot).toBe(false);
    });
});
