import { createFontStylesheetLink } from "./services/font";
import {
    CLIENT_STARTUP_PHASES, hideSplash, initSplashProgress, reportSplashPhase, showSplashError
} from "./services/splash";
import { buildThemeStylesheetRefs, createStylesheetLink, getThemeStyle, initThemeChangeNotifier, StylesheetRef } from "./services/theme";

async function bootstrap() {
    // The splash from index.html covers the page until hideSplash(). Standalone reports a longer
    // sequence of its own before this one, so these phases only take effect on server and desktop.
    initSplashProgress(CLIENT_STARTUP_PHASES);
    reportSplashPhase("bootstrap");
    await setupGlob();
    await Promise.all([
        initJQuery(),
        loadBootstrapCss()
    ]);
    loadStylesheets();
    initThemeChangeNotifier();
    loadIcons();
    setBodyAttributes();
    reportSplashPhase("application");
    await loadScripts();
    hideSplash();
}

async function initJQuery() {
    const $ = (await import("jquery")).default;
    window.$ = $;
    window.jQuery = $;

    // Polyfill removed jQuery methods for autocomplete.js compatibility
    ($ as any).isArray = Array.isArray;
    ($ as any).isFunction = function(obj: any) { return typeof obj === 'function'; };
    ($ as any).isPlainObject = function(obj: any) {
        if (obj == null || typeof obj !== 'object') { return false; }
        const proto = Object.getPrototypeOf(obj);
        if (proto === null) { return true; }
        const Ctor = Object.prototype.hasOwnProperty.call(proto, 'constructor') && proto.constructor;
        return typeof Ctor === 'function' && Ctor === Object;
    };
}

async function setupGlob() {
    const response = await fetch(`./bootstrap${window.location.search}`);
    const json = await response.json();

    window.global = globalThis; /* fixes https://github.com/webpack/webpack/issues/10035 */
    window.glob = {
        ...json,
        activeDialog: null,
        device: json.device || getDevice()
    };
    window.glob.getThemeStyle = getThemeStyle;
}

function getDevice() {
    // Respect user's manual override via URL.
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has("print")) {
        return "print";
    } else if (urlParams.has("desktop")) {
        return "desktop";
    } else if (urlParams.has("mobile")) {
        return "mobile";
    }

    const deviceCookie = document.cookie.split("; ").find(row => row.startsWith("trilium-device="))?.split("=")[1];
    if (deviceCookie === "desktop" || deviceCookie === "mobile") return deviceCookie;
    return isMobile() ? "mobile" : "desktop";
}

// https://stackoverflow.com/a/73731646/944162
function isMobile() {
    const mQ = matchMedia?.("(pointer:coarse)");
    if (mQ?.media === "(pointer:coarse)") return !!mQ.matches;

    if ("orientation" in window) return true;
    const userAgentsRegEx = /\b(Android|iPhone|iPad|iPod|Windows Phone|BlackBerry|webOS|IEMobile)\b/i;
    return userAgentsRegEx.test(navigator.userAgent);
}

async function loadBootstrapCss() {
    // We have to selectively import Bootstrap CSS based on text direction.
    if (glob.isRtl) {
        await import("bootstrap/dist/css/bootstrap.rtl.min.css");
    } else {
        await import("bootstrap/dist/css/bootstrap.min.css");
    }
}

function loadStylesheets() {
    const { device, assetPath, theme, themeBase, customThemeCssUrl } = window.glob;
    if (device === "print") {
        return;
    }

    const stylesheetsPath = `${assetPath}/stylesheets`;
    appendStylesheet({ href: `${stylesheetsPath}/ckeditor-theme.css` });
    // Marked so it can be swapped when font options change without reloading. Skipped on the
    // login / set-password pre-auth screens, where the /api/fonts request 401s (and, under nosniff,
    // surfaces as a MIME-type console error) — those screens use the theme's fonts (#10589). This is
    // the inline equivalent of utils.isPreAuthScreen(): index.ts runs before setupGlob() populates
    // window.glob, and utils.ts reads window.glob at module scope, so index.ts must not import utils.
    if (glob.loggedIn !== false && glob.passwordSet !== false) {
        document.head.appendChild(createFontStylesheetLink());
    }
    // The light theme is always loaded as the baseline and acts as the anchor for live theme swapping.
    appendStylesheet({ href: `${stylesheetsPath}/theme-light.css` }, { base: true });
    for (const ref of buildThemeStylesheetRefs(theme, customThemeCssUrl, themeBase)) {
        appendStylesheet(ref, { theme: true });
    }
    appendStylesheet({ href: `${stylesheetsPath}/style.css` });
}

function appendStylesheet(ref: StylesheetRef, opts?: { base?: boolean; theme?: boolean }) {
    document.head.appendChild(createStylesheetLink(ref, opts));
}

function loadIcons() {
    const styleEl = document.createElement("style");
    // Must be textContent, not innerText: the innerText setter turns every newline into a real
    // <br> element (one per CSS line, ~20k with several icon packs). iOS WebKit's focused-element
    // scan walks all of them on every keyboard focus, freezing the app for seconds.
    styleEl.textContent = window.glob.iconPackCss;
    document.head.appendChild(styleEl);
}

function setBodyAttributes() {
    if (!glob.dbInitialized) return;

    const { device, headingStyle, layoutOrientation, platform, isElectron, hasNativeTitleBar, hasBackgroundEffects, currentLocale } = window.glob;
    const classesToSet = [
        device,
        `heading-style-${headingStyle}`,
        `layout-${layoutOrientation}`,
        `platform-${platform}`,
        isElectron && "electron",
        hasNativeTitleBar && "native-titlebar",
        hasBackgroundEffects && "background-effects"
    ].filter(Boolean) as string[];

    for (const classToSet of classesToSet) {
        document.body.classList.add(classToSet);
    }

    document.body.lang = currentLocale.id;
    document.body.dir = currentLocale.rtl ? "rtl" : "ltr";
}

async function loadScripts() {
    const entry = await importEntry();

    // Every entry point renders after its module has finished evaluating: the desktop layout, the
    // note tree and the locale catalogue are all fetched from there. Waiting for the `ready` it
    // exports keeps the splash up until the screen is actually populated, instead of handing the
    // user a blank page for the seconds those fetches take on a slow connection.
    reportSplashPhase("interface");
    await entry.ready;
}

function importEntry(): Promise<{ ready?: Promise<unknown> }> {
    if (!glob.dbInitialized) {
        return import("./setup.js");
    }

    if (glob.passwordSet === false) {
        return import("./set_password.js");
    }

    if (glob.loggedIn === false) {
        return import("./login.js");
    }

    switch (glob.device) {
        case "mobile":
            return import("./mobile.js");
        case "print":
            return import("./print.js");
        case "desktop":
        default:
            return import("./desktop.js");
    }
}

bootstrap().catch((err) => {
    console.error("Trilium failed to start:", err);
    const message = err instanceof Error ? err.message : String(err);
    showSplashError(`Trilium failed to start: ${message} — reload the page to try again.`);
});
