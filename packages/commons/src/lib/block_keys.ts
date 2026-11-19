import { BLOCK_ID_ATTRIBUTE, type BlockNode, isNoteEmbed } from "./block_reference.js";

/** The kinds of block that a key tells apart. `raw` is any other element, such as a figure. */
export type BlockKind =
    | "paragraph" | "heading" | "item" | "code" | "table" | "quote" | "admonition" | "rule"
    | "formula" | "tabs" | "tab" | "raw";

/**
 * The identity of a block, the same for a text note and a rendered Markdown note. It locates a
 * block and compares two blocks; equal keys never mean equal content.
 */
export interface BlockKey {
    kind: BlockKind;
    /** The kinds of its containers, from the document down. */
    ancestry: BlockKind[];
    /**
     * Its own text without white space. A block without text has the text of the nearest earlier
     * block that has some, and the distance to it.
     */
    text: string;
    /** How many earlier blocks have the same kind, ancestry and text. */
    ordinal: number;
}

/** A block found by {@link collectBlocks}. */
export interface CollectedBlock<T extends BlockNode = BlockNode> {
    key: BlockKey;
    /** The block id of the block, if it has one. */
    id?: string;
    /** The element that holds the block id: a list item's paragraph, a code block's `<code>`. */
    node: T;
}

/**
 * The blocks under `root` in document order, with their keys and ids. The content of an embed of
 * another note is not entered, but for its caption.
 */
export function collectBlocks<T extends BlockNode = BlockNode>(
    root: BlockNode
): CollectedBlock<T>[] {
    const blocks: CollectedBlock<T>[] = [];
    const ordinals = new Map<string, number>();
    let lastText = "";
    let distance = 0;

    const add = (kind: BlockKind, ancestry: BlockKind[], node: BlockNode, ownText: string) => {
        distance = ownText ? 0 : distance + 1;
        lastText = ownText || lastText;
        const text = ownText || `${NO_TEXT}${distance}${NO_TEXT}${lastText}`;
        const ordinalKey = JSON.stringify([ kind, ancestry, text ]);
        const ordinal = ordinals.get(ordinalKey) ?? 0;
        ordinals.set(ordinalKey, ordinal + 1);

        const id = node.getAttribute?.(BLOCK_ID_ATTRIBUTE) ?? undefined;
        blocks.push({ key: { kind, ancestry, text, ordinal }, id, node: node as T });
    };

    const stack: { node: BlockNode; ancestry: BlockKind[] }[] = [];
    const pushChildren = (children: BlockNode[], ancestry: BlockKind[]) => {
        for (let index = children.length - 1; index >= 0; index--) {
            stack.push({ node: children[index], ancestry });
        }
    };
    pushChildren(getElementChildren(root), []);

    while (stack.length) {
        const { node, ancestry } = stack.pop() as { node: BlockNode; ancestry: BlockKind[] };
        const block = classify(node);
        if (block === "container") {
            pushChildren(getElementChildren(node), ancestry);
            continue;
        }
        if (!block) {
            continue;
        }

        add(block.kind, ancestry, block.node, getOwnText(node, block.kind));
        const inner = [ ...ancestry, block.kind ];
        if (block.kind === "item") {
            // Inline content is the text of the item. Its paragraph, if any, is the item itself.
            pushChildren(getElementChildren(node).filter((child) =>
                child !== block.node && BLOCK_TAGS.has(tagOf(child))), inner);
        } else if (block.hasBlocks) {
            pushChildren(getElementChildren(node), inner);
        } else if (isNoteEmbed(node)) {
            // Its caption belongs to the note around it, and is a block once it has an id.
            pushChildren(getElementChildren(node).filter((child) => tagOf(child) === "FIGCAPTION"),
                inner);
        }
    }
    return blocks;
}

/** Whether `a` and `b` are the keys of the same block. */
export function isSameBlockKey(a: BlockKey, b: BlockKey) {
    return a.text === b.text && a.ordinal === b.ordinal && isSamePlaceKind(a, b);
}

/**
 * Whether `a` and `b` are the keys of the same block, or of two blocks without text of the same
 * kind and ancestry: a block inserted above such a block changes its distance to the text.
 */
export function isSameBlockShape(a: BlockKey, b: BlockKey) {
    return a.text.startsWith(NO_TEXT) && b.text.startsWith(NO_TEXT)
        ? isSamePlaceKind(a, b)
        : isSameBlockKey(a, b);
}

/** The block ids that a change of format lost, or put on another block. */
export interface BlockIdReport {
    lostBlockIds: string[];
    movedBlockIds: string[];
}

/**
 * Compares the block ids of `before` and `after`, the blocks of one note in two formats. An id
 * passes when its owner, the first block that has it, has the same key on both sides, or the same
 * kind and ancestry between the same neighbors: a change of format can change the text of a block
 * for reasons of its own. Any other id is lost or moved.
 */
export function compareBlockIds(before: CollectedBlock[], after: CollectedBlock[]): BlockIdReport {
    const afterOwners = getOwners(after);
    const report: BlockIdReport = { lostBlockIds: [], movedBlockIds: [] };
    for (const [ id, index ] of getOwners(before)) {
        const afterIndex = afterOwners.get(id);
        if (afterIndex === undefined) {
            report.lostBlockIds.push(id);
        } else if (!isSameBlockKey(before[index].key, after[afterIndex].key)
            && !isBetweenSameNeighbors(before, index, after, afterIndex)) {
            report.movedBlockIds.push(id);
        }
    }
    return report;
}

/** The position of the first block that has each id. */
function getOwners(blocks: CollectedBlock[]) {
    const owners = new Map<string, number>();
    for (const [ index, { id } ] of blocks.entries()) {
        if (id !== undefined && !owners.has(id)) {
            owners.set(id, index);
        }
    }
    return owners;
}

/**
 * Whether the blocks at `index` of `before` and at `afterIndex` of `after` have the same kind and
 * ancestry, and the nearest blocks with text before and after them have the same keys.
 */
function isBetweenSameNeighbors(
    before: CollectedBlock[],
    index: number,
    after: CollectedBlock[],
    afterIndex: number
) {
    const isSameNeighbor = (step: number) => {
        const a = findBlockWithText(before, index, step);
        const b = findBlockWithText(after, afterIndex, step);
        return a && b ? isSameBlockKey(a.key, b.key) : a === b;
    };
    return isSamePlaceKind(before[index].key, after[afterIndex].key)
        && isSameNeighbor(-1) && isSameNeighbor(1);
}

function findBlockWithText(blocks: CollectedBlock[], index: number, step: number) {
    for (let current = index + step; current >= 0 && current < blocks.length; current += step) {
        if (!blocks[current].key.text.startsWith(NO_TEXT)) {
            return blocks[current];
        }
    }
    return undefined;
}

function isSamePlaceKind(a: BlockKey, b: BlockKey) {
    return a.kind === b.kind && a.ancestry.length === b.ancestry.length
        && a.ancestry.every((kind, index) => kind === b.ancestry[index]);
}

interface ClassifiedBlock {
    kind: BlockKind;
    /** The element that holds the block id. */
    node: BlockNode;
    /** Whether blocks can be inside it, as in a quote. */
    hasBlocks: boolean;
}

/**
 * The block that `element` is; `"container"` for an element that only holds blocks, such as a
 * list; `null` for an element that is part of a block, such as a tab title or a link.
 */
function classify(element: BlockNode): ClassifiedBlock | "container" | null {
    const tag = tagOf(element);
    const classes = getClasses(element);
    const leaf = (kind: BlockKind, node = element) => ({ kind, node, hasBlocks: false });
    const holder = (kind: BlockKind) => ({ kind, node: element, hasBlocks: true });

    if (isNoteEmbed(element)) {
        return leaf("raw");
    }
    switch (tag) {
        case "P":
            if (classes.includes("trilium-tab-title")) {
                return null;
            }
            return leaf(isFormulaParagraph(element) ? "formula" : "paragraph");
        case "H1": case "H2": case "H3": case "H4": case "H5": case "H6":
            return leaf("heading");
        case "LI":
            return { kind: "item", node: getItemParagraph(element) ?? element, hasBlocks: true };
        case "PRE": {
            const code = getElementChildren(element).find((child) => tagOf(child) === "CODE");
            return leaf("code", code && !hasBlockId(element) ? code : element);
        }
        case "TABLE":
            return leaf("table");
        case "FIGURE":
            return leaf(classes.includes("table") ? "table" : "raw");
        case "BLOCKQUOTE":
            return holder("quote");
        case "ASIDE":
            return holder(classes.includes("admonition") ? "admonition" : "raw");
        case "HR":
            return leaf("rule");
        case "SPAN":
            return classes.includes("math-tex") ? leaf("formula") : null;
        case "DIV":
            if (classes.includes("trilium-tabs")) {
                return holder("tabs");
            }
            return hasBlockId(element) ? holder("raw") : "container";
        case "SECTION":
            return holder(classes.includes("trilium-tab") ? "tab" : "raw");
        case "DETAILS":
            return holder("raw");
        case "SUMMARY":
            return leaf("raw");
        case "UL": case "OL":
            return "container";
        default:
            return hasBlockId(element) ? holder("raw") : null;
    }
}

/**
 * The paragraph that holds the text of a list item and its block id, as the text editor saves an
 * item whose text has an attribute: the first child, after the label of a to-do item.
 */
function getItemParagraph(item: BlockNode) {
    for (const child of getElementChildren(item)) {
        const tag = tagOf(child);
        if (tag === "P") {
            return child;
        }
        if (tag !== "LABEL") {
            return null;
        }
    }
    return null;
}

/** Whether `paragraph` holds only a formula. */
function isFormulaParagraph(paragraph: BlockNode) {
    const children = Array.from(paragraph.childNodes)
        .filter((child) => child.tagName || child.textContent?.trim());
    return children.length === 1 && tagOf(children[0]) === "SPAN"
        && getClasses(children[0]).includes("math-tex");
}

/**
 * The text of a block without white space: a list item without its nested lists, a container with
 * all that is in it. The labels of reference links, which follow the title of their note, and the
 * content of an embed of another note but for its caption, are left out.
 */
function getOwnText(block: BlockNode, kind: BlockKind) {
    let text = "";
    const stack = getOwnChildren(block).reverse();
    while (stack.length) {
        const node = stack.pop() as BlockNode;
        if (!node.tagName) {
            text += node.nodeType === COMMENT_NODE ? "" : node.textContent as string;
            continue;
        }
        const tag = tagOf(node);
        const isNestedList = kind === "item" && (tag === "UL" || tag === "OL");
        const isReferenceLink = tag === "A" && getClasses(node).includes("reference-link");
        if (isNestedList || isReferenceLink) {
            continue;
        }
        const children = getOwnChildren(node);
        for (let index = children.length - 1; index >= 0; index--) {
            stack.push(children[index]);
        }
    }
    return text.replace(/\s+/g, "");
}

/** The children of `node` that belong to its note: of an embed of another note, its caption. */
function getOwnChildren(node: BlockNode) {
    const children = Array.from(node.childNodes);
    return isNoteEmbed(node)
        ? children.filter((child) => tagOf(child) === "FIGCAPTION")
        : children;
}

function getElementChildren(node: BlockNode) {
    return Array.from(node.childNodes).filter((child) => child.tagName);
}

function getClasses(node: BlockNode) {
    return node.getAttribute?.("class")?.split(/\s+/) ?? [];
}

function hasBlockId(node: BlockNode) {
    const id = node.getAttribute?.(BLOCK_ID_ATTRIBUTE);
    return id !== undefined && id !== null;
}

function tagOf(node: BlockNode) {
    return String(node.tagName).toUpperCase();
}

/** The elements inside a list item that are blocks of their own. */
const BLOCK_TAGS = new Set([
    "ASIDE", "BLOCKQUOTE", "DETAILS", "DIV", "FIGURE", "H1", "H2", "H3", "H4", "H5", "H6", "HR",
    "OL", "P", "PRE", "SECTION", "TABLE", "UL"
]);

const COMMENT_NODE = 8;

/** Starts the text of the key of a block without text, which white space never is. */
const NO_TEXT = "\u{0}";
