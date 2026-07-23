import { expandCollapsedAncestors } from "./collapsibles.js";
import type { ViewScope } from "./link.js";

/**
 * Consumes `viewScope.bookmark` (the `?bookmark=` link parameter) against a rendered note
 * content container: expands any closed collapsible ancestor of the target, scrolls to it,
 * and clears the bookmark so it fires only once (mirrors `consumeSearchTerms`).
 *
 * When `container` is null/undefined the bookmark is left untouched — the content is not
 * rendered yet, and a later call (after the content commit) must still find it. A bookmark
 * whose anchor does not exist in the content is consumed without scrolling, so a dangling
 * id does not re-fire on every content reload.
 */
export function consumeBookmark(container: ParentNode | null | undefined, viewScope: ViewScope | null | undefined) {
    if (!viewScope?.bookmark || !container) {
        return;
    }

    // Exact id comparison instead of an interpolated attribute selector — bookmark names are
    // user text and may contain quotes/brackets that break CSS selector parsing.
    const bookmark = viewScope.bookmark;
    const el = [...container.querySelectorAll("[id]")].find((candidate) => candidate.id === bookmark);
    if (el) {
        expandCollapsedAncestors(el);
        el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    viewScope.bookmark = undefined;
}
