import { decodeHtmlEntities, hasOnlyDecodableReferences } from "./utils.js";

/** The HTML attribute with the id of a block in a text note. */
export const BLOCK_ID_ATTRIBUTE = "data-trilium-block-id";

/** The id of a note or of an attachment, as an embed names it. */
export const ENTITY_ID_PATTERN = /^[a-zA-Z0-9_]+$/;

/**
 * A block marker, the form of a block id in Markdown: `<a data-trilium-block-id="ID"></a>`. Also
 * read: the self-closed tag and an opening tag alone, with either quote, on one line. Group 1 or 2
 * holds the value of the attribute.
 */
export const BLOCK_MARKER_SOURCE = String.raw`<a[ \t]+data-trilium-block-id[ \t]*=[ \t]*`
    + String.raw`(?:"([^"\n]*)"|'([^'\n]*)')[ \t]*(?:\/>|>(?:[ \t]*<\/a[ \t]*>)?)`;

/** The class of a multicolumn layout, a `<div>` whose child elements are its columns. */
export const MULTICOLUMN_LAYOUT_CLASS = "trilium-multicolumn-layout";

/** The class of a column of a multicolumn layout. */
export const MULTICOLUMN_COLUMN_CLASS = "trilium-multicolumn-column";

/** The blocks that a block reference points at. `startId` equals `endId` for a single block. */
export interface BlockRange {
    startId: string;
    endId: string;
}

/** A node of an HTML tree. The browser DOM and `node-html-parser` both match it. */
export interface BlockNode {
    parentNode: BlockNode | null;
    childNodes: ArrayLike<BlockNode>;
    nodeType?: number;
    tagName?: string;
    textContent?: string | null;
    getAttribute?(name: string): string | null | undefined;
    setAttribute?(name: string, value: string): unknown;
    removeAttribute?(name: string): unknown;
    remove?(): unknown;
    replaceWith?(...nodes: unknown[]): unknown;
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

/** A new random block id, of letters and digits. */
export function generateBlockId() {
    const bytes = crypto.getRandomValues(new Uint8Array(BLOCK_ID_LENGTH));
    const characters = Array.from(bytes, (byte) =>
        BLOCK_ID_CHARACTERS[byte % BLOCK_ID_CHARACTERS.length]);
    return characters.join("");
}

/**
 * A valid id from `createId` that `content` does not hold anywhere, so no other block has it, or
 * `null` when none of `MAX_ID_DRAWS` draws is one.
 */
export function drawBlockId(content: string, createId: () => string) {
    for (let attempt = 0; attempt < MAX_ID_DRAWS; attempt++) {
        const id = createId();
        if (isValidBlockId(id) && !content.includes(id)) {
            return id;
        }
    }
    return null;
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

/** A block marker or a block id attribute in a text, with its offsets. */
export interface FoundBlockId {
    from: number;
    to: number;
    /** The decoded value, `null` when it is not a valid block id. */
    id: string | null;
}

/**
 * The block marker of `id`, a valid block id. Every character of `id` outside `[A-Za-z0-9_.-]` is
 * written as a numeric character reference, so that no Markdown syntax can take it.
 */
export function formatBlockMarker(id: string) {
    return `<a ${BLOCK_ID_ATTRIBUTE}="${encodeBlockMarkerId(id)}"></a>`;
}

/**
 * The block id that the attribute value of a marker holds, or `null` when it is not valid. It is
 * checked once decoded, as `&#58;` is a colon; a reference to no character makes no id.
 */
export function decodeBlockMarkerId(value: string) {
    const id = decodeHtmlEntities(value);
    return isValidBlockId(id) && hasOnlyDecodableReferences(value) ? id : null;
}

/** The block markers in `text`, in their read forms. They mark nothing by themselves. */
export function findBlockMarkers(text: string): FoundBlockId[] {
    return Array.from(text.matchAll(new RegExp(BLOCK_MARKER_SOURCE, "gi")), (match) => ({
        from: match.index,
        to: match.index + match[0].length,
        id: decodeBlockMarkerId(match[1] ?? match[2])
    }));
}

/** Every `data-trilium-block-id` attribute of a tag in `text`, on a marker or on any other tag. */
export function findBlockIdAttributes(text: string): FoundBlockId[] {
    const attributes: FoundBlockId[] = [];
    for (const tag of text.matchAll(/<[a-z][^<>]*>/gi)) {
        for (const attribute of tag[0].matchAll(BLOCK_ID_ATTRIBUTE_VALUE)) {
            const from = tag.index + attribute.index;
            attributes.push({
                from,
                to: from + attribute[0].length,
                id: decodeBlockMarkerId(attribute[1] ?? attribute[2] ?? attribute[3])
            });
        }
    }
    return attributes;
}

/** `text` without its block markers, in any spelling, and the white space in front of each. */
export function stripBlockMarkers(text: string) {
    return text.replace(new RegExp(String.raw`[ \t]*${LENIENT_BLOCK_MARKER}`, "gi"), "");
}

/** `html` without the block markers that no block took, such as one inside raw HTML. */
export function removeBlockMarkers(html: string) {
    return html.replace(new RegExp(LENIENT_BLOCK_MARKER, "gi"), "");
}

/**
 * Finds the first and the last block of `range` in the content of the note under `root`, in
 * document order: the content of an embed of another note is not searched. A block that is not
 * found is `null`.
 */
export function resolveBlockRange<T extends BlockNode>(root: BlockNode, range: BlockRange) {
    let start: T | null = null;
    let end: T | null = null;
    let isEndFirst = false;

    for (const node of walkOwnContent(root)) {
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
 * ancestors. A multicolumn layout left with one column is replaced by the column's content, and an
 * aside that is the only block loses its position, as no text is left to sit beside it.
 * Returns `false` and changes nothing when a block is missing.
 */
export function sliceToBlockReference(root: BlockNode, value: string) {
    const { start, end } = resolveBlockReference(root, value);
    if (!start || !end) {
        return false;
    }

    sliceToBlockRange(root, start, end);
    if (start === end && isTag(start, "ASIDE")) {
        start.removeAttribute?.("data-position");
    }
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

/**
 * Whether `node` is an embed of a note, which the renderers expand: an `.include-note` element
 * with a valid `data-note-id` and no `data-attachment-id`, as `resolveContentEmbed()` reads it.
 * Everything inside it but its own caption belongs to that note.
 */
export function isNoteEmbed(node: BlockNode) {
    const classes = node.getAttribute?.("class")?.split(/\s+/) ?? [];
    const noteId = node.getAttribute?.("data-note-id");
    return classes.includes("include-note") && !node.getAttribute?.("data-attachment-id")
        && !!noteId && ENTITY_ID_PATTERN.test(noteId);
}

/** A part of a page that shows the content of one note: an embed of a note, or the whole page. */
export interface ContentScope<T extends BlockNode = BlockNode> {
    /** The note that the embed shows, `null` for the page. */
    noteId: string | null;
    root: T;
}

/**
 * The scopes that hold `node`, the innermost first, ending with the page at `pageRoot`. An embed
 * of a note holds everything inside it but its own caption, which belongs to the note around it.
 */
export function getContentScopes<T extends BlockNode>(node: T, pageRoot: T): ContentScope<T>[] {
    const scopes: ContentScope<T>[] = [];
    let child: BlockNode = node;
    let current = node.parentNode;
    while (current && current !== pageRoot) {
        if (isNoteEmbed(current) && !isCaptionOf(child, current)) {
            // `isNoteEmbed()` holds only for an element with a valid `data-note-id`.
            const noteId = (current as Required<BlockNode>).getAttribute("data-note-id") as string;
            scopes.push({ noteId, root: current as T });
        }
        child = current;
        current = current.parentNode;
    }
    scopes.push({ noteId: null, root: pageRoot });
    return scopes;
}

/**
 * The nodes under `root` in document order, without the content of an embed of another note: the
 * embed element and its own caption are visited, the rest of it is not. When `root` is itself
 * such an embed, its caption is left out instead.
 */
export function* walkOwnContent(root: BlockNode): Generator<BlockNode> {
    const isEmbedRoot = isNoteEmbed(root);
    const stack = Array.from(root.childNodes)
        .filter((child) => !isEmbedRoot || !isCaptionOf(child, root))
        .reverse();
    while (stack.length) {
        const node = stack.pop() as BlockNode;
        yield node;
        const children = isNoteEmbed(node)
            ? Array.from(node.childNodes).filter((child) => isCaptionOf(child, node))
            : Array.from(node.childNodes);
        for (let index = children.length - 1; index >= 0; index--) {
            stack.push(children[index]);
        }
    }
}

/**
 * The first element whose `id` is `id` in the content of the note under `root`, as
 * {@link walkOwnContent} walks it, or `null`.
 */
export function findOwnElementById<T extends BlockNode>(root: BlockNode, id: string): T | null {
    for (const node of walkOwnContent(root)) {
        if (node.getAttribute?.("id") === id) {
            return node as T;
        }
    }
    return null;
}

/**
 * The number that the item at `index` of the ordered `list` shows, as the browser numbers it. A
 * negative `index` counts on before the first item.
 */
export function getListItemNumber(list: BlockNode, index: number) {
    const isReversed = typeof list.getAttribute?.("reversed") === "string";
    const start = Number.parseInt(list.getAttribute?.("start") ?? "", 10);
    const itemCount = Array.from(list.childNodes).filter((node) => isTag(node, "LI")).length;
    const first = Number.isNaN(start) ? (isReversed ? itemCount : 1) : start;
    return isReversed ? first - index : first + index;
}

const BLOCK_ID_LENGTH = 12;
const BLOCK_ID_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/** A random id almost never needs a second draw; the bound stops a `createId` that repeats. */
const MAX_ID_DRAWS = 16;

/** A block marker in any spelling: other white space, line breaks, an unquoted value. */
const LENIENT_BLOCK_MARKER = String.raw`<a\s+data-trilium-block-id\s*=\s*`
    + String.raw`(?:"[^"]*"|'[^']*'|[^\s"'<>=\x60]+)\s*\/?>(?:\s*<\/a\s*>)?`;

/** A `data-trilium-block-id` attribute inside a tag. Group 1, 2 or 3 holds its value. */
const BLOCK_ID_ATTRIBUTE_VALUE =
    /\sdata-trilium-block-id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>=\x60]+))/gi;

const RUN_CONTAINERS = new Set([
    "ASIDE", "BLOCKQUOTE", "DETAILS", "DIV", "LI", "OL", "SECTION", "UL"
]);

function encodeBlockMarkerId(id: string) {
    let encoded = "";
    for (const character of id) {
        encoded += /^[\w.-]$/.test(character)
            ? character
            : `&#${character.codePointAt(0)};`;
    }
    return encoded;
}

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
        keepListNumbering(node.parentNode, removed.filter((other) => isTag(other, "LI")).length);
        removeNodes(removed);
    }

    for (let node = end; node !== root && node.parentNode; node = node.parentNode) {
        const siblings = Array.from(node.parentNode.childNodes);
        removeNodes(siblings.slice(siblings.indexOf(node) + 1));
    }

    for (const node of new Set([ ...getPath(start, root), ...getPath(end, root) ])) {
        unwrapSingleColumnLayout(node);
    }
}

/** Replaces `node`, when it is a multicolumn layout with one column, by the column's content. */
function unwrapSingleColumnLayout(node: BlockNode) {
    const isLayout = node.getAttribute?.("class")?.split(/\s+/).includes(MULTICOLUMN_LAYOUT_CLASS);
    const columns = Array.from(node.childNodes).filter((child) => child.tagName);
    if (isLayout && columns.length === 1) {
        node.replaceWith?.(...Array.from(columns[0].childNodes));
    }
}

/** Whether `node` is the caption of `embed`, which belongs to the note around the embed. */
function isCaptionOf(node: BlockNode, embed: BlockNode) {
    return node.parentNode === embed && isTag(node, "FIGCAPTION");
}

function removeNodes(nodes: BlockNode[]) {
    for (const node of nodes) {
        node.remove?.();
    }
}

/** Sets the `start` of `list` so that its item at `index` keeps its number once it comes first. */
function keepListNumbering(list: BlockNode, index: number) {
    if (isTag(list, "OL")) {
        list.setAttribute?.("start", String(getListItemNumber(list, index)));
    }
}

function isTag(node: BlockNode, tagName: string) {
    return node.tagName?.toUpperCase() === tagName;
}
