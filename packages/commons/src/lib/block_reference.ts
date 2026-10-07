/** The HTML attribute with the id of a block in a text note. */
export const BLOCK_ID_ATTRIBUTE = "data-trilium-block-id";

/** The blocks that a block reference points at. `startId` equals `endId` for a single block. */
export interface BlockRange {
    startId: string;
    endId: string;
}

/** A node of an HTML tree. The browser DOM and `node-html-parser` both match it. */
export interface BlockNode {
    parentNode: BlockNode | null;
    childNodes: ArrayLike<BlockNode>;
    tagName?: string;
    textContent?: string | null;
    getAttribute?(name: string): string | null | undefined;
    setAttribute?(name: string, value: string): unknown;
    remove?(): unknown;
}

/** Sibling nodes, children of `parent`, from `first` to `last`. */
export interface BlockRun<T extends BlockNode> {
    parent: T;
    first: T;
    last: T;
}

/** Whether `id` can be a block id. An id can be any text without `:`, the range separator. */
export function isValidBlockId(id: string | null | undefined): id is string {
    return !!id && !id.includes(":");
}

/** Parses the value of the `block` link parameter, `id` or `startId:endId`. */
export function parseBlockRange(value: string | null | undefined): BlockRange | null {
    const ids = value?.split(":") ?? [];
    if (ids.length < 1 || ids.length > 2 || ids.some((id) => !id)) {
        return null;
    }

    return { startId: ids[0], endId: ids[1] ?? ids[0] };
}

/** Formats `range` as the value of the `block` link parameter. */
export function formatBlockRange({ startId, endId }: BlockRange) {
    return startId === endId ? startId : `${startId}:${endId}`;
}

/** URI-encodes the value of the `block` link parameter, keeping the `:` between the ids. */
export function encodeBlockParameter(value: string) {
    return value.split(":").map(encodeURIComponent).join(":");
}

/**
 * Finds the first and the last block of `range` under `root`, in document order. A block that is
 * not found is `null`.
 */
export function resolveBlockRange<T extends BlockNode>(root: BlockNode, range: BlockRange) {
    let start: T | null = null;
    let end: T | null = null;
    let isEndFirst = false;

    for (const node of walk(root)) {
        const id = node.getAttribute?.(BLOCK_ID_ATTRIBUTE);
        if (!start && id === range.startId) {
            start = node as T;
        }
        if (!end && id === range.endId) {
            end = node as T;
            isEndFirst = !start;
        }
        if (start && end) {
            break;
        }
    }

    if (start && end && isEndFirst) {
        return { start: end, end: start };
    }
    return { start, end };
}

/** Finds the blocks that `value`, a `block` link parameter, points at, as `resolveBlockRange()`. */
export function resolveBlockReference<T extends BlockNode>(root: BlockNode, value: string) {
    const range = parseBlockRange(value);
    return range ? resolveBlockRange<T>(root, range) : { start: null, end: null };
}

/**
 * Keeps in `root` only the blocks that `value`, a `block` link parameter, points at, inside their
 * ancestors. Returns `false` and changes nothing when a block is missing.
 */
export function sliceToBlockReference(root: BlockNode, value: string) {
    const { start, end } = resolveBlockReference(root, value);
    if (!start || !end) {
        return false;
    }

    sliceToBlockRange(root, start, end);
    return true;
}

/**
 * The sibling nodes under `root` that hold exactly the blocks that `value`, a `block` link
 * parameter, points at, so that they can be edited apart from the rest. Blocks that fill a list
 * item are its item. `null` when a block is missing, or when an ancestor of the blocks also holds
 * other content, as a list item does for a paragraph before the first block.
 */
export function getEditableBlockRun<T extends BlockNode>(
    root: T,
    value: string
): BlockRun<T> | null {
    const { start, end } = resolveBlockReference<T>(root, value);
    if (!start || !end) {
        return null;
    }

    const startPath = getPath(start, root);
    const endPath = getPath(end, root);
    let depth = 0;
    while (depth < startPath.length && startPath[depth] === endPath[depth]) {
        depth++;
    }

    const isNested = depth === startPath.length;
    const first = isNested ? start : startPath[depth];
    const last = isNested ? start : endPath[depth];
    const parent = first.parentNode as T;
    if (!isAtEdge(start, first, "first") || !isAtEdge(end, last, "last")) {
        return null;
    }

    if (isTag(parent, "LI") && isAtEdge(first, parent, "first") && isAtEdge(last, parent, "last")) {
        return { parent: parent.parentNode as T, first: parent, last: parent };
    }
    const isContainer = parent === root || RUN_CONTAINERS.has(String(parent.tagName).toUpperCase());
    return isContainer ? { parent, first, last } : null;
}

const RUN_CONTAINERS = new Set([
    "ASIDE", "BLOCKQUOTE", "DETAILS", "DIV", "LI", "OL", "SECTION", "UL"
]);

function getPath<T extends BlockNode>(node: T, root: BlockNode) {
    const path: T[] = [];
    for (let current: BlockNode = node; current !== root;) {
        path.unshift(current as T);
        current = current.parentNode as BlockNode;
    }
    return path;
}

function isAtEdge(node: BlockNode, ancestor: BlockNode, edge: "first" | "last") {
    for (let current = node; current !== ancestor;) {
        const parent = current.parentNode as BlockNode;
        const siblings = Array.from(parent.childNodes).filter(isContent);
        if (siblings.at(edge === "first" ? 0 : -1) !== current) {
            return false;
        }
        current = parent;
    }
    return true;
}

/** Whether `node` has text, or is an element other than a label, such as a to-do checkbox. */
function isContent(node: BlockNode) {
    return !!node.textContent?.trim() || (!!node.tagName && !isTag(node, "LABEL"));
}

function sliceToBlockRange(root: BlockNode, start: BlockNode, end: BlockNode) {
    for (let node = start; node !== root && node.parentNode; node = node.parentNode) {
        const siblings = Array.from(node.parentNode.childNodes);
        const removed = siblings.slice(0, siblings.indexOf(node));
        removeNodes(removed);
        keepListNumbering(node.parentNode, removed);
    }

    for (let node = end; node !== root && node.parentNode; node = node.parentNode) {
        const siblings = Array.from(node.parentNode.childNodes);
        removeNodes(siblings.slice(siblings.indexOf(node) + 1));
    }
}

function* walk(node: BlockNode): Generator<BlockNode> {
    for (const child of Array.from(node.childNodes)) {
        yield child;
        yield* walk(child);
    }
}

function removeNodes(nodes: BlockNode[]) {
    for (const node of nodes) {
        node.remove?.();
    }
}

function keepListNumbering(list: BlockNode, removed: BlockNode[]) {
    const removedItems = removed.filter((node) => isTag(node, "LI")).length;
    if (!isTag(list, "OL") || !removedItems) {
        return;
    }

    const start = Number.parseInt(list.getAttribute?.("start") ?? "", 10);
    const firstNumber = Number.isNaN(start) ? 1 : start;
    list.setAttribute?.("start", String(firstNumber + removedItems));
}

function isTag(node: BlockNode, tagName: string) {
    return node.tagName?.toUpperCase() === tagName;
}
