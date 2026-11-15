import { LOCALES } from "@triliumnext/commons/src/lib/i18n.js";

import { applyCustomFontsFromOptions, hasCustomFontContentChanged } from "./custom_fonts.js";
import { getEnabledExperimentalFeatureIds } from "./experimental_features.js";
import { applyFontCss } from "./font.js";
import type LoadResults from "./load_results.js";
import options from "./options.js";
import { applyThemeFromOptions, onEffectiveThemeStyleChange, updateColorSchemeClasses, updateThemeCapabilities } from "./theme.js";
import { isIOS, isMobile } from "./utils.js";

/**
 * Applies the appearance options to the page: the classes and custom properties on the body that
 * the stylesheets read (motion, shadows, backdrop effects, ligatures, sticky table headers, content
 * width), the color scheme and theme, the locale, the user's fonts, the experimental features and
 * the `theme-color` meta tag. A layout calls it once before its first paint, and
 * {@link applyReloadedAppearance} whenever options are reloaded.
 */
export function applyAppearance() {
    onEffectiveThemeStyleChange(updateColorSchemeClasses);
    updateColorSchemeClasses();
    document.body.setAttribute("data-theme-id", options.get("theme"));

    if (isIOS()) {
        document.body.classList.add("ios");
    }
    setMaxContentWidth();
    setMotion();
    setShadows();
    setBackdropEffects();
    setMonospaceLigatures();
    setStickyTableHeaders();
    updateThemeCapabilities();
    setLocaleAndDirection(options.get("locale"));
    // The fonts stylesheet went out with the page; the files the user's own fonts are stored in
    // are fetched here, once froca can be asked which notes hold them.
    void applyCustomFontsFromOptions();
    for (const featureId of getEnabledExperimentalFeatureIds()) {
        document.body.classList.add(`experimental-feature-${featureId}`);
    }
    initThemeColor();
}

/** Applies the appearance options among those in `loadResults`; see {@link applyAppearance}. */
export function applyReloadedAppearance(loadResults: LoadResults) {
    if (loadResults.isOptionReloaded("theme")) {
        void applyThemeFromOptions();
    }

    if (loadResults.getOptionNames().length) {
        void applyReloadedFontOptions(loadResults);
    } else if (hasCustomFontContentChanged(loadResults)) {
        // The options still name the same fonts, so the stylesheet of the font options holds; only
        // the faces their files were loaded into have to be built again.
        void applyCustomFontsFromOptions();
    }

    if (loadResults.isOptionReloaded("motionEnabled")) {
        setMotion();
    }

    if (loadResults.isOptionReloaded("shadowsEnabled")) {
        setShadows();
    }

    if (loadResults.isOptionReloaded("backdropEffectsEnabled")) {
        setBackdropEffects();
    }

    if (loadResults.isOptionReloaded("monospaceLigaturesEnabled")) {
        setMonospaceLigatures();
    }

    if (loadResults.isOptionReloaded("textNoteStickyTableHeadersEnabled")) {
        setStickyTableHeaders();
    }

    if (loadResults.isOptionReloaded("maxContentWidth") || loadResults.isOptionReloaded("centerContent")) {
        setMaxContentWidth();
    }
}

/**
 * Rebuilds the stylesheet of the font options when one of them is among the reloaded options. The
 * page loads that stylesheet with it, so `font_css.js` is imported only here.
 */
async function applyReloadedFontOptions(loadResults: LoadResults) {
    const { buildFontCss, FONT_OPTION_NAMES } = await import("@triliumnext/commons/src/lib/font_css.js");
    if (FONT_OPTION_NAMES.some((optionName) => loadResults.isOptionReloaded(optionName))) {
        applyFontCss(buildFontCss(Object.fromEntries(FONT_OPTION_NAMES.map((name) => [ name, options.get(name) ]))));
        void applyCustomFontsFromOptions();
    } else if (hasCustomFontContentChanged(loadResults)) {
        void applyCustomFontsFromOptions();
    }
}

function setMaxContentWidth() {
    const width = Math.max(options.getInt("maxContentWidth") || 0, 640);
    document.body.style.setProperty("--preferred-max-content-width", `${width}px`);

    document.body.classList.toggle("prefers-centered-content", options.is("centerContent"));
}

function setMotion() {
    const enabled = options.is("motionEnabled");
    document.body.classList.toggle("motion-disabled", !enabled);
    jQuery.fx.off = !enabled;
}

function setShadows() {
    document.body.classList.toggle("shadows-disabled", !options.is("shadowsEnabled"));
}

function setBackdropEffects() {
    const enabled = options.is("backdropEffectsEnabled") && (!isMobile() || isIOS());
    document.body.classList.toggle("backdrop-effects-disabled", !enabled);
}

/**
 * Ligatures are a property of how the monospace font renders, not of which font is selected, so
 * this rides a body class rather than the stylesheet of the font options.
 */
function setMonospaceLigatures() {
    document.body.classList.toggle("monospace-ligatures-disabled", !options.is("monospaceLigaturesEnabled"));
}

function setStickyTableHeaders() {
    document.body.classList.toggle("sticky-table-headers-disabled", !options.is("textNoteStickyTableHeadersEnabled"));
}

function setLocaleAndDirection(locale: string) {
    const correspondingLocale = LOCALES.find(l => l.id === locale);
    document.body.lang = locale;
    document.body.dir = correspondingLocale?.rtl ? "rtl" : "ltr";
}

/** Keeps the `theme-color` meta tag on the color of `#background-color-tracker`. */
function initThemeColor() {
    const tracker = $("#background-color-tracker");
    if (!tracker.length) return;

    const applyThemeColor = () => {
        let meta = $("meta[name='theme-color']");
        if (!meta.length) {
            meta = $(`<meta name="theme-color">`).appendTo($("head"));
        }
        meta.attr("content", tracker.css("color"));
    };

    tracker.on("transitionend", applyThemeColor);
    applyThemeColor();
}
