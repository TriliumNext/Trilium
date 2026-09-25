import { expandAncestorDetails } from "./collapsible.js";
import type { ViewScope } from "./link.js";

/**
 * Consumes `viewScope.bookmark` (the `?bookmark=` link parameter) against a rendered note
 * content container: expands any closed collapsible ancestor of the target, scrolls to it,
 * and clears the bookmark so it fires only once (mirrors `consumeSearchTerms`).
 *
 * A null `container` leaves the bookmark untouched, because the content is not rendered yet and
 * the call that follows the content commit must still find it. An anchor that does not exist in
 * the content is consumed without scrolling, so a dangling id does not re-fire on every reload.
 */
export function consumeBookmark(container: ParentNode | null | undefined, viewScope: ViewScope | null | undefined) {
    if (!viewScope?.bookmark || !container) {
        return;
    }

    // Exact id comparison rather than an interpolated attribute selector, because bookmark names
    // are user text and can contain quotes or brackets that break CSS selector parsing.
    const bookmark = viewScope.bookmark;
    const el = [...container.querySelectorAll("[id]")].find((candidate) => candidate.id === bookmark);
    if (el) {
        expandAncestorDetails(el);
        el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    viewScope.bookmark = undefined;
}
