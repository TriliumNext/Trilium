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
    getAttribute?(name: string): string | null | undefined;
    setAttribute?(name: string, value: string): unknown;
    remove?(): unknown;
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
