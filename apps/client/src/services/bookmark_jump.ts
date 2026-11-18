import {
    revealCollapsedHeadings
} from "@triliumnext/ckeditor5/src/plugins/collapsible_headings/collapsible_headings_read_only.js";
import { revealTab } from "@triliumnext/ckeditor5/src/plugins/tabs/tabs_read_only.js";
import { findOwnElementById } from "@triliumnext/commons/src/lib/block_reference.js";

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
    // are user text and can contain quotes or brackets that break CSS selector parsing. One in the
    // content of the note comes before one in the content of a note that it embeds.
    const bookmark = viewScope.bookmark;
    const el = findOwnElementById<Element>(container, bookmark)
        ?? [...container.querySelectorAll("[id]")].find((candidate) => candidate.id === bookmark);
    if (el) {
        revealElement(el);
        el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    viewScope.bookmark = undefined;
}

/** A place in the preview of a document that a link names, by a `heading` or a `bookmark`. */
export interface DocumentTarget {
    heading?: string;
    bookmark?: string;
}

/**
 * Takes the `heading` and `bookmark` link parameters out of `viewScope`, or returns `undefined`
 * and leaves it as it is when it holds neither.
 */
export function takeDocumentTarget(viewScope: ViewScope | null | undefined): DocumentTarget | undefined {
    const { heading, bookmark } = viewScope ?? {};
    if (!viewScope || (!heading && !bookmark)) {
        return undefined;
    }
    viewScope.heading = undefined;
    viewScope.bookmark = undefined;
    return { heading, bookmark };
}

/**
 * Scrolls `container`, the preview of a document that the server marked, to the element whose
 * `data-toc-heading` is the target's heading, or else whose `data-toc-bookmark` is its bookmark,
 * and flashes it. When no element has it, scrolls the preview to its top, so that it never stays
 * where an earlier link left it.
 */
export async function showDocumentTarget(container: Element, { heading, bookmark }: DocumentTarget) {
    const { getScrollContainer, showAnchorElement } = await import(
        "@triliumnext/ckeditor5/src/plugins/block_reference/block_reference_read_only.js");
    const element = (heading && findByAttribute(container, "data-toc-heading", heading))
        || (bookmark && findByAttribute(container, "data-toc-bookmark", bookmark));
    if (element) {
        showAnchorElement(element);
    } else {
        getScrollContainer(container).scrollTo({ top: 0 });
    }
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

/** The first element in `container` whose `name` attribute is `value`, compared exactly. */
function findByAttribute(container: Element, name: string, value: string) {
    // Not a selector: a bookmark name can hold characters that a CSS selector does not allow.
    return Array.from(container.querySelectorAll(`[${name}]`))
        .find((element) => element.getAttribute(name) === value);
}
