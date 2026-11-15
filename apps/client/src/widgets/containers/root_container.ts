import { EventData } from "../../components/app_context.js";
import { applyAppearance, applyReloadedAppearance } from "../../services/appearance.js";
import utils, { isIOS, isMobile, isMobileApp } from "../../services/utils.js";
import type BasicWidget from "../basic_widget.js";
import FlexContainer from "./flex_container.js";


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

        applyAppearance();

        const $widget = super.render();
        if (isMobile() && (!isIOS() || isMobileApp())) {
            this.#trackLayoutInsets();
        }
        return $widget;
    }

    entitiesReloadedEvent({ loadResults }: EventData<"entitiesReloaded">) {
        applyReloadedAppearance(loadResults);
    }

    #onMobileResize() {
        this.#syncBaseline();

        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        const windowHeight = Math.max(window.innerHeight, this.baselineWindowHeight); // inner height changes when keyboard is opened, we need to compare with the original height to detect it.

        // If viewport is significantly smaller, keyboard is likely open
        const isKeyboardOpened = windowHeight - viewportHeight > 150;

        this.$widget.toggleClass("virtual-keyboard-opened", isKeyboardOpened);
        // Kept once the keyboard closes, for a menu that takes its place (see `useKeyboardPanel`).
        if (isKeyboardOpened) {
            const keyboardHeight = Math.round(windowHeight - viewportHeight);
            document.body.style.setProperty("--tn-keyboard-height", `${keyboardHeight}px`);
        }
    }

    #syncBaseline() {
        // The virtual keyboard never changes the window width, so a width change means the device was
        // rotated (or the window resized) and the stored height no longer describes this orientation.
        // Keeping it would make the shorter landscape window look like an open keyboard (#10835).
        if (window.innerWidth !== this.baselineWindowWidth) {
            this.baselineWindowWidth = window.innerWidth;
            this.baselineWindowHeight = window.innerHeight;
        }
    }

    /**
     * The layout shrinks for the keyboard on Android (`interactive-widget=resizes-content`, or
     * `adjustResize` in the app) and in the iOS app (`Keyboard.resize: "native"`), where it follows
     * `innerHeight` only some time later. Mobile Safari keeps the layout, and
     * `usePositioningOniOS` lifts the toolbar there instead. `--tn-layout-shrink` is how much shorter
     * than the window the layout is, and `--tn-layout-overhang` how far it reaches below the visible
     * bottom, so `mobile_editor_toolbar.css` places the toolbar and its menus for the layout as it
     * stands.
     */
    #trackLayoutInsets() {
        const root = this.$widget[0];
        const style = document.body.style;
        const update = () => {
            this.#syncBaseline();
            const height = root.getBoundingClientRect().height;
            const windowHeight = Math.max(window.innerHeight, this.baselineWindowHeight);
            style.setProperty("--tn-layout-shrink", `${Math.max(0, Math.round(windowHeight - height))}px`);
            style.setProperty("--tn-layout-overhang", `${Math.max(0, Math.round(height - window.innerHeight))}px`);
        };
        update();
        new ResizeObserver(update).observe(root);
        window.visualViewport?.addEventListener("resize", update);
    }
}
