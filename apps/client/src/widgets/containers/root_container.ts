import { EventData } from "../../components/app_context.js";
import FlexContainer from "./flex_container.js";
import options from "../../services/options.js";
import type BasicWidget from "../basic_widget.js";
import utils from "../../services/utils.js";
import { LOCALES } from "@triliumnext/commons";

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

        this.#setMotion(options.is("motionEnabled"));
        this.#setShadows(options.is("shadowsEnabled"));
        this.#setBackdropEffects(options.is("backdropEffectsEnabled"));
        this.#setLocaleAndDirection(options.get("locale"));

        return super.render();
    }

    entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        if (loadResults.isOptionReloaded("motionEnabled")) {
            this.#setMotion(options.is("motionEnabled"));
        }

        if (loadResults.isOptionReloaded("shadowsEnabled")) {
            this.#setShadows(options.is("shadowsEnabled"));
        }

        if (loadResults.isOptionReloaded("backdropEffectsEnabled")) {
            this.#setBackdropEffects(options.is("backdropEffectsEnabled"));
        }
    }

    #onMobileResize() {
        const currentViewportHeight = getViewportHeight();
        const isKeyboardOpened = (currentViewportHeight < this.originalViewportHeight);
        this.$widget.toggleClass("virtual-keyboard-opened", isKeyboardOpened);
    }

    #setMotion(enabled: boolean) {
        document.body.classList.toggle("motion-disabled", !enabled);
        jQuery.fx.off = !enabled;
    }

    #setShadows(enabled: boolean) {
        document.body.classList.toggle("shadows-disabled", !enabled);
    }

    #setBackdropEffects(enabled: boolean) {
        document.body.classList.toggle("backdrop-effects-disabled", !enabled);
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
