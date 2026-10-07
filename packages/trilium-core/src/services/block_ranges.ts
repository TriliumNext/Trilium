import {
    BLOCK_ID_ATTRIBUTE, getEditableBlockRun, getListItemNumber, sliceToBlockReference
} from "@triliumnext/commons";
import { HTMLElement, Node, parse } from "node-html-parser";

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
    const items = list.childNodes.filter((node) => isTag(node, "LI"));
    const firstChild = list.childNodes[0];
    const lastChild = list.childNodes[list.childNodes.length - 1];
    const editedList = getSameList(edited, list);
    if (editedList) {
        const firstNumber = getListItemNumber(editedList, -items.indexOf(run.first));
        const openTag = getOpenTag(editedList, firstNumber);
        const withItems = splice(content, start, end, editedList.innerHTML);
        return openTag === getOpenTag(list, getListItemNumber(list, 0))
            ? withItems
            : splice(withItems, list.range[0], firstChild.range[0], openTag);
    }

    // The edited items are no longer items of the list, which splits around them.
    const closeTag = content.slice(lastChild.range[1], list.range[1]);
    const wrap = (html: string, firstNumber: number) => (
        html.trim() ? `${getOpenTag(list, firstNumber)}${html}${closeTag}` : ""
    );
    const before = wrap(content.slice(firstChild.range[0], start), getListItemNumber(list, 0));
    const after = wrap(
        content.slice(end, lastChild.range[1]),
        getListItemNumber(list, items.indexOf(run.last) + 1)
    );
    return splice(content, list.range[0], list.range[1], `${before}${edited.toString()}${after}`);
}

function isList(node: HTMLElement) {
    return isTag(node, "UL") || isTag(node, "OL");
}

function isTag(node: Node, tagName: string) {
    return node instanceof HTMLElement && node.tagName === tagName;
}

/** The opening tag of `list`, numbered from `firstNumber` when it is ordered. */
function getOpenTag(list: HTMLElement, firstNumber: number) {
    const tag = new HTMLElement(list.rawTagName, {}, list.rawAttrs);
    if (isTag(tag, "OL")) {
        tag.setAttribute("start", String(firstNumber));
    }
    return `<${tag.rawTagName}${tag.rawAttrs ? ` ${tag.rawAttrs}` : ""}>`;
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
