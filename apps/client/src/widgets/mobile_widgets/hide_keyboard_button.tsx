import "./hide_keyboard_button.css";

import clsx from "clsx";
import { RefObject } from "preact";
import { useCallback, useEffect, useRef } from "preact/hooks";

import { t } from "../../services/i18n";
import { isIOS, isMobileApp } from "../../services/utils";
import ActionButton from "../react/ActionButton";

/**
 * Closes the virtual keyboard by blurring the focused element. The button stands at the bottom-end
 * corner, just above the keyboard, while `RootContainer` marks the keyboard as open with
 * `virtual-keyboard-opened`. While `MobileEditorToolbar` is shown, which it is while its editor has
 * the focus, the toolbar carries the button instead (see `hide_keyboard_button.css`).
 * In the iOS app, the keyboard has no _Done_ button of its own, as `@capacitor/keyboard` hides the
 * bar that holds it.
 */
export default function HideKeyboardButton() {
    const containerRef = useRef<HTMLDivElement>(null);
    usePositioningOniOS(containerRef);

    return <HideKeyboardAction className="hide-keyboard-button" containerRef={containerRef} />;
}

/**
 * The button alone, which `MobileEditorToolbar` places at the end of its island. Given
 * `closeMenu`, as while a menu of the toolbar is in the keyboard's place, it is an X that calls
 * `closeMenu` instead of hiding the keyboard.
 */
export function HideKeyboardAction({ className, containerRef, closeMenu }: {
    className: string;
    containerRef?: RefObject<HTMLDivElement | null>;
    closeMenu?: () => void;
}) {
    return (
        // Keeps the press from moving the focus onto the button: an open dialog's focus trap would
        // send it back into the dialog and bring the keyboard up again.
        <div
            ref={containerRef}
            className={clsx(className, closeMenu && "closes-menu")}
            onMouseDown={(e) => e.preventDefault()}
        >
            <ActionButton
                icon={closeMenu ? "bx bx-x" : "bx bxs-keyboard"}
                text={closeMenu
                    ? t("hide_keyboard_button.close_menu")
                    : t("hide_keyboard_button.title")}
                noTooltipOnTouch
                onClick={() => {
                    if (closeMenu) {
                        closeMenu();
                    } else if (document.activeElement instanceof HTMLElement) {
                        document.activeElement.blur();
                    }
                }}
            />
        </div>
    );
}

/**
 * Lifts an element at the bottom of its `anchorRef`, or of the screen for a fixed element, above
 * the keyboard in plain mobile Safari, which does not resize the page for the keyboard.
 */
export function usePositioningOniOS(
    wrapperRef: RefObject<HTMLDivElement | null>,
    anchorRef?: RefObject<HTMLElement | null>
) {
    // Safari shrinks `visualViewport` for the keyboard but not the layout, so the element rises by
    // how far its anchor reaches below the visible bottom. With the keyboard up Safari scrolls the
    // fixed page itself, and client coordinates move with that scroll, so the visible bottom is
    // `pageTop - scrollY + height`: `offsetTop + height` elsewhere, `height` in Safari.
    const adjustPosition = useCallback(() => {
        if (!wrapperRef.current) return;
        const viewport = window.visualViewport;
        if (!viewport) return;

        const anchorBottom = anchorRef?.current?.getBoundingClientRect().bottom
            ?? window.innerHeight;
        const visibleBottom = heldVisibleBottom ?? measureVisibleBottom(viewport);
        const obscured = Math.max(0, Math.round(anchorBottom - visibleBottom));

        if (obscured <= 1) {
            wrapperRef.current.style.removeProperty("bottom");
        } else {
            wrapperRef.current.style.bottom = `${obscured}px`;
        }
    }, [ wrapperRef ]);

    useEffect(() => {
        // Under Capacitor `resize: native` the layout shrinks for the keyboard, so CSS places the
        // element. `visualViewport` shrinks before the layout does, which would lift it twice.
        if (!isIOS() || isMobileApp()) return;
        // Run once in case the keyboard is already up when mounting
        // (e.g. returning from a dialog).
        adjustPosition();
        const viewport = window.visualViewport;
        viewport?.addEventListener("resize", adjustPosition);
        viewport?.addEventListener("scroll", adjustPosition);
        // Safari undoes its keyboard scroll before `visualViewport` reports the keyboard gone.
        window.addEventListener("scroll", adjustPosition);
        visibleBottomListeners.add(adjustPosition);
        return () => {
            viewport?.removeEventListener("resize", adjustPosition);
            viewport?.removeEventListener("scroll", adjustPosition);
            window.removeEventListener("scroll", adjustPosition);
            visibleBottomListeners.delete(adjustPosition);
        };
    }, [ adjustPosition ]);
}

/**
 * Holds the visible bottom that `usePositioningOniOS` lifts elements to at its current value, for
 * a menu that takes the place of the keyboard (see `useKeyboardPanel`). As the keyboard closes,
 * Safari undoes its scroll at once but reports the keyboard's `visualViewport` for some 300ms
 * more, which would drop the toolbar into the menu's place meanwhile.
 */
export function holdVisibleBottom(isHeld: boolean) {
    const viewport = window.visualViewport;
    heldVisibleBottom = isHeld && viewport ? measureVisibleBottom(viewport) : undefined;
    for (const listener of visibleBottomListeners) {
        listener();
    }
}

let heldVisibleBottom: number | undefined;
const visibleBottomListeners = new Set<() => void>();

function measureVisibleBottom(viewport: VisualViewport) {
    return viewport.pageTop - window.scrollY + viewport.height;
}
