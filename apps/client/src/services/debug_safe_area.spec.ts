import { afterEach, describe, expect, it } from "vitest";

import simulateSafeAreaInsets, { parseSafeAreaInsets } from "./debug_safe_area";

describe("debug_safe_area", () => {
    afterEach(() => {
        document.documentElement.removeAttribute("style");
        document.querySelector(".debug-safe-area-overlay")?.remove();
    });

    it("expands the CSS padding shorthand and rejects malformed values", () => {
        expect(parseSafeAreaInsets("48")).toEqual({ top: 48, right: 48, bottom: 48, left: 48 });
        expect(parseSafeAreaInsets("24 0")).toEqual({ top: 24, right: 0, bottom: 24, left: 0 });
        expect(parseSafeAreaInsets(" 24 0 48 ")).toEqual({ top: 24, right: 0, bottom: 48, left: 0 });
        expect(parseSafeAreaInsets("1 2 3 4")).toEqual({ top: 1, right: 2, bottom: 3, left: 4 });

        expect(parseSafeAreaInsets("1 2 3 4 5")).toBeNull();
        expect(parseSafeAreaInsets("48px")).toBeNull();
        expect(parseSafeAreaInsets("0 -8")).toBeNull();
    });

    it("sets the inset properties and adds the overlay", () => {
        simulateSafeAreaInsets("0 0 48 0");

        const style = document.documentElement.style;
        expect(style.getPropertyValue("--safe-area-inset-top")).toBe("0px");
        expect(style.getPropertyValue("--safe-area-inset-bottom")).toBe("48px");
        expect(document.querySelectorAll(".debug-safe-area-overlay")).toHaveLength(1);
    });

    it("leaves the page alone for a malformed value", () => {
        simulateSafeAreaInsets("tall");

        expect(document.documentElement.style.getPropertyValue("--safe-area-inset-bottom")).toBe("");
        expect(document.querySelector(".debug-safe-area-overlay")).toBeNull();
    });
});
