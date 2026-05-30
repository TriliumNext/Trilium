import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getEffectiveThemeStyle, getThemeStyle } from "./theme.js";

type ThemeValue = string | undefined;

const win = window as unknown as {
    glob?: { theme?: ThemeValue } & Record<string, unknown>;
    getComputedStyle: typeof window.getComputedStyle;
    matchMedia?: typeof window.matchMedia;
};

const originalGetComputedStyle = win.getComputedStyle;
const originalMatchMedia = win.matchMedia;
const originalGlob = win.glob;

/** Stub window.getComputedStyle so the CSS-variable fallback path is deterministic. */
function stubComputedStyle(props: Record<string, string>) {
    win.getComputedStyle = vi.fn(() => ({
        getPropertyValue: (name: string) => props[name] ?? ""
    })) as unknown as typeof window.getComputedStyle;
}

function setTheme(theme: ThemeValue) {
    win.glob = { ...(win.glob ?? {}), theme };
}

afterEach(() => {
    win.getComputedStyle = originalGetComputedStyle;
    win.matchMedia = originalMatchMedia;
    win.glob = originalGlob;
    vi.restoreAllMocks();
});

describe("getThemeStyle", () => {
    it("maps the explicit configured themes without consulting computed styles", () => {
        const computed = vi.fn();
        win.getComputedStyle = computed as unknown as typeof window.getComputedStyle;

        setTheme("auto");
        expect(getThemeStyle()).toBe("auto");
        setTheme("next");
        expect(getThemeStyle()).toBe("auto");
        setTheme("light");
        expect(getThemeStyle()).toBe("light");
        setTheme("dark");
        expect(getThemeStyle()).toBe("dark");
        setTheme("next-light");
        expect(getThemeStyle()).toBe("light");
        setTheme("next-dark");
        expect(getThemeStyle()).toBe("dark");

        // None of the explicit branches should fall through to computed styles.
        expect(computed).not.toHaveBeenCalled();
    });

    it("falls back to the --theme-style CSS variable when auto is not enforced", () => {
        setTheme(undefined);

        stubComputedStyle({ "--theme-style": "dark", "--theme-style-auto": "false" });
        expect(getThemeStyle()).toBe("dark");

        stubComputedStyle({ "--theme-style": "light", "--theme-style-auto": "" });
        expect(getThemeStyle()).toBe("light");
    });

    it("returns auto when the CSS fallback enforces auto or has no usable value", () => {
        setTheme(undefined);

        // --theme-style-auto === "true" forces auto even if a concrete style is present.
        stubComputedStyle({ "--theme-style": "dark", "--theme-style-auto": "true" });
        expect(getThemeStyle()).toBe("auto");

        // A non light/dark CSS value also resolves to auto.
        stubComputedStyle({ "--theme-style": "sepia", "--theme-style-auto": "false" });
        expect(getThemeStyle()).toBe("auto");
    });

    it("handles a missing window.glob via optional chaining", () => {
        win.glob = undefined;
        stubComputedStyle({ "--theme-style": "light", "--theme-style-auto": "false" });
        expect(getThemeStyle()).toBe("light");
    });
});

describe("getEffectiveThemeStyle", () => {
    beforeEach(() => {
        setTheme(undefined);
        stubComputedStyle({});
    });

    it("returns the resolved concrete theme directly when not auto", () => {
        setTheme("dark");
        expect(getEffectiveThemeStyle()).toBe("dark");

        setTheme("light");
        expect(getEffectiveThemeStyle()).toBe("light");
    });

    it("uses matchMedia for the auto theme, honoring the prefers-color-scheme result", () => {
        setTheme("auto");

        win.matchMedia = vi.fn(() => ({ matches: true })) as unknown as typeof window.matchMedia;
        expect(getEffectiveThemeStyle()).toBe("dark");

        win.matchMedia = vi.fn(() => ({ matches: false })) as unknown as typeof window.matchMedia;
        expect(getEffectiveThemeStyle()).toBe("light");
    });

    it("defaults to light for the auto theme when matchMedia is unavailable", () => {
        setTheme("auto");
        win.matchMedia = undefined;
        expect(getEffectiveThemeStyle()).toBe("light");
    });
});
