import { useEffect } from "preact/hooks";

const RADIX_PORTAL_SELECTOR = "[id^='radix-']";
const RECT_POPUP_SELECTOR = "[data-u-comp='rect-popup']";

/**
 * Stops Univer's popups from closing when a dropdown they opened is used.
 *
 * In React, an event inside a portal bubbles through the component tree, so the components
 * that open a dropdown see clicks on it as their own. With preact/compat, portal events follow
 * the DOM only, and Univer's popups treat a click in a portaled dropdown as outside:
 *
 * - Radix's `DismissableLayer` (Univer's `Dialog`, `Dropdown`, `DropdownMenu`) dispatches
 *   `dismissableLayer.pointerDownOutside` / `dismissableLayer.focusOutside` on the target.
 *   Univer's `Dialog` closes from its `onPointerDownOutside` without checking
 *   `defaultPrevented`, so these events are stopped before they reach the target.
 * - Radix's `Dialog` defers its outside event to the `click`, by which time the picked item has
 *   closed its dropdown and left the DOM, out of reach of a `document` listener. Radix skips the
 *   deferred event when a `mousedown` or `touchstart` in between never bubbles back to
 *   `document`, so those are stopped at `body` inside a dropdown opened from another layer.
 * - `RectPopup` (the filter panel and other cell popups) closes on any `pointerdown` that
 *   reaches `window`, and relies on its own `onPointerDown` to stop the ones inside it.
 */
export default function useFixRadixPortals() {
    useEffect(() => installRadixPortalFixes(document), []);
}

export function installRadixPortalFixes(doc: Document) {
    function stopOutsideEvent(e: Event) {
        if (e.target instanceof Element && e.target.closest(RADIX_PORTAL_SELECTOR)) {
            e.stopPropagation();
        }
    }

    function stopDeferredDismiss(e: Event) {
        if (e.target instanceof Element && isOpenedFrom(doc, e.target, RADIX_PORTAL_SELECTOR)) {
            e.stopPropagation();
        }
    }

    function stopRectPopupDismiss(e: Event) {
        if (e.target instanceof Element && isOpenedFrom(doc, e.target, RECT_POPUP_SELECTOR)) {
            e.stopPropagation();
        }
    }

    doc.addEventListener("dismissableLayer.pointerDownOutside", stopOutsideEvent, true);
    doc.addEventListener("dismissableLayer.focusOutside", stopOutsideEvent, true);
    doc.body.addEventListener("mousedown", stopDeferredDismiss);
    doc.body.addEventListener("touchstart", stopDeferredDismiss);
    doc.addEventListener("pointerdown", stopRectPopupDismiss);
    return () => {
        doc.removeEventListener("dismissableLayer.pointerDownOutside", stopOutsideEvent, true);
        doc.removeEventListener("dismissableLayer.focusOutside", stopOutsideEvent, true);
        doc.body.removeEventListener("mousedown", stopDeferredDismiss);
        doc.body.removeEventListener("touchstart", stopDeferredDismiss);
        doc.removeEventListener("pointerdown", stopRectPopupDismiss);
    };
}

/**
 * Follows each Radix portal back to the trigger whose `aria-controls` names it, until a trigger
 * lies inside an element matching `openerSelector` or outside any portal.
 */
function isOpenedFrom(doc: Document, target: Element, openerSelector: string) {
    const visited = new Set<Element>();
    let portal = target.closest(RADIX_PORTAL_SELECTOR);
    while (portal && !visited.has(portal)) {
        visited.add(portal);
        const trigger = doc.querySelector(`[aria-controls="${portal.id}"]`);
        if (!trigger) return false;
        if (trigger.closest(openerSelector)) return true;
        portal = trigger.closest(RADIX_PORTAL_SELECTOR);
    }
    return false;
}
