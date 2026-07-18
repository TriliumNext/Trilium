import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTheme, buildThemeStylesheetRefs, getConfiguredThemeStylesheets, getEffectiveThemeStyle, getThemeStyle, initThemeChangeNotifier } from "./theme.js";

// theme.ts lazily imports the app context to emit `themeChanged`; mock it so the tests capture the emission
// without pulling the whole app graph into happy-dom.
const { triggerEvent } = vi.hoisted(() => ({ triggerEvent: vi.fn() }));
vi.mock("../components/app_context.js", () => ({ default: { triggerEvent } }));

const STYLESHEETS_PATH = "/assets/stylesheets";

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

afterEach(async () => {
    // Let any pending `themeChanged` dynamic import settle before teardown, so a late emit can't leak into the
    // next test, then clear the captured calls.
    await new Promise((resolve) => setTimeout(resolve));
    win.getComputedStyle = originalGetComputedStyle;
    win.matchMedia = originalMatchMedia;
    win.glob = originalGlob;
    triggerEvent.mockClear();
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

describe("getConfiguredThemeStylesheets", () => {
    it("resolves each built-in theme to its stylesheets", () => {
        expect(getConfiguredThemeStylesheets(STYLESHEETS_PATH, "light")).toEqual([]);
        expect(getConfiguredThemeStylesheets(STYLESHEETS_PATH, "dark")).toEqual([
            { href: `${STYLESHEETS_PATH}/theme-dark.css` }
        ]);
        expect(getConfiguredThemeStylesheets(STYLESHEETS_PATH, "auto")).toEqual([
            { href: `${STYLESHEETS_PATH}/theme-dark.css`, media: "(prefers-color-scheme: dark)" }
        ]);
        expect(getConfiguredThemeStylesheets(STYLESHEETS_PATH, "next")).toEqual([
            { href: `${STYLESHEETS_PATH}/theme-next-light.css` },
            { href: `${STYLESHEETS_PATH}/theme-next-dark.css`, media: "(prefers-color-scheme: dark)" }
        ]);
        expect(getConfiguredThemeStylesheets(STYLESHEETS_PATH, "next-light")).toEqual([
            { href: `${STYLESHEETS_PATH}/theme-next-light.css` }
        ]);
        expect(getConfiguredThemeStylesheets(STYLESHEETS_PATH, "next-dark")).toEqual([
            { href: `${STYLESHEETS_PATH}/theme-next-dark.css` }
        ]);
    });

    it("uses the custom CSS URL for non-built-in themes, but never for the light baseline", () => {
        expect(getConfiguredThemeStylesheets(STYLESHEETS_PATH, "my-theme", "api/notes/download/abc123")).toEqual([
            { href: "api/notes/download/abc123" }
        ]);
        expect(getConfiguredThemeStylesheets(STYLESHEETS_PATH, "light", "api/notes/download/abc123")).toEqual([]);
        expect(getConfiguredThemeStylesheets(STYLESHEETS_PATH, "my-theme")).toEqual([]);
    });
});

describe("buildThemeStylesheetRefs", () => {
    beforeEach(() => {
        setTheme(undefined);
        win.glob = { ...(win.glob ?? {}), assetPath: "/assets" };
    });

    it("appends the base theme stylesheets underneath a custom theme", () => {
        expect(buildThemeStylesheetRefs("my-theme", "api/notes/download/abc123", "next-dark")).toEqual([
            { href: "api/notes/download/abc123" },
            { href: `${STYLESHEETS_PATH}/theme-next-dark.css` }
        ]);
    });

    it("omits base stylesheets when no base is configured", () => {
        expect(buildThemeStylesheetRefs("dark")).toEqual([
            { href: `${STYLESHEETS_PATH}/theme-dark.css` }
        ]);
    });
});

describe("applyTheme", () => {
    beforeEach(() => {
        // Prevent happy-dom from fetching the stylesheet links over the network; we only assert on the DOM.
        const happyDOM = (window as unknown as { happyDOM?: { settings: { disableCSSFileLoading: boolean } } }).happyDOM;
        if (happyDOM) {
            happyDOM.settings.disableCSSFileLoading = true;
        }
        win.glob = { ...(win.glob ?? {}), assetPath: "/assets" };
        document.head.innerHTML = "";
        document.body.removeAttribute("data-theme-id");
        // Baseline light theme link acts as the insertion anchor for swapped themes.
        const base = document.createElement("link");
        base.rel = "stylesheet";
        base.href = `${STYLESHEETS_PATH}/theme-light.css`;
        base.setAttribute("data-theme-base", "true");
        document.head.appendChild(base);
    });

    afterEach(() => {
        document.head.innerHTML = "";
    });

    it("swaps the active theme stylesheets and only removes the old ones once the new ones load", async () => {
        applyTheme("dark");
        fireLoadOnPendingThemeLinks();
        await Promise.resolve();
        expect(themeStylesheetHrefs()).toEqual([`${STYLESHEETS_PATH}/theme-dark.css`]);

        // Switching to next adds the new links before the old dark link is removed.
        applyTheme("next");
        expect(themeStylesheetHrefs()).toEqual([
            `${STYLESHEETS_PATH}/theme-dark.css`,
            `${STYLESHEETS_PATH}/theme-next-light.css`,
            `${STYLESHEETS_PATH}/theme-next-dark.css`
        ]);

        fireLoadOnPendingThemeLinks();
        await Promise.resolve();
        expect(themeStylesheetHrefs()).toEqual([
            `${STYLESHEETS_PATH}/theme-next-light.css`,
            `${STYLESHEETS_PATH}/theme-next-dark.css`
        ]);
        expect(document.body.getAttribute("data-theme-id")).toBe("next");
    });

    it("removes theme stylesheets when switching to the bare light baseline", async () => {
        applyTheme("dark");
        fireLoadOnPendingThemeLinks();
        expect(themeStylesheetHrefs()).toHaveLength(1);

        applyTheme("light");
        // No new links to wait for, so the swap finalizes on the next microtask.
        await Promise.resolve();
        expect(themeStylesheetHrefs()).toHaveLength(0);
        expect(document.body.getAttribute("data-theme-id")).toBe("light");
        // The baseline light link is preserved.
        expect(document.head.querySelector("link[data-theme-base]")).not.toBeNull();
    });

    it("updates window.glob so the active theme metadata stays current", () => {
        applyTheme("my-theme", "api/notes/download/abc123", "next-dark");
        expect(win.glob?.theme).toBe("my-theme");
        expect(win.glob?.customThemeCssUrl).toBe("api/notes/download/abc123");
        expect(win.glob?.themeBase).toBe("next-dark");
    });

    it("emits themeChanged once the new stylesheet has loaded", async () => {
        applyTheme("dark");
        fireLoadOnPendingThemeLinks();
        await vi.waitFor(() => expect(triggerEvent).toHaveBeenCalledWith("themeChanged", { themeStyle: "dark" }));
    });

    it("does not emit themeChanged when the swap rolls back", async () => {
        applyTheme("dark");
        fireLoadOnPendingThemeLinks();
        await vi.waitFor(() => expect(triggerEvent).toHaveBeenCalled());
        triggerEvent.mockClear();

        applyTheme("my-theme", "api/notes/download/missing");
        document.head.querySelector(`link[href="api/notes/download/missing"]`)?.dispatchEvent(new Event("error"));
        await new Promise((resolve) => setTimeout(resolve));
        expect(triggerEvent).not.toHaveBeenCalled();
    });

    it("keeps the previous theme when a new stylesheet fails to load", async () => {
        applyTheme("dark");
        fireLoadOnPendingThemeLinks();
        await Promise.resolve();

        // A failing single-stylesheet theme rolls back the swap, including the glob metadata.
        applyTheme("my-theme", "api/notes/download/missing");
        const failedLink = document.head.querySelector<HTMLLinkElement>(`link[href="api/notes/download/missing"]`);
        expect(failedLink).not.toBeNull();
        failedLink?.dispatchEvent(new Event("error"));
        await Promise.resolve();

        expect(themeStylesheetHrefs()).toEqual([`${STYLESHEETS_PATH}/theme-dark.css`]);
        expect(document.body.getAttribute("data-theme-id")).toBe("dark");
        expect(win.glob?.theme).toBe("dark");
        expect(win.glob?.customThemeCssUrl).toBeUndefined();

        // A partial failure of a multi-stylesheet theme also rolls back fully, removing the
        // stylesheets that did load.
        applyTheme("next");
        const loadedLink = document.head.querySelector<HTMLLinkElement>(`link[href="${STYLESHEETS_PATH}/theme-next-light.css"]`);
        const erroredLink = document.head.querySelector<HTMLLinkElement>(`link[href="${STYLESHEETS_PATH}/theme-next-dark.css"]`);
        loadedLink?.dispatchEvent(new Event("load"));
        erroredLink?.dispatchEvent(new Event("error"));
        await Promise.resolve();

        expect(themeStylesheetHrefs()).toEqual([`${STYLESHEETS_PATH}/theme-dark.css`]);
        expect(document.body.getAttribute("data-theme-id")).toBe("dark");
        expect(win.glob?.theme).toBe("dark");
    });
});

describe("initThemeChangeNotifier", () => {
    beforeEach(() => {
        setTheme(undefined);
        stubComputedStyle({});
        triggerEvent.mockClear();
    });

    /** Fake MediaQueryList whose `matches` is mutable and whose `change` listener we can fire by hand. */
    function installMatchMedia(matches: boolean) {
        const state: { matches: boolean; listener?: () => void } = { matches, listener: undefined };
        win.matchMedia = vi.fn(() => ({
            get matches() { return state.matches; },
            addEventListener: (_type: string, listener: () => void) => { state.listener = listener; },
            removeEventListener: vi.fn()
        })) as unknown as typeof window.matchMedia;
        return state;
    }

    it("emits themeChanged on an OS light/dark flip while an auto theme follows the OS", async () => {
        setTheme("auto");
        const mql = installMatchMedia(false);
        initThemeChangeNotifier();

        mql.matches = true;
        mql.listener?.();
        await vi.waitFor(() => expect(triggerEvent).toHaveBeenCalledWith("themeChanged", { themeStyle: "dark" }));
    });

    it("ignores OS flips for a fixed theme that does not follow the OS", async () => {
        setTheme("dark");
        const mql = installMatchMedia(false);
        initThemeChangeNotifier();

        mql.matches = true;
        mql.listener?.();
        await new Promise((resolve) => setTimeout(resolve));
        expect(triggerEvent).not.toHaveBeenCalled();
    });
});

function themeStylesheetHrefs() {
    return Array.from(document.head.querySelectorAll<HTMLLinkElement>("link[data-theme-stylesheet]"))
        .map((link) => link.getAttribute("href"));
}

/** happy-dom does not fetch stylesheets, so emulate the pending links finishing loading. */
function fireLoadOnPendingThemeLinks() {
    for (const link of document.head.querySelectorAll<HTMLLinkElement>("link[data-theme-stylesheet]")) {
        link.dispatchEvent(new Event("load"));
    }
}
