import { LOCALES, OptionNames } from "@triliumnext/commons";

import { EventData } from "../../components/app_context.js";
import { getEnabledExperimentalFeatureIds } from "../../services/experimental_features.js";
import { applyFontsFromOptions } from "../../services/font.js";
import options from "../../services/options.js";
import { applyThemeFromOptions, updateColorSchemeClasses, updateThemeCapabilities } from "../../services/theme.js";
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

    private originalWindowHeight: number;

    constructor(isHorizontalLayout: boolean) {
        super(isHorizontalLayout ? "column" : "row");

        this.originalWindowHeight = window.innerHeight ?? 0;
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
        updateThemeCapabilities();
        this.#setLocaleAndDirection(options.get("locale"));
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

        if (loadResults.isOptionReloaded("maxContentWidth")
            || loadResults.isOptionReloaded("centerContent")) {

            this.#setMaxContentWidth();
        }
    }

    #initTheme() {
        const colorSchemeChangeObserver = matchMedia("(prefers-color-scheme: dark)");
        colorSchemeChangeObserver.addEventListener("change", () => this.#updateColorScheme());
        this.#updateColorScheme();
        
        document.body.setAttribute("data-theme-id", options.get("theme"));
    }

    #updateColorScheme() {
        updateColorSchemeClasses();
    }

    #onMobileResize() {
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        const windowHeight = Math.max(window.innerHeight, this.originalWindowHeight); // inner height changes when keyboard is opened, we need to compare with the original height to detect it.

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

