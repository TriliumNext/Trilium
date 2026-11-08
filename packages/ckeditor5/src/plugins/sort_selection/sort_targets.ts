import {
    _getAllListItemBlocks as getAllListItemBlocks,
    _getListItems as getListItems,
    _isFirstBlockOfListItem as isFirstBlockOfListItem,
    _isListItemBlock as isListItemBlock,
    _ListWalker as ListWalker,
    TableUtils
} from "ckeditor5";
import type { _ListElement as ListElement, Editor, Model, ModelElement } from "ckeditor5";

import type { SortRun } from "./sort_runs.js";
import { unitText } from "./sort_runs.js";

/** What a sort of the selection reorders. */
export type SortTargetKind = "listItems" | "blocks" | "rows";

export type SortTarget =
    | { kind: "listItems" | "blocks"; getRuns: () => SortRun[] }
    | { kind: "rows" };

/** The table commands that a sort of rows runs. */
export const TABLE_SORT_COMMANDS = {
    ascending: "triliumSortTableRowsAscending",
    descending: "triliumSortTableRowsDescending"
} as const;

/**
 * What a sort of the current selection reorders, or `null` when nothing can be sorted. The
 * innermost structure is sorted: in a table cell, a list or several selected blocks are sorted,
 * and a caret elsewhere in the cell sorts the rows. Commands refresh on every change, so the text
 * is read and a whole list walked only in `getRuns()`.
 */
export function resolveSortTarget(editor: Editor): SortTarget | null {
    const model = editor.model;
    const selection = model.document.selection;
    const tableUtils = editor.plugins.get(TableUtils);

    if (tableUtils.getSelectedTableCells(selection).length) {
        return getRowsTarget(editor);
    }

    const blocks = Array.from(selection.getSelectedBlocks());
    const isBlockRange = !selection.isCollapsed && blocks.length > 1;
    return getListTarget(model, blocks)
        ?? (isBlockRange ? getBlocksTarget(model, blocks[0], blocks[blocks.length - 1]) : null)
        ?? (tableUtils.getSelectionAffectedTableCells(selection).length
            ? getRowsTarget(editor)
            : null);
}

function getRowsTarget(editor: Editor): SortTarget | null {
    return editor.commands.get(TABLE_SORT_COMMANDS.ascending)?.isEnabled ? { kind: "rows" } : null;
}

/**
 * The items of the list at the lowest level of the selected list blocks. A caret, or a selection
 * inside one item, sorts every item of its list at that level. Each item moves with its nested
 * items, which are not sorted.
 */
function getListTarget(model: Model, blocks: ModelElement[]): SortTarget | null {
    const listBlocks = blocks.filter(isListItemBlock);
    if (!listBlocks.length || listBlocks.length < blocks.length) {
        return null;
    }

    const level = Math.min(...listBlocks.map(getIndent));
    const firstHead = getItemHead(listBlocks[0], level);
    const lastHead = getItemHead(listBlocks[listBlocks.length - 1], level);
    if (firstHead === lastHead) {
        return hasSiblingItem(firstHead)
            ? getListItemsTarget(model,
                () => getListItems(firstHead).filter((block) => isFirstBlockOfListItem(block)))
            : null;
    }

    const heads = getHeadsBetween(firstHead, lastHead);
    return heads && getListItemsTarget(model, () => heads);
}

/** Sorts the items whose first blocks `getHeads()` returns, each with its nested items. */
function getListItemsTarget(model: Model, getHeads: () => ListElement[]): SortTarget {
    return {
        kind: "listItems",
        getRuns: () => getHeads().map((head) => {
            const itemBlocks = getAllListItemBlocks(head, { higherIndent: true });
            return {
                first: head,
                last: itemBlocks[itemBlocks.length - 1],
                text: unitText(model, head)
            };
        })
    };
}

/** Whether the list of `item` has another item at its level, read from the closest blocks. */
function hasSiblingItem(item: ListElement): boolean {
    for (const direction of [ "backward", "forward" ] as const) {
        const walker = new ListWalker(item, {
            direction,
            sameIndent: true,
            sameAttributes: "listType"
        });
        for (const block of walker) {
            if (block.getAttribute("listItemId") !== item.getAttribute("listItemId")) {
                return true;
            }
        }
    }
    return false;
}

/**
 * The first block of each item from `firstHead` to `lastHead`, or `null` when `lastHead` is in
 * another list, such as a numbered list after a bulleted one or a list in a quote.
 */
function getHeadsBetween(firstHead: ListElement, lastHead: ListElement): ListElement[] | null {
    const heads: ListElement[] = [];
    const walker = new ListWalker(firstHead, {
        direction: "forward",
        includeSelf: true,
        sameIndent: true,
        sameAttributes: "listType"
    });
    for (const block of walker) {
        if (isFirstBlockOfListItem(block)) {
            heads.push(block);
        }
        if (block === lastHead) {
            return heads;
        }
    }
    return null;
}

/**
 * The siblings from the one holding `firstBlock` to the one holding `lastBlock`. A collapsible's
 * title is replaced by the collapsible, as in the block moves. Not sortable when one of them is a
 * list block.
 */
function getBlocksTarget(
    model: Model,
    firstBlock: ModelElement,
    lastBlock: ModelElement
): SortTarget | null {
    // Root first, so the first ancestors that differ are two siblings.
    const firstPath = getSortableBlock(firstBlock).getAncestors({ includeSelf: true });
    const lastPath = getSortableBlock(lastBlock).getAncestors({ includeSelf: true });
    const depth = firstPath.findIndex((ancestor, index) => ancestor !== lastPath[index]);
    // One block holds the other.
    if (depth < 0 || depth >= lastPath.length) {
        return null;
    }

    // Below the root, every ancestor is an element.
    const start = firstPath[depth] as ModelElement;
    const end = lastPath[depth] as ModelElement;

    const units = [ start ];
    while (units[units.length - 1] !== end) {
        // The children of a parent of blocks are elements.
        units.push(units[units.length - 1].nextSibling as ModelElement);
    }
    if (units.some((unit) => isListItemBlock(unit))) {
        return null;
    }

    return {
        kind: "blocks",
        getRuns: () => units.map((unit) =>
            ({ first: unit, last: unit, text: unitText(model, unit) }))
    };
}

/** `block`, or the collapsible whose title it is. */
function getSortableBlock(block: ModelElement): ModelElement {
    // A summary is only allowed in a collapsible.
    return block.is("element", "summary") ? block.parent as ModelElement : block;
}

/** The first block of the item at `level` that holds `block`. */
function getItemHead(block: ListElement, level: number): ListElement {
    let item = block;
    while (getIndent(item) > level && isListItemBlock(item.previousSibling)) {
        item = item.previousSibling;
    }
    return getAllListItemBlocks(item)[0];
}

function getIndent(block: ListElement): number {
    return block.getAttribute("listIndent");
}
