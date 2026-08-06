/**
 * The app's floating layers: popup roots that render into `document.body` rather than inside
 * whatever raised them — resize gutters, Bootstrap dropdowns, tooltips, modals and their backdrop,
 * popovers, CKEditor balloons, Flatpickr calendars, the attribute detail popup, the context menu,
 * and both autocomplete dropdowns (Preact `FormAutocomplete` and the jQuery note autocomplete).
 *
 * A surface that closes on an outside press — the peeked right pane, an anchored popover — cannot
 * tell "outside" by DOM containment alone. A dropdown opened from within it lives in the body, so
 * the press that works its controls reads as a press somewhere else entirely. The cost is worse
 * than a stray dismissal: the press is heard on `pointerdown`, which tears the surface down — and
 * with it the portaled menu — before the `click` that would have chosen anything ever arrives, so
 * the choice is silently lost rather than merely interrupted.
 *
 * Matching this means "a layer standing over the surface", which is never a reason to dismiss it:
 * such a layer sees to its own dismissal, and what raised it stays behind it.
 */
export const FLOATING_LAYER_SELECTOR = ".gutter, .dropdown-menu, .tooltip, .modal, .modal-backdrop, .popover, "
    + ".ck-balloon-panel, .ck-body, .flatpickr-calendar, .attr-detail, #context-menu-container, "
    + ".form-autocomplete-dropdown, .aa-dropdown-menu";

/** Whether a press landed in one of the app's floating layers. See {@link FLOATING_LAYER_SELECTOR}. */
export function isWithinFloatingLayer(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest(FLOATING_LAYER_SELECTOR) !== null;
}
