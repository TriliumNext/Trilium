import type { CKTextEditor } from "@triliumnext/ckeditor5";
import { formatBlockRange, resolveBlockRange, resolveBlockReference } from "@triliumnext/commons";

import contextMenu from "../menus/context_menu.js";
import { getBlockExcerpt } from "./block_excerpts.js";
import { copyHtmlWithToast } from "./clipboard_ext.js";
import { expandAncestorDetails } from "./collapsible.js";
import { t } from "./i18n.js";
import { calculateHash, type ViewScope } from "./link.js";
import toast from "./toast.js";

const FLASH_CLASS = "block-reference-flash";
/** The duration of the `block-reference-flash` animation in `block_reference.css`. */
const FLASH_DURATION_MS = 1500;

/** Opens the menu of the block handle at `event`, which copies a reference to `count` blocks. */
export function openBlockHandleMenu(event: MouseEvent, count: number, copyReference: () => void) {
    void contextMenu.show({
        x: event.pageX,
        y: event.pageY,
        items: [ {
            title: t("block_reference.copy", { count }),
            uiIcon: "bx bx-link",
            handler: copyReference
        } ],
        selectMenuItemHandler: () => {}
    });
}

/**
 * Gives ids to the selected blocks of `editor`, flashes the blocks and copies a reference link to
 * them. `notePath` and `noteTitle` are of the note the editor shows.
 */
export async function copyBlockReference(
    editor: CKTextEditor,
    notePath: string,
    noteTitle: string
) {
    const target = editor.execute("assignBlockReference");
    const root = editor.editing.view.getDomRoot();
    const { start, end } = target && root
        ? resolveBlockRange<HTMLElement>(root, target)
        : { start: null, end: null };
    if (!target || !start || !end) {
        return;
    }

    flashBlocks(getBlockRangeElements(start, end));
    const href = calculateHash({ notePath, viewScope: { block: formatBlockRange(target) } });
    const $link = $("<a>")
        .addClass("reference-link")
        .attr("href", href)
        .text(`${noteTitle} - ${getBlockExcerpt(start, end)}`);
    await copyHtmlWithToast($link[0].outerHTML, href);
}

/**
 * Reads and clears `viewScope.block`, then scrolls to the blocks it points at in `container` and
 * flashes them. When a block is missing, the blocks found are shown, with an error toast.
 */
export function consumeBlockReference(
    container: HTMLElement | null | undefined,
    viewScope: ViewScope | null | undefined
) {
    if (!viewScope?.block || !container) {
        return;
    }

    const { start, end } = resolveBlockReference<HTMLElement>(container, viewScope.block);
    viewScope.block = undefined;

    const first = start ?? end;
    if (first) {
        expandAncestorDetails(first);
        first.scrollIntoView({ behavior: "smooth", block: "center" });
        flashBlocks(start && end ? getBlockRangeElements(start, end) : [ first ]);
    }
    if (!start || !end) {
        toast.showError(t("block_reference.not_found"));
    }
}

/** The outermost elements inside the range from `start` to `end`, both included. */
export function getBlockRangeElements(start: Element, end: Element) {
    const range = start.ownerDocument.createRange();
    range.setStartBefore(start);
    range.setEndAfter(end);
    return getElementsInRange(range, range.commonAncestorContainer);
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

function flashBlocks(elements: Element[]) {
    for (const element of elements) {
        element.classList.add(FLASH_CLASS);
        setTimeout(() => element.classList.remove(FLASH_CLASS), FLASH_DURATION_MS);
    }
}
