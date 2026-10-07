import {
    BLOCK_ID_ATTRIBUTE, getEditableBlockRun, sliceToBlockReference
} from "@triliumnext/commons";
import { HTMLElement, parse } from "node-html-parser";

/**
 * The HTML of the blocks of `content` that `block`, a `block` link parameter, points at, to edit
 * apart from the rest: list items come inside a copy of their list. `null` when the blocks cannot
 * be edited apart, as `getEditableBlockRun()` decides.
 */
export function getBlockRangeContent(content: string, block: string) {
    const root = parse(content);
    const run = getEditableBlockRun<HTMLElement>(root, block);
    if (!run) {
        return null;
    }

    if (isList(run.parent)) {
        sliceToBlockReference(root, block);
        return run.parent.toString();
    }
    return content.slice(run.first.range[0], run.last.range[1]);
}

/**
 * `content` with `fragment`, the edited HTML of `getBlockRangeContent()`, in place of the blocks
 * that `block` points at, or `null` when they cannot be edited apart. The rest of `content` stays
 * byte for byte, and `fragment` loses the block ids that the rest holds already.
 */
export function replaceBlockRangeContent(content: string, block: string, fragment: string) {
    const root = parse(content);
    const run = getEditableBlockRun<HTMLElement>(root, block);
    if (!run) {
        return null;
    }

    const start = run.first.range[0];
    const end = run.last.range[1];
    const edited = parse(fragment);
    removeBlockIds(edited, getBlockIdsOutside(root, start, end));

    if (!isList(run.parent)) {
        return splice(content, start, end, edited.toString());
    }

    const list = run.parent;
    const editedList = getSameList(edited, list);
    if (editedList) {
        return splice(content, start, end, editedList.innerHTML);
    }

    // The edited items are no longer items of the list, which splits around them.
    const firstItem = list.childNodes[0];
    const lastItem = list.childNodes[list.childNodes.length - 1];
    const openTag = content.slice(list.range[0], firstItem.range[0]);
    const closeTag = content.slice(lastItem.range[1], list.range[1]);
    const wrap = (items: string) => (items.trim() ? `${openTag}${items}${closeTag}` : "");
    const before = wrap(content.slice(firstItem.range[0], start));
    const after = wrap(content.slice(end, lastItem.range[1]));
    return splice(content, list.range[0], list.range[1], `${before}${edited.toString()}${after}`);
}

function isList(node: HTMLElement) {
    return node.tagName === "UL" || node.tagName === "OL";
}

function getBlockIdsOutside(root: HTMLElement, start: number, end: number) {
    const ids = new Set<string>();
    for (const element of root.querySelectorAll(`[${BLOCK_ID_ATTRIBUTE}]`)) {
        if (element.range[0] < start || element.range[0] >= end) {
            ids.add(element.attributes[BLOCK_ID_ATTRIBUTE]);
        }
    }
    return ids;
}

function removeBlockIds(root: HTMLElement, ids: Set<string>) {
    for (const element of root.querySelectorAll(`[${BLOCK_ID_ATTRIBUTE}]`)) {
        if (ids.has(element.attributes[BLOCK_ID_ATTRIBUTE])) {
            element.removeAttribute(BLOCK_ID_ATTRIBUTE);
        }
    }
}

/** The list that `root` consists of, when it is a list of the same kind as `list`. */
function getSameList(root: HTMLElement, list: HTMLElement) {
    const nodes = root.childNodes
        .filter((node) => node instanceof HTMLElement || node.textContent.trim());
    const [ only ] = nodes;
    const isSame = nodes.length === 1
        && only instanceof HTMLElement
        && only.tagName === list.tagName
        && only.getAttribute("class") === list.getAttribute("class");
    return isSame ? only : null;
}

function splice(content: string, start: number, end: number, replacement: string) {
    return `${content.slice(0, start)}${replacement}${content.slice(end)}`;
}
