import {
    revealCollapsedHeadings
} from "@triliumnext/ckeditor5/src/plugins/collapsible_headings/collapsible_headings_read_only.js";
import { revealTab } from "@triliumnext/ckeditor5/src/plugins/tabs/tabs_read_only.js";
import { findOwnElementById } from "@triliumnext/commons/src/lib/block_reference.js";
import {
    TOC_BOOKMARK_ATTRIBUTE, TOC_HEADING_ATTRIBUTE
} from "@triliumnext/commons/src/lib/toc.js";

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
 * Scrolls `container`, the preview of a document that the server marked, to the element of
 * {@link findDocumentTarget}, and flashes it. When no element has it, scrolls the preview to its
 * top, so that it never stays where an earlier link left it, unless `isFallbackToTop` is `false`.
 */
export async function showDocumentTarget(
    container: Element, target: DocumentTarget, { isFallbackToTop = true } = {}
) {
    const element = findDocumentTarget(container, target);
    if (!element && !isFallbackToTop) {
        return;
    }
    const { getScrollContainer, showAnchorElement } = await import(
        "@triliumnext/ckeditor5/src/plugins/block_reference/block_reference_read_only.js");
    if (element) {
        showAnchorElement(element);
    } else {
        getScrollContainer(container).scrollTo({ top: 0 });
    }
}

/**
 * The element of `container`, the preview of a document that the server marked, whose
 * `TOC_HEADING_ATTRIBUTE` holds the target's heading as one of its space-separated ids, or else
 * whose `TOC_BOOKMARK_ATTRIBUTE` is its bookmark.
 */
export function findDocumentTarget(container: Element, { heading, bookmark }: DocumentTarget) {
    return (heading && findByAttribute(container, TOC_HEADING_ATTRIBUTE,
        (value) => value.split(" ").includes(heading)))
        || (bookmark && findByAttribute(container, TOC_BOOKMARK_ATTRIBUTE,
            (value) => value === bookmark))
        || undefined;
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

/** The first element in `container` whose `name` attribute `matches`. */
function findByAttribute(container: Element, name: string, matches: (value: string) => boolean) {
    // Not a selector: a bookmark name can hold characters that a CSS selector does not allow.
    /* v8 ignore next -- the selector matches only elements that have the attribute */
    return Array.from(container.querySelectorAll(`[${name}]`))
        .find((element) => matches(element.getAttribute(name) ?? ""));
}
