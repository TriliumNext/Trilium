import { LOCALES, OptionNames } from "@triliumnext/commons";

import { EventData } from "../../components/app_context.js";
import { getEnabledExperimentalFeatureIds } from "../../services/experimental_features.js";
import { applyCustomFontsFromOptions, hasCustomFontContentChanged } from "../../services/custom_fonts.js";
import { applyFontsFromOptions } from "../../services/font.js";
import options from "../../services/options.js";
import { applyThemeFromOptions, onEffectiveThemeStyleChange, updateColorSchemeClasses, updateThemeCapabilities } from "../../services/theme.js";
import utils, { isIOS, isMobile } from "../../services/utils.js";
import type BasicWidget from "../basic_widget.js";
import FlexContainer from "./flex_container.js";

/** Font options whose change requires re-applying the server-generated fonts stylesheet. */
const FONT_OPTIONS: OptionNames[] = [
    "overrideThemeFonts",
    "mainFontFamily", "mainFontSize",
    "treeFontFamily", "treeFontSize",
    "detailFontFamily", "detailFontSize",
    "monospaceFontFamily", "monospaceFontSize"
];

/**
 * The root container is the top-most widget/container, from which the entire layout derives.
 *
 * For convenience, the root container has a few class selectors that can be used to target some global state:
 *
 * - `#root-container.light-theme`, indicates whether the current color scheme is light.
 * - `#root-container.dark-theme`, indicates whether the current color scheme is dark.
 * - `#root-container.virtual-keyboard-opened`, on mobile devices if the virtual keyboard is open.
 * - `#root-container.horizontal-layout`, if the current layout is horizontal.
 * - `#root-container.vertical-layout`, if the current layout is horizontal.
 */
export default class RootContainer extends FlexContainer<BasicWidget> {

    /** Window size the virtual keyboard detection compares against, per orientation. */
    private baselineWindowHeight: number;
    private baselineWindowWidth: number;

    constructor(isHorizontalLayout: boolean) {
        super(isHorizontalLayout ? "column" : "row");

        this.baselineWindowHeight = window.innerHeight ?? 0;
        this.baselineWindowWidth = window.innerWidth ?? 0;
        this.id("root-widget");
        this.css("height", "100dvh");
    }

    render(): JQuery<HTMLElement> {
        if (utils.isMobile()) {
            window.visualViewport?.addEventListener("resize", () => this.#onMobileResize());
        }

        this.#initTheme();
        this.#setDeviceSpecificClasses();
        this.#setMaxContentWidth();
        this.#setMotion();
        this.#setShadows();
        this.#setBackdropEffects();
        this.#setMonospaceLigatures();
        updateThemeCapabilities();
        this.#setLocaleAndDirection(options.get("locale"));
        // The fonts stylesheet went out with the page; the files the user's own fonts are stored in
        // are fetched here, once froca can be asked which notes hold them.
        void applyCustomFontsFromOptions();
        this.#setExperimentalFeatures();
        this.#initPWATopbarColor();

        return super.render();
    }

    entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        if (loadResults.isOptionReloaded("theme")) {
            void applyThemeFromOptions();
        }

        if (FONT_OPTIONS.some((optionName) => loadResults.isOptionReloaded(optionName))) {
            applyFontsFromOptions();
            void applyCustomFontsFromOptions();
        } else if (hasCustomFontContentChanged(loadResults)) {
            // The options still name the same fonts, so the stylesheet they are served as holds; only
            // the faces their files were loaded into have to be built again.
            void applyCustomFontsFromOptions();
        }

        if (loadResults.isOptionReloaded("motionEnabled")) {
            this.#setMotion();
        }

        if (loadResults.isOptionReloaded("shadowsEnabled")) {
            this.#setShadows();
        }

        if (loadResults.isOptionReloaded("backdropEffectsEnabled")) {
            this.#setBackdropEffects();
        }

        if (loadResults.isOptionReloaded("monospaceLigaturesEnabled")) {
            this.#setMonospaceLigatures();
        }

        if (loadResults.isOptionReloaded("maxContentWidth")
            || loadResults.isOptionReloaded("centerContent")) {

            this.#setMaxContentWidth();
        }
    }

    #initTheme() {
        onEffectiveThemeStyleChange(() => this.#updateColorScheme());
        this.#updateColorScheme();

        document.body.setAttribute("data-theme-id", options.get("theme"));
    }

    #updateColorScheme() {
        updateColorSchemeClasses();
    }

    #onMobileResize() {
        // The virtual keyboard never changes the window width, so a width change means the device was
        // rotated (or the window resized) and the stored height no longer describes this orientation.
        // Keeping it would make the shorter landscape window look like an open keyboard (#10835).
        if (window.innerWidth !== this.baselineWindowWidth) {
            this.baselineWindowWidth = window.innerWidth;
            this.baselineWindowHeight = window.innerHeight;
        }

        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        const windowHeight = Math.max(window.innerHeight, this.baselineWindowHeight); // inner height changes when keyboard is opened, we need to compare with the original height to detect it.

        // If viewport is significantly smaller, keyboard is likely open
        const isKeyboardOpened = windowHeight - viewportHeight > 150;

        this.$widget.toggleClass("virtual-keyboard-opened", isKeyboardOpened);
    }

    #setMaxContentWidth() {
        const width = Math.max(options.getInt("maxContentWidth") || 0, 640);
        document.body.style.setProperty("--preferred-max-content-width", `${width}px`);

        document.body.classList.toggle("prefers-centered-content", options.is("centerContent"));
    }

    #setMotion() {
        const enabled = options.is("motionEnabled");
        document.body.classList.toggle("motion-disabled", !enabled);
        jQuery.fx.off = !enabled;
    }

    #setShadows() {
        const enabled = options.is("shadowsEnabled");
        document.body.classList.toggle("shadows-disabled", !enabled);
    }

    #setBackdropEffects() {
        const enabled = options.is("backdropEffectsEnabled") && !isMobile();
        document.body.classList.toggle("backdrop-effects-disabled", !enabled);
    }

    /**
     * Ligatures are a property of how the monospace font renders, not of which font is selected, so
     * this rides a body class rather than the server-generated fonts stylesheet — no round-trip to
     * `api/fonts` is needed to flip it.
     */
    #setMonospaceLigatures() {
        const enabled = options.is("monospaceLigaturesEnabled");
        document.body.classList.toggle("monospace-ligatures-disabled", !enabled);
    }

    #setExperimentalFeatures() {
        for (const featureId of getEnabledExperimentalFeatureIds()) {
            document.body.classList.add(`experimental-feature-${featureId}`);
        }
    }

    #setLocaleAndDirection(locale: string) {
        const correspondingLocale = LOCALES.find(l => l.id === locale);
        document.body.lang = locale;
        document.body.dir = correspondingLocale?.rtl ? "rtl" : "ltr";
    }

    #setDeviceSpecificClasses() {
        if (isIOS()) {
            document.body.classList.add("ios");
        }
    }

    #initPWATopbarColor() {
        if (!utils.isPWA()) return;
        const tracker = $("#background-color-tracker");

        if (tracker.length) {
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
    }
}

