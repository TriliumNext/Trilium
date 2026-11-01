import { describe, expect, it } from "vitest";

import { getNextColorSchemeTheme, resolveColorScheme } from "./color_scheme.js";

describe("resolveColorScheme", () => {
    it("resolves each built-in theme to its family and scheme", () => {
        expect(resolveColorScheme("next")).toEqual({ family: "modern", scheme: "system", isCustom: false });
        expect(resolveColorScheme("next-light")).toEqual({ family: "modern", scheme: "light", isCustom: false });
        expect(resolveColorScheme("next-dark")).toEqual({ family: "modern", scheme: "dark", isCustom: false });
        expect(resolveColorScheme("auto")).toEqual({ family: "legacy", scheme: "system", isCustom: false });
        expect(resolveColorScheme("light")).toEqual({ family: "legacy", scheme: "light", isCustom: false });
        expect(resolveColorScheme("dark")).toEqual({ family: "legacy", scheme: "dark", isCustom: false });
    });

    it("treats unknown, empty and nullish themes as custom", () => {
        for (const theme of [ "my-theme", "", null, undefined ]) {
            expect(resolveColorScheme(theme)).toEqual({ family: null, scheme: "system", isCustom: true });
        }
    });
});

describe("getNextColorSchemeTheme", () => {
    it("cycles system → light → dark → system while keeping the family", () => {
        expect(getNextColorSchemeTheme("next")).toBe("next-light");
        expect(getNextColorSchemeTheme("next-light")).toBe("next-dark");
        expect(getNextColorSchemeTheme("next-dark")).toBe("next");

        expect(getNextColorSchemeTheme("auto")).toBe("light");
        expect(getNextColorSchemeTheme("light")).toBe("dark");
        expect(getNextColorSchemeTheme("dark")).toBe("auto");
    });

    it("returns null for a custom theme that cannot switch color scheme", () => {
        expect(getNextColorSchemeTheme("my-theme")).toBeNull();
        expect(getNextColorSchemeTheme(null)).toBeNull();
    });
});
