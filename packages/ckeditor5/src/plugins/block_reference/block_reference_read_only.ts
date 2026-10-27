import { resolveBlockReference } from "@triliumnext/commons/src/lib/block_reference.js";

import "../../theme/block_reference.css";
import { CLASSES as TAB_CLASSES } from "../tabs/constants.js";
import { getTabTitle, revealTab } from "../tabs/tabs_read_only.js";

const FLASH_CLASS = "block-reference-flash";
/** The duration of the `block-reference-flash` animation in `block_reference.css`. */
const FLASH_DURATION_MS = 1500;
/** The smallest gap above the shown blocks, as a share of the height of their scroll container. */
const MIN_TOP_GAP = 0.15;

/**
 * Scrolls to the blocks that `value`, a `block` link parameter, points at in `container` and
 * flashes them. The blocks are centered, but start at least 15% below the top of their scroll
 * container. Of a broken range, the block found is shown. Returns `false` when a block is missing.
 *
 * The module imports nothing from CKEditor, so pages that only display content can load it.
 */
export function showBlockReference(container: Element, value: string) {
    const { start, end } = resolveBlockReference<HTMLElement>(container, value);
    const first = start ?? end;
    if (first) {
        const last = start && end ? end : first;
        // `first` is revealed last, so it stays shown when both are in different tabs of a block.
        reveal(last);
        reveal(first);
        scrollToBlocks(first, last);
        flashBlocks(getBlockRangeElements(first, last));
    }

    return !!start && !!end;
}

/** Flashes `elements` for a moment. */
export function flashBlocks(elements: Element[]) {
    for (const element of elements) {
        element.classList.add(FLASH_CLASS);
        setTimeout(() => element.classList.remove(FLASH_CLASS), FLASH_DURATION_MS);
    }
}

/**
 * Returns the elements that render the top and bottom of `block`. A tab is `display: contents`, so
 * its title and panel render it.
 */
export function getBlockBoxes(block: Element): { top: Element; bottom: Element } {
    if (block.classList.contains(TAB_CLASSES.tab)) {
        const title = getTabTitle(block);
        const panel = block.querySelector(`:scope > .${TAB_CLASSES.tabPanel}`);
        if (title && panel) {
            return { top: title, bottom: panel };
        }
    }
    return { top: block, bottom: block };
}

/** The outermost elements inside the range from `start` to `end`, both included. */
export function getBlockRangeElements(start: Element, end: Element) {
    const range = start.ownerDocument.createRange();
    range.setStartBefore(start);
    range.setEndAfter(end);
    return getElementsInRange(range, range.commonAncestorContainer);
}

/** Smoothly scrolls to center the blocks from `first` to `last`, keeping `MIN_TOP_GAP` above. */
function scrollToBlocks(first: Element, last: Element) {
    const scroller = getScrollContainer(first);
    const top = getBlockBoxes(first).top.getBoundingClientRect().top;
    const height = getBlockBoxes(last).bottom.getBoundingClientRect().bottom - top;
    const viewportTop = scroller === first.ownerDocument.scrollingElement
        ? 0
        : scroller.getBoundingClientRect().top + scroller.clientTop;
    const viewportHeight = scroller.clientHeight;
    const gap = Math.max(viewportHeight * MIN_TOP_GAP, (viewportHeight - height) / 2);
    scroller.scrollBy({ top: top - viewportTop - gap, behavior: "smooth" });
}

/** The nearest ancestor of `element` that scrolls vertically, else the document's scroller. */
function getScrollContainer(element: Element) {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const { overflowY } = getComputedStyle(parent);
        if ([ "auto", "scroll" ].includes(overflowY) && parent.scrollHeight > parent.clientHeight) {
            return parent;
        }
    }
    return element.ownerDocument.scrollingElement ?? element.ownerDocument.documentElement;
}

/** Opens the `<details>` and shows the tabs that enclose `element`. */
function reveal(element: Element) {
    let details = element.closest("details");
    while (details) {
        details.open = true;
        details = details.parentElement?.closest("details") ?? null;
    }
    revealTab(element);
}

function getElementsInRange(range: Range, parent: Node): Element[] {
    const elements: Element[] = [];
    for (const child of Array.from(parent.childNodes)) {
        if (!(child instanceof Element) || !range.intersectsNode(child)) {
            continue;
        }

        if (isInRange(range, child)) {
            elements.push(child);
        } else {
            elements.push(...getElementsInRange(range, child));
        }
    }

    return elements;
}

function isInRange(range: Range, node: Node) {
    const nodeRange = range.cloneRange();
    nodeRange.selectNode(node);
    return range.compareBoundaryPoints(Range.START_TO_START, nodeRange) <= 0
        && range.compareBoundaryPoints(Range.END_TO_END, nodeRange) >= 0;
}
