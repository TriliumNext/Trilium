import { isIOS, isMobileApp } from "../../services/utils.js";

/** How much shorter than the window the visual viewport must be for the keyboard to count as open. */
const KEYBOARD_THRESHOLD = 150;

/**
 * Follows the virtual keyboard of a mobile device on `root`, the root of the layout: it wears
 * `virtual-keyboard-opened` while the keyboard is open, and the body keeps `--tn-keyboard-height`
 * once it closes, for a menu that takes its place (see `useKeyboardPanel`).
 *
 * The layout shrinks for the keyboard on Android (`interactive-widget=resizes-content`, or
 * `adjustResize` in the app) and in the iOS app (`Keyboard.resize: "native"`), where it follows
 * `innerHeight` only some time later. Mobile Safari keeps the layout, and `usePositioningOniOS` lifts
 * the toolbar there instead. Where it shrinks, `--tn-layout-shrink` is how much shorter than the
 * window the layout is, and `--tn-layout-overhang` how far it reaches below the visible bottom, so
 * `mobile_editor_toolbar.css` places the toolbar and its menus for the layout as it stands.
 *
 * Returns the function that stops following it.
 */
export function trackVirtualKeyboard(root: HTMLElement) {
    const style = document.body.style;
    // The window size the keyboard detection compares against, per orientation.
    let baselineWidth = window.innerWidth ?? 0;
    let baselineHeight = window.innerHeight ?? 0;

    // The virtual keyboard never changes the window width, so a width change means the device was
    // rotated (or the window resized) and the stored height no longer describes this orientation.
    // Keeping it would make the shorter landscape window look like an open keyboard (#10835).
    const syncBaseline = () => {
        if (window.innerWidth !== baselineWidth) {
            baselineWidth = window.innerWidth;
            baselineHeight = window.innerHeight;
        }
    };
    // `innerHeight` changes as the keyboard opens, so the window is measured against its own height
    // without one.
    const getWindowHeight = () => Math.max(window.innerHeight, baselineHeight);

    const onResize = () => {
        syncBaseline();
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        const keyboardHeight = getWindowHeight() - viewportHeight;
        const isKeyboardOpened = keyboardHeight > KEYBOARD_THRESHOLD;
        root.classList.toggle("virtual-keyboard-opened", isKeyboardOpened);
        if (isKeyboardOpened) {
            style.setProperty("--tn-keyboard-height", `${Math.round(keyboardHeight)}px`);
        }
    };
    window.visualViewport?.addEventListener("resize", onResize);
    const disposers = [ () => window.visualViewport?.removeEventListener("resize", onResize) ];

    if (!isIOS() || isMobileApp()) {
        const updateInsets = () => {
            syncBaseline();
            const height = root.getBoundingClientRect().height;
            style.setProperty("--tn-layout-shrink", `${Math.max(0, Math.round(getWindowHeight() - height))}px`);
            style.setProperty("--tn-layout-overhang", `${Math.max(0, Math.round(height - window.innerHeight))}px`);
        };
        updateInsets();
        const observer = new ResizeObserver(updateInsets);
        observer.observe(root);
        window.visualViewport?.addEventListener("resize", updateInsets);
        disposers.push(() => {
            observer.disconnect();
            window.visualViewport?.removeEventListener("resize", updateInsets);
        });
    }

    return () => {
        for (const dispose of disposers) {
            dispose();
        }
    };
}
