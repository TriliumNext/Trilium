import { isSameBlockKey, isSameBlockShape } from "./block_keys.js";
import {
    BLOCK_ID_ATTRIBUTE, type BlockNode, drawBlockId, formatBlockMarker, isValidBlockId
} from "./block_reference.js";
import {
    type BlockIndexHost, type IndexedBlock, indexMarkdownBlocks, type MarkdownBlockIndex
} from "./markdown_block_index.js";
import { CONTAINER_PREFIX_SOURCE, countLineBreaks } from "./markdown_source.js";
import {
    findRequestedHeading, getHeadingLevel, getHeadingText, type HeadingRequest, type HeadingTarget,
    toReferenceTargets
} from "./reference_targets.js";
import type { ReferenceParams, ReferenceTarget } from "./server_api.js";

/** An edit of a source: the text from `from` to `to` replaced by `insert`. */
export interface SourceChange {
    from: number;
    to: number;
    insert: string;
}

/** The id of a block, and the edit that writes its marker. */
export interface PlacedMarker {
    id: string;
    /** The edit to apply. Absent when the block has an id that resolves to it. */
    change?: SourceChange;
}

/**
 * Where the id of a new marker comes from: drawn, for a new reference, or given, for an id that
 * another writer placed.
 */
export type NewBlockId = { kind: "draw"; createId: () => string } | { kind: "given"; id: string };

/** A heading of a Markdown note that a link can point at, and the block that renders it. */
export interface MarkdownHeading extends HeadingTarget {
    block: IndexedBlock;
}

/**
 * The edit that gives `block` of `index`, the index of `source`, an id that resolves to it, or the
 * id that the block has. The edit is kept only if the renderer gives the new id to that block and
 * leaves every other block as it was. `null` when the block cannot take an id.
 */
export function placeMarkerOnBlock(
    source: string,
    index: MarkdownBlockIndex,
    block: IndexedBlock,
    newId: NewBlockId,
    host: BlockIndexHost
): PlacedMarker | null {
    if (block.id !== undefined && index.resolve(block.id) === block) {
        return newId.kind === "given" && newId.id !== block.id ? null : { id: block.id };
    }
    if (!block.isWritable) {
        return null;
    }
    const id = pickId(source, index, newId);
    if (id === null) {
        return null;
    }

    const marker = formatBlockMarker(id);
    // A block whose id an earlier block owns gets its marker replaced: a second marker loses to
    // the first.
    let changes: SourceChange[] = [];
    if (block.id === undefined) {
        changes = getPlacements(source, block, marker);
    } else if (block.marker) {
        changes = [ { from: block.marker.from, to: block.marker.to, insert: marker } ];
    }
    const change = changes.find((candidate) =>
        isPlacementKept(source, index, block, id, candidate, host));
    return change ? { id, change } : null;
}

/** `source` with `change` applied. */
export function applySourceChange(source: string, change: SourceChange | undefined) {
    return change
        ? source.slice(0, change.from) + change.insert + source.slice(change.to)
        : source;
}

/** The headings that have text and can be linked to, in document order. */
export function findMarkdownHeadings(index: MarkdownBlockIndex): MarkdownHeading[] {
    const headings: MarkdownHeading[] = [];
    for (const block of index.blocks) {
        if (block.key.kind !== "heading") {
            continue;
        }
        const id = block.id !== undefined && index.resolve(block.id) === block
            ? block.id
            : undefined;
        const title = getHeadingText(block.node);
        if (title && (id !== undefined || block.isWritable)) {
            const level = block.depth ?? getHeadingLevel(block.node);
            headings.push({ block, title, level, id });
        }
    }
    return headings;
}

/** The headings that have text, in document order, then the anchors, by name. */
export function findMarkdownTargets(source: string, host: BlockIndexHost): ReferenceTarget[] {
    const index = indexMarkdownBlocks(source, host);
    return toReferenceTargets(
        findMarkdownHeadings(index), index.anchors.map((anchor) => anchor.name)
    );
}

/**
 * `source` with an id on the heading that `request` names, and the link parameters of the
 * heading. By `request.line`, that heading is the only one whose block starts on that line, while
 * its text is `request.title`. By `request.index`, it is the one at that index while its text is
 * `request.title`, else the only heading with that text. The source comes back unchanged when the
 * heading owns an id, and `null` when no heading matches or the heading cannot take an id.
 */
export function addMarkdownHeadingReference(
    source: string,
    request: HeadingRequest,
    createId: () => string,
    host: BlockIndexHost
): { content: string; params: ReferenceParams } | null {
    const index = indexMarkdownBlocks(source, host);
    const headings = findMarkdownHeadings(index);
    const heading = request.line === undefined
        ? findRequestedHeading(headings, request)
        : findHeadingOnLine(headings, request.line, request.title);
    const placed = heading
        ? placeMarkerOnBlock(source, index, heading.block, { kind: "draw", createId }, host)
        : null;
    return placed
        ? { content: applySourceChange(source, placed.change), params: { block: placed.id } }
        : null;
}

/** An id that another writer gave a block, replayed on the version before. */
export interface ReplayedBlockId {
    id: string;
    /** The block of that version that the id went to. */
    block: IndexedBlock;
}

/**
 * The ids that `current` has and `base` lacks, each on the block of `base` with the key of its
 * owner in `current`, the edits that write their markers on `base`, and the index of `base`.
 * `null` unless `base` with those edits is `current`, byte for byte: only then were the ids all
 * that changed.
 */
export function replayBlockIds(
    base: string,
    current: string,
    host: BlockIndexHost
): { replayed: ReplayedBlockId[]; changes: SourceChange[]; index: MarkdownBlockIndex } | null {
    const baseIndex = indexMarkdownBlocks(base, host);
    const currentIndex = indexMarkdownBlocks(current, host);
    const baseIds = new Set(baseIndex.blocks.flatMap((block) => block.id ?? []));
    const replayed: ReplayedBlockId[] = [];
    const changes: SourceChange[] = [];
    for (const owner of currentIndex.blocks) {
        const { id } = owner;
        if (id === undefined || baseIds.has(id) || currentIndex.resolve(id) !== owner) {
            continue;
        }
        const block = baseIndex.blocks.find((candidate) =>
            isSameBlockKey(candidate.key, owner.key));
        const placed = block
            ? placeMarkerOnBlock(base, baseIndex, block, { kind: "given", id }, host)
            : null;
        if (!block || !placed?.change) {
            return null;
        }
        replayed.push({ id, block });
        changes.push(placed.change);
    }

    if (!replayed.length) {
        return null;
    }
    const sorted = [ ...changes ].sort((a, b) => a.from - b.from);
    let replayedSource = base;
    for (let index = sorted.length - 1; index >= 0; index--) {
        replayedSource = applySourceChange(replayedSource, sorted[index]);
    }
    return replayedSource === current ? { replayed, changes: sorted, index: baseIndex } : null;
}

/**
 * The edit that puts `html`, the raw HTML of one element, on a line of its own after the block on
 * `line` of `source`, or after the last block above a line without one, inside the containers of
 * that block. A blank line comes before and after it: an HTML block runs to the next blank line.
 * `null` when the result does not render the element as a block of its own, or changes a block.
 */
export function insertHtmlBlock(
    source: string,
    line: number,
    html: string,
    host: BlockIndexHost
): SourceChange | null {
    const index = indexMarkdownBlocks(source, host);
    const leaves = index.blocks.filter((block) => !block.isContainer && block.startLine <= line);
    const block = index.blockAt(line) ?? leaves.at(-1);
    const lineEnding = /\r\n?|\n/.exec(source)?.[0] ?? "\n";

    let change: SourceChange;
    if (block) {
        const prefix = getContinuationPrefix(getLine(source, block.from).text);
        const blank = prefix.trimEnd();
        const nextLine = getLineAfter(source, block.to);
        const blankAfter = nextLine && !isBlankLine(nextLine.text) ? `${lineEnding}${blank}` : "";
        change = {
            from: block.to,
            to: block.to,
            insert: `${lineEnding}${blank}${lineEnding}${prefix}${html}${blankAfter}`
        };
    } else {
        // The element goes on the first line, so text on that line or right below it needs a
        // blank line between them.
        const firstLine = getLine(source, 0);
        const nextLine = getLineAfter(source, firstLine.text.length);
        let blankAfter = "";
        if (!isBlankLine(firstLine.text)) {
            blankAfter = `${lineEnding}${lineEnding}`;
        } else if (nextLine && !isBlankLine(nextLine.text)) {
            blankAfter = lineEnding;
        }
        change = { from: 0, to: 0, insert: `${html}${blankAfter}` };
    }

    const after = indexMarkdownBlocks(applySourceChange(source, change), host);
    const tag = Array.from(host.parse(html).childNodes).find((node) => node.tagName)?.tagName;
    const isKept = after.blocks.length === index.blocks.length
        && index.blocks.every(({ key, id }, blockIndex) => {
            const other = after.blocks[blockIndex];
            return isSameBlockShape(key, other.key) && id === other.id;
        });
    return isKept && tag
        && countElementsOutsideParagraphs(after.root, tag)
            === countElementsOutsideParagraphs(index.root, tag) + 1
        ? change
        : null;
}

const CONTAINER_PREFIX = new RegExp(`^${CONTAINER_PREFIX_SOURCE}`);
const LIST_MARKER = /[-*+]|\d{1,9}[.)]/g;
const FENCE = /`{3,}|~{3,}/;
const RULE = /([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const ATX_CLOSING_SEQUENCE = /[ \t]+#+[ \t]*$/;

interface SourceLine {
    /** The offset of the line in the source. */
    start: number;
    /** The line without its line ending. */
    text: string;
}

/** The only heading of `headings` whose block starts on `line`, if its title is `title`. */
function findHeadingOnLine(headings: MarkdownHeading[], line: number, title: string) {
    const onLine = headings.filter((heading) => heading.block.startLine === line);
    return onLine.length === 1 && onLine[0].title === title ? onLine[0] : null;
}

function pickId(source: string, index: MarkdownBlockIndex, newId: NewBlockId) {
    if (newId.kind === "given") {
        return isValidBlockId(newId.id) && !isIdInUse(index, newId.id) ? newId.id : null;
    }
    return drawBlockId(source, newId.createId);
}

/** Whether a marker or an element of the rendered note holds `id`. */
function isIdInUse(index: MarkdownBlockIndex, id: string) {
    if (index.markers.some((marker) => marker.id === id)) {
        return true;
    }
    const stack = [ index.root ];
    for (let node = stack.pop(); node; node = stack.pop()) {
        if (node.getAttribute?.(BLOCK_ID_ATTRIBUTE) === id) {
            return true;
        }
        for (const child of Array.from(node.childNodes)) {
            stack.push(child);
        }
    }
    return false;
}

/**
 * The edits that write `marker` for `block`, in the order to try them. Each follows the placement
 * that the exporter uses for that kind of block.
 */
function getPlacements(source: string, block: IndexedBlock, marker: string): SourceChange[] {
    const first = getLine(source, block.from);
    const last = getLine(source, block.to);
    const lineEnding = /\r\n?|\n/.exec(source)?.[0] ?? "\n";
    const markerLineAbove = (column: number) =>
        insertMarkerLine(first, column, marker, lineEnding);

    switch (block.key.kind) {
        case "paragraph":
        case "item":
            return [ insertAtLineEnd(last, marker) ];
        case "heading":
            // An ATX heading is one line. A setext heading ends with its underline.
            return [ block.startLine === block.endLine
                ? insertBeforeClosingSequence(first, marker)
                : insertAtLineEnd(getLine(source, getPreviousLineEnd(source, last.start)),
                    marker) ];
        case "table":
            return [
                insertInFirstCell(first, marker), markerLineAbove(getPrefixLength(first.text))
            ];
        case "code": {
            const fence = FENCE.exec(first.text);
            // Indented code starts four spaces after its container's prefix.
            return [ markerLineAbove(fence
                ? fence.index
                : Math.max(0, getPrefixLength(first.text) - 4)) ];
        }
        case "rule":
            return [ markerLineAbove(Math.max(first.text.search(RULE), 0)) ];
        case "formula": {
            // In front of the formula, the line is a paragraph that holds it, not raw HTML.
            const position = first.start + getPrefixLength(first.text);
            return [ { from: position, to: position, insert: marker } ];
        }
        default:
            return [];
    }
}

function insertAtLineEnd(line: SourceLine, marker: string): SourceChange {
    const position = line.start + line.text.length;
    const separator = /[ \t]$/.test(line.text) ? "" : " ";
    return { from: position, to: position, insert: `${separator}${marker}` };
}

/** After the text of an ATX heading: after a closing sequence, the `#` would show as text. */
function insertBeforeClosingSequence(line: SourceLine, marker: string): SourceChange {
    const text = line.text.replace(ATX_CLOSING_SEQUENCE, "").replace(/[ \t]+$/, "");
    const position = line.start + text.length;
    return { from: position, to: position, insert: ` ${marker}` };
}

/** At the end of the first cell of the header row: after the row's last pipe, marked drops it. */
function insertInFirstCell(line: SourceLine, marker: string): SourceChange {
    let start = getPrefixLength(line.text);
    if (line.text[start] === "|") {
        start++;
    }
    let end = start;
    while (end < line.text.length && line.text[end] !== "|") {
        end += line.text[end] === "\\" ? 2 : 1;
    }
    const cell = line.text.slice(start, end).replace(/[ \t]+$/, "");
    const position = line.start + start + cell.length;
    return { from: position, to: position, insert: ` ${marker}` };
}

/**
 * A marker line above the content that starts at `column` of `line`, then a blank line, both with
 * the prefix of the content's container: directly above `---`, a marker line would be a setext
 * heading in other renderers.
 */
function insertMarkerLine(
    line: SourceLine,
    column: number,
    marker: string,
    lineEnding: string
): SourceChange {
    const prefix = toContinuationPrefix(line.text.slice(0, column));
    const position = line.start + column;
    return {
        from: position,
        to: position,
        insert: `${marker}${lineEnding}${prefix.trimEnd()}${lineEnding}${prefix}`
    };
}

/**
 * Whether the renderer gives `id` to `target` once `change` is applied, on the line that the
 * change moves it to, and leaves the key and the id of every other block as they were.
 */
function isPlacementKept(
    source: string,
    index: MarkdownBlockIndex,
    target: IndexedBlock,
    id: string,
    change: SourceChange,
    host: BlockIndexHost
) {
    const after = indexMarkdownBlocks(applySourceChange(source, change), host);
    const owner = after.resolve(id);
    const position = index.blocks.indexOf(target);
    const shift = countLineBreaks(change.insert)
        - countLineBreaks(source.slice(change.from, change.to));
    if (!owner || after.blocks.length !== index.blocks.length
        || after.blocks.indexOf(owner) !== position || !isSameBlockKey(owner.key, target.key)
        || owner.startLine !== target.startLine + shift) {
        return false;
    }

    const isRestKept = index.blocks.every((block, blockIndex) => {
        const other = after.blocks[blockIndex];
        return block === target || (isSameBlockKey(block.key, other.key) && block.id === other.id);
    });
    // The id that the target lost still belongs to the block that owned it.
    return isRestKept && (target.id === undefined
        || getOwnerPosition(index, target.id) === getOwnerPosition(after, target.id));
}

function getOwnerPosition(index: MarkdownBlockIndex, id: string) {
    const owner = index.resolve(id);
    return owner ? index.blocks.indexOf(owner) : -1;
}

/** The line of `source` that holds `offset`. */
function getLine(source: string, offset: number): SourceLine {
    let start = offset;
    while (start > 0 && source[start - 1] !== "\n" && source[start - 1] !== "\r") {
        start--;
    }
    let end = offset;
    while (end < source.length && source[end] !== "\n" && source[end] !== "\r") {
        end++;
    }
    return { start, text: source.slice(start, end) };
}

/** The line after the line break at `offset`, or `null` when `offset` is the end of `source`. */
function getLineAfter(source: string, offset: number) {
    return offset < source.length
        ? getLine(source, offset + (source.startsWith("\r\n", offset) ? 2 : 1))
        : null;
}

/** The offset of the end of the line before the one that starts at `lineStart`. */
function getPreviousLineEnd(source: string, lineStart: number) {
    return source.startsWith("\r\n", lineStart - 2) ? lineStart - 2 : lineStart - 1;
}

function getPrefixLength(line: string) {
    return (CONTAINER_PREFIX.exec(line) as RegExpExecArray)[0].length;
}

/** The prefix of the lines that continue the containers of `line`: list markers become spaces. */
function getContinuationPrefix(line: string) {
    return toContinuationPrefix(line.slice(0, getPrefixLength(line)));
}

function toContinuationPrefix(prefix: string) {
    return prefix.replace(LIST_MARKER, (listMarker) => " ".repeat(listMarker.length));
}

/** Whether `line` holds nothing but white space and quote markers. */
function isBlankLine(line: string) {
    return /^[\s>]*$/.test(line);
}

/** The elements of the tag `tag` under `root` that are not inside a paragraph. */
function countElementsOutsideParagraphs(root: BlockNode, tag: string) {
    let count = 0;
    const stack = [ root ];
    for (let node = stack.pop(); node; node = stack.pop()) {
        if (node.tagName?.toUpperCase() === tag.toUpperCase()
            && node.parentNode?.tagName?.toUpperCase() !== "P") {
            count++;
        }
        for (const child of Array.from(node.childNodes)) {
            stack.push(child);
        }
    }
    return count;
}
