import { useCallback, useEffect, useRef } from "preact/hooks";

import { focusListItem } from "./FormList";
import { suspendModalFocusTraps } from "./modal_focustrap";
import Popup, { type PopupProps } from "./Popup";

/*
 * The popups of `Dropdown` and `DropdownPanel`. `Dropdown.tsx` imports this module once a toggle is
 * about to be pressed, so closed dropdowns load none of the menu code.
 */
export { focusListItem, suspendModalFocusTraps };
export { default as Menu, MenuItemRows } from "./Menu";

/** A panel's popup, whose items Up and Down move between. */
export function PanelPopup({ startAt, elementRef, ...props }: PopupProps & { startAt: "first" | "last" | undefined }) {
    const popupRef = useRef<HTMLDivElement | null>(null);

    // Captured at the window, so Bootstrap's handler for keys in a `.dropdown-menu`, which finds
    // no toggle beside a popup, never sees them.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const popup = popupRef.current;
            const target = e.target as Element;
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            if (!popup?.contains(target) || /input|textarea/i.test(target.tagName)) return;
            e.preventDefault();
            e.stopPropagation();
            focusListItem(popup, e.key === "ArrowDown" ? "next" : "previous", target);
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, []);

    const setElement = useCallback((element: HTMLDivElement | null) => {
        popupRef.current = element;
        if (typeof elementRef === "function") elementRef(element);
        else if (elementRef) elementRef.current = element;
    }, [ elementRef ]);

    return (
        <Popup
            {...props}
            elementRef={setElement}
            onPlaced={() => {
                if (startAt && popupRef.current) focusListItem(popupRef.current, startAt);
            }}
        />
    );
}
