import { EventData } from "../../components/app_context.js";
import { LOCALES } from "@triliumnext/commons";
import { readCssVar } from "../../utils/css-var.js";
import FlexContainer from "./flex_container.js";
import options from "../../services/options.js";
import type BasicWidget from "../basic_widget.js";
import utils from "../../services/utils.js";
import { getEnabledExperimentalFeatureIds } from "../../services/experimental_features.js";

/**
 * The root container is the top-most widget/container, from which the entire layout derives.
 *
 * For convenience, the root container has a few class selectors that can be used to target some global state:
 *
 * - `#root-container.virtual-keyboard-opened`, on mobile devices if the virtual keyboard is open.
 * - `#root-container.horizontal-layout`, if the current layout is horizontal.
 * - `#root-container.vertical-layout`, if the current layout is horizontal.
 */
export default class RootContainer extends FlexContainer<BasicWidget> {
    private originalViewportHeight: number;

    constructor(isHorizontalLayout: boolean) {
        super(isHorizontalLayout ? "column" : "row");

        this.id("root-widget");
        this.css("height", "100dvh");
        this.originalViewportHeight = getViewportHeight();
    }

    render(): JQuery<HTMLElement> {
        if (utils.isMobile()) {
            window.visualViewport?.addEventListener("resize", () => this.#onMobileResize());
        }

        this.#setMaxContentWidth();
        this.#setMotion();
        this.#setShadows();
        this.#setBackdropEffects();
        this.#setThemeCapabilities();
        this.#setLocaleAndDirection(options.get("locale"));
        this.#setExperimentalFeatures();

        return super.render();
    }

    entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
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

    #onMobileResize() {
        const currentViewportHeight = getViewportHeight();
        const isKeyboardOpened = (currentViewportHeight < this.originalViewportHeight);
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
        const enabled = options.is("backdropEffectsEnabled");
        document.body.classList.toggle("backdrop-effects-disabled", !enabled);
    }

    #setThemeCapabilities() {
        // Supports background effects

        const useBgfx = readCssVar(document.documentElement, "allow-background-effects")
                        .asBoolean(false);

        document.body.classList.toggle("theme-supports-background-effects", useBgfx);
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
}

function getViewportHeight() {
    return window.visualViewport?.height ?? window.innerHeight;
}
