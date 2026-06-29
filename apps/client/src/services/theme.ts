import { readCssVar } from "../utils/css-var.js";

export function getThemeStyle(): "auto" | "light" | "dark" {
    const configuredTheme = window.glob?.theme;
    if (configuredTheme === "auto" || configuredTheme === "next") {
        return "auto";
    }

    if (configuredTheme === "light" || configuredTheme === "dark") {
        return configuredTheme;
    }

    if (configuredTheme === "next-light") {
        return "light";
    }

    if (configuredTheme === "next-dark") {
        return "dark";
    }

    const style = window.getComputedStyle(document.body);
    const themeStyle = style.getPropertyValue("--theme-style");
    if (style.getPropertyValue("--theme-style-auto") !== "true" && (themeStyle === "light" || themeStyle === "dark")) {
        return themeStyle as "light" | "dark";
    }

    return "auto";
}

export function getEffectiveThemeStyle(): "light" | "dark" {
    const themeStyle = getThemeStyle();
    if (themeStyle === "auto") {
        return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }

    return themeStyle === "dark" ? "dark" : "light";
}

export interface StylesheetRef {
    href: string;
    media?: string;
}

type ThemeBase = "next" | "next-light" | "next-dark";

/** Built-in themes whose stylesheets can be resolved purely on the client, without a server lookup. */
const BUILTIN_THEMES = new Set([ "auto", "light", "dark", "next", "next-light", "next-dark" ]);

/** Marks the always-present baseline `theme-light.css` link, used as the insertion anchor when swapping themes. */
const THEME_BASE_ATTR = "data-theme-base";

/** Marks the swappable theme stylesheet links so they can be replaced when the theme changes. */
const THEME_STYLESHEET_ATTR = "data-theme-stylesheet";

export function getConfiguredThemeStylesheets(stylesheetsPath: string, theme: string, customThemeCssUrl?: string): StylesheetRef[] {
    if (theme === "auto") {
        return [{ href: `${stylesheetsPath}/theme-dark.css`, media: "(prefers-color-scheme: dark)" }];
    }

    if (theme === "dark") {
        return [{ href: `${stylesheetsPath}/theme-dark.css` }];
    }

    if (theme === "next") {
        return [
            { href: `${stylesheetsPath}/theme-next-light.css` },
            { href: `${stylesheetsPath}/theme-next-dark.css`, media: "(prefers-color-scheme: dark)" }
        ];
    }

    if (theme === "next-light") {
        return [{ href: `${stylesheetsPath}/theme-next-light.css` }];
    }

    if (theme === "next-dark") {
        return [{ href: `${stylesheetsPath}/theme-next-dark.css` }];
    }

    if (theme !== "light" && customThemeCssUrl) {
        return [{ href: customThemeCssUrl }];
    }

    return [];
}

/** Resolves every swappable stylesheet for the given theme (the theme itself plus an optional `next` base). */
export function buildThemeStylesheetRefs(theme: string, customThemeCssUrl?: string, themeBase?: string): StylesheetRef[] {
    const stylesheetsPath = `${window.glob.assetPath}/stylesheets`;
    const refs = getConfiguredThemeStylesheets(stylesheetsPath, theme, customThemeCssUrl);
    if (themeBase) {
        refs.push(...getConfiguredThemeStylesheets(stylesheetsPath, themeBase));
    }
    return refs;
}

export function createStylesheetLink(ref: StylesheetRef, opts?: { base?: boolean; theme?: boolean }): HTMLLinkElement {
    const linkEl = document.createElement("link");
    linkEl.href = ref.href;
    linkEl.rel = "stylesheet";
    if (ref.media) {
        linkEl.media = ref.media;
    }
    if (opts?.base) {
        linkEl.setAttribute(THEME_BASE_ATTR, "true");
    }
    if (opts?.theme) {
        linkEl.setAttribute(THEME_STYLESHEET_ATTR, "true");
    }
    return linkEl;
}

/** Toggles the `light-theme`/`dark-theme` body classes to match the active theme's `--theme-style`. */
export function updateColorSchemeClasses() {
    const colorScheme = readCssVar(document.body, "theme-style").asString();
    document.body.classList.toggle("light-theme", colorScheme === "light");
    document.body.classList.toggle("dark-theme", colorScheme === "dark");
}

let backgroundEffectsSuspended = false;

/**
 * Temporarily suppresses background effects without touching the user's option, e.g. while
 * DevTools is docked into the window — Chromium disables the native window material then, which
 * would leave the transparent UI floating over a solid void.
 */
export function setBackgroundEffectsSuspended(suspended: boolean) {
    if (backgroundEffectsSuspended === suspended) {
        return;
    }
    backgroundEffectsSuspended = suspended;
    updateThemeCapabilities();
}

/** Toggles the `theme-supports-background-effects` body class to match the active theme's `--allow-background-effects`. */
export function updateThemeCapabilities() {
    const useBgfx = readCssVar(document.documentElement, "allow-background-effects")
        .asBoolean(false);

    document.body.classList.toggle("theme-supports-background-effects", useBgfx && !backgroundEffectsSuspended);
}

/** Reads the current `theme` option and applies it live, resolving custom-theme metadata from the server if needed. */
export async function applyThemeFromOptions() {
    // Imported lazily because this module is loaded by the entry point before jQuery is initialized;
    // a static import would pull options -> server -> i18n into the boot graph and crash on `$`.
    const { default: options } = await import("./options.js");
    const theme = options.get("theme");
    if (BUILTIN_THEMES.has(theme)) {
        applyTheme(theme);
        return;
    }

    // Custom theme — resolve its note to build the CSS URL and the optional `next` base.
    const { default: server } = await import("./server.js");
    const userThemes = await server.get<CustomThemeInfo[]>("options/user-themes");

    // The theme may have changed again while the request was in flight; applying the stale
    // one now would override the latest choice (whose own invocation may already have run).
    if (options.get("theme") !== theme) {
        return;
    }

    const match = userThemes.find((userTheme) => userTheme.val === theme);
    applyTheme(
        theme,
        match ? `api/notes/download/${match.noteId}` : undefined,
        match?.appThemeBase
    );
}

interface CustomThemeInfo {
    val: string;
    noteId: string;
    appThemeBase?: ThemeBase;
}

/**
 * Swaps the active theme stylesheets without reloading the page. The new stylesheets are appended first and the
 * previous ones removed only once the new ones have loaded, so the swap stays free of a flash of unstyled content.
 * If any of the new stylesheets fails to load, the swap is rolled back and the previous theme stays applied.
 */
export function applyTheme(theme: string, customThemeCssUrl?: string, themeBase?: string) {
    const previousGlob = {
        theme: window.glob.theme,
        customThemeCssUrl: window.glob.customThemeCssUrl,
        themeBase: window.glob.themeBase
    };
    window.glob.theme = theme;
    window.glob.customThemeCssUrl = customThemeCssUrl;
    window.glob.themeBase = themeBase as ThemeBase | undefined;

    const refs = buildThemeStylesheetRefs(theme, customThemeCssUrl, themeBase);
    const oldLinks = Array.from(document.head.querySelectorAll<HTMLLinkElement>(`link[${THEME_STYLESHEET_ATTR}]`));
    const anchor: HTMLElement | null = oldLinks.at(-1) ?? document.head.querySelector<HTMLLinkElement>(`link[${THEME_BASE_ATTR}]`);

    let insertAfter = anchor;
    const newLinks = refs.map((ref) => {
        const link = createStylesheetLink(ref, { theme: true });
        if (insertAfter) {
            insertAfter.after(link);
        } else {
            document.head.appendChild(link);
        }
        insertAfter = link;
        return link;
    });

    void waitForStylesheets(newLinks).then((allLoaded) => {
        // If any new stylesheet failed to load (e.g. a deleted custom theme note or a network
        // error), keep the previous theme rather than leaving the page unstyled. The metadata is
        // restored to keep getThemeStyle() consistent with what is actually rendered.
        if (!allLoaded) {
            for (const newLink of newLinks) {
                newLink.remove();
            }
            window.glob.theme = previousGlob.theme;
            window.glob.customThemeCssUrl = previousGlob.customThemeCssUrl;
            window.glob.themeBase = previousGlob.themeBase;
            return;
        }

        for (const oldLink of oldLinks) {
            oldLink.remove();
        }
        document.body.setAttribute("data-theme-id", theme);
        updateColorSchemeClasses();
        updateThemeCapabilities();
        notifyThemeChanged();

        // The stylesheet swap is invisible to Electron, whose window configuration (Mica tint,
        // background material, title bar colors) derives from the theme. Imported lazily so this
        // module stays loadable from the early boot entry point (see `applyThemeFromOptions`).
        if (window.electronApi) {
            void import("./native_window.js").then(({ syncNativeWindowWithTheme }) => syncNativeWindowWithTheme());
        }
    });
}

/** Last effective light/dark style broadcast via `themeChanged`, so the OS-preference listener only fires when
 *  the style actually flips (an auto theme following the OS) rather than on every preference change. */
let lastNotifiedThemeStyle: "light" | "dark" | null = null;

/** Broadcasts the global `themeChanged` event. `appContext` is imported lazily because this module is loaded by
 *  the boot entry point before the app context (and jQuery) exist; the import resolves later, when an actual
 *  theme change occurs. */
function notifyThemeChanged() {
    const themeStyle = getEffectiveThemeStyle();
    lastNotifiedThemeStyle = themeStyle;
    void import("../components/app_context.js").then(({ default: appContext }) => {
        void appContext.triggerEvent("themeChanged", { themeStyle });
    });
}

/**
 * Installs a listener so that, while an auto theme follows the OS, a system light/dark switch also emits
 * `themeChanged` — explicit theme-option swaps already emit from {@link applyTheme}. Call once at startup.
 */
export function initThemeChangeNotifier() {
    if (!window.matchMedia) {
        return;
    }
    lastNotifiedThemeStyle = getEffectiveThemeStyle();
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
        // A fixed light/dark theme ignores the OS preference, so only emit when the effective style truly flips.
        if (getEffectiveThemeStyle() !== lastNotifiedThemeStyle) {
            notifyThemeChanged();
        }
    });
}

/** Resolves once every link has settled, with `true` only if all of them loaded successfully. */
function waitForStylesheets(links: HTMLLinkElement[]): Promise<boolean> {
    if (links.length === 0) {
        return Promise.resolve(true);
    }

    return new Promise((resolve) => {
        let remaining = links.length;
        let allLoaded = true;
        const onSettled = (e: Event) => {
            if (e.type === "error") {
                allLoaded = false;
            }
            remaining--;
            if (remaining <= 0) {
                resolve(allLoaded);
            }
        };
        for (const link of links) {
            link.addEventListener("load", onSettled, { once: true });
            link.addEventListener("error", onSettled, { once: true });
        }
    });
}
