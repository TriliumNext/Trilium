import {
    revealCollapsedHeadings
} from "@triliumnext/ckeditor5/src/plugins/collapsible_headings/collapsible_headings_read_only.js";
import { revealTab } from "@triliumnext/ckeditor5/src/plugins/tabs/tabs_read_only.js";

import { expandAncestorDetails } from "./collapsible.js";
import type { ViewScope } from "./link.js";

/**
 * Consumes `viewScope.bookmark` (the `?bookmark=` link parameter) against a rendered note
 * content container: reveals the target inside collapsed blocks and inactive tabs, scrolls to it,
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
        revealElement(el);
        el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    viewScope.bookmark = undefined;
}

/**
 * Shows `el` wherever it is hidden: opens the `<details>` inside `boundary`, shows the tabs that
 * enclose it and the sections of the collapsed headings that hide it. A text editor around
 * `boundary` reveals its own blocks, as their open state is saved.
 */
export function revealElement(el: Element, boundary?: Element) {
    expandAncestorDetails(el, boundary);
    revealTab(el);
    revealCollapsedHeadings(el);
}
