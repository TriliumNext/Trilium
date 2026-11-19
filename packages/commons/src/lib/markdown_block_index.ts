import type { Token, Tokens } from "marked";

import { type BlockKey, collectBlocks } from "./block_keys.js";
import {
    BLOCK_ID_ATTRIBUTE, type BlockNode, findBlockIdAttributes, findBlockMarkers, walkOwnContent
} from "./block_reference.js";
import { runMarkdownPass } from "./markdown_renderer.js";
import { countLineBreaks, walkBlockTokens } from "./markdown_source.js";
import { type BlockMarkerToken, SOURCE_BLOCK_ATTRIBUTE } from "./marked_extensions.js";
import { isAnchor } from "./reference_targets.js";
import { decodeHtmlEntities } from "./utils.js";

/** The sanitizer and the HTML parser of the caller's runtime. */
export interface BlockIndexHost {
    sanitize(html: string): string;
    parse(html: string): BlockNode;
}

/** A block marker in the source. */
export interface SourceMarker {
    /** Offsets in the source. */
    from: number;
    to: number;
    /** The block id, `null` when the marker holds no valid one. */
    id: string | null;
    /** Whether the marker gives its id to a rendered block that owns the id. */
    isEffective: boolean;
}

/** A rendered block of a Markdown source. */
export interface IndexedBlock {
    /** Its identity. */
    key: BlockKey;
    /** 1-indexed source lines, both included. Of raw HTML, the lines of its HTML block. */
    startLine: number;
    endLine: number;
    /** The offsets of the start of its first line and of the end of its last line. */
    from: number;
    to: number;
    /** The id on the rendered element. */
    id?: string;
    /** The marker that gives the block its id. Absent for an attribute of raw HTML. */
    marker?: SourceMarker;
    /** Whether a writer can give the block a marker. `false` for raw HTML. */
    isWritable: boolean;
    /** Whether the block holds other blocks, as a quote does. */
    isContainer: boolean;
    /** The element that holds the id of the block, in the rendered note. */
    node: BlockNode;
    /**
     * The level of a heading as the source writes it, 1 for `#`: a sanitizer can change the tag.
     * Absent for raw HTML.
     */
    depth?: number;
}

/** The blocks of a Markdown source as the renderer produces them. */
export interface MarkdownBlockIndex {
    /** The rendered note, parsed by the host. */
    root: BlockNode;
    /** The rendered blocks, in document order. */
    blocks: IndexedBlock[];
    /** Every marker outside code, in source order. */
    markers: SourceMarker[];
    /** The anchors of the output, `<a id>` without `href`, with the first line of their block. */
    anchors: { name: string; line: number }[];
    /** The owner of `id`: the block that `resolveBlockRange()` finds in the rendered note. */
    resolve(id: string): IndexedBlock | undefined;
    /** The innermost block that covers `line` and holds no other block. */
    blockAt(line: number): IndexedBlock | undefined;
}

/**
 * Indexes the blocks of the Markdown `source`, rendered as the readers of the caller's runtime
 * render it: the production renderer, then the sanitizer and the parser of `host`. Each call
 * renders the note once.
 */
export function indexMarkdownBlocks(source: string, host: BlockIndexHost): MarkdownBlockIndex {
    const pass = runMarkdownPass(source, "", { sanitize: host.sanitize, demoteH1: false }, true);
    const text = new SourceLines(source);
    const restore = (raw: string) => restoreFormulas(raw, pass.formulaSources);
    const lines = measureLines(pass.tokens, restore);
    const scan = scanMarkers(pass.tokens, lines, text, restore);

    const markers = new Map<BlockMarkerToken, SourceMarker>();
    for (const [ marker, span ] of scan.spans) {
        markers.set(marker, {
            from: text.toOriginal(span.from),
            to: text.toOriginal(span.to),
            id: marker.id,
            isEffective: false
        });
    }

    const root = host.parse(pass.html);
    const blocks: IndexedBlock[] = [];
    const blockByNode = new Map<BlockNode, IndexedBlock>();
    const lineOfSerial = (serial: string | null | undefined) => {
        const token = serial ? pass.indexedTokens[Number(serial)] : undefined;
        return token ? lines.get(token) : undefined;
    };
    for (const collected of collectBlocks(root)) {
        const serial = collected.node.getAttribute?.(SOURCE_BLOCK_ATTRIBUTE);
        const token = serial ? pass.indexedTokens[Number(serial)] : undefined;
        const blockLines = lineOfSerial(serial)
            ?? scan.htmlBlocks.find((html) => !!collected.id && html.ids.includes(collected.id));
        if (!blockLines) {
            continue;
        }

        const block: IndexedBlock = {
            key: collected.key,
            startLine: blockLines.start,
            endLine: blockLines.end,
            from: text.toOriginal(text.lineStart(blockLines.start)),
            to: text.toOriginal(text.lineEnd(blockLines.end)),
            id: collected.id,
            marker: token?.blockMarker ? markers.get(token.blockMarker) : undefined,
            isWritable: !!token,
            isContainer: CONTAINER_KINDS.has(collected.key.kind),
            node: collected.node,
            depth: token?.type === "heading" ? (token as Tokens.Heading).depth : undefined
        };
        blocks.push(block);
        blockByNode.set(collected.node, block);
    }

    // The first element with each id, as `resolveBlockRange()` finds it.
    const owners = new Map<string, BlockNode>();
    for (const node of walkOwnContent(root)) {
        const id = node.getAttribute?.(BLOCK_ID_ATTRIBUTE);
        if (id && !owners.has(id)) {
            owners.set(id, node);
        }
    }
    const resolve = (id: string) => {
        const owner = owners.get(id);
        return owner ? blockByNode.get(owner) : undefined;
    };
    for (const block of blocks) {
        if (block.marker && block.id && resolve(block.id) === block) {
            block.marker.isEffective = true;
        }
    }

    const sourceMarkers = [
        ...markers.values(),
        ...scan.rawMarkers.map((span) => ({
            from: text.toOriginal(span.from),
            to: text.toOriginal(span.to),
            id: span.id,
            isEffective: false
        }))
    ].sort((a, b) => a.from - b.from);

    return {
        root,
        blocks,
        markers: sourceMarkers,
        anchors: findAnchors(root, lineOfSerial, scan.htmlBlocks),
        resolve,
        blockAt(line) {
            let match: IndexedBlock | undefined;
            for (const block of blocks) {
                const isCovering = block.startLine <= line && line <= block.endLine;
                if (isCovering && !block.isContainer
                    && (!match || block.startLine >= match.startLine)) {
                    match = block;
                }
            }
            return match;
        }
    };
}

const CONTAINER_KINDS = new Set([ "quote", "admonition", "tabs", "tab" ]);

type Restore = (raw: string) => string;
type LineSpan = { start: number; end: number };
type TextSpan = { from: number; to: number };

/** The lines of a source, with offsets in the text with `\n` line endings and in the original. */
class SourceLines {
    /** The source with `\n` line endings, which marked lexes. */
    readonly text: string;
    readonly #lines: string[];
    readonly #starts: number[] = [];
    readonly #originalStarts: number[] = [ 0 ];

    constructor(original: string) {
        this.text = original.replace(/\r\n?/g, "\n");
        this.#lines = this.text.split("\n");
        let offset = 0;
        for (const line of this.#lines) {
            this.#starts.push(offset);
            offset += line.length + 1;
        }
        for (const match of original.matchAll(/\r\n?|\n/g)) {
            this.#originalStarts.push(match.index + match[0].length);
        }
    }

    /** The text of the 1-indexed `line`. */
    line(line: number): string {
        /* v8 ignore next -- defensive: every block lies within the source */
        return this.#lines[line - 1] ?? "";
    }

    /** The offset of the start of the 1-indexed `line`. */
    lineStart(line: number) {
        return this.#starts[Math.min(line, this.#lines.length) - 1];
    }

    /** The offset of the end of the 1-indexed `line`, before its line ending. */
    lineEnd(line: number) {
        const index = Math.min(line, this.#lines.length) - 1;
        return this.#starts[index] + this.#lines[index].length;
    }

    /** The offset in the original source of `offset`, an offset in {@link text}. */
    toOriginal(offset: number) {
        // The last line that starts at or before `offset`.
        let line = 0;
        let last = this.#starts.length - 1;
        while (line < last) {
            const middle = Math.ceil((line + last) / 2);
            if (this.#starts[middle] <= offset) {
                line = middle;
            } else {
                last = middle - 1;
            }
        }
        return this.#originalStarts[line] + (offset - this.#starts[line]);
    }
}

/** Puts back the source text of the formula placeholders in `raw`. */
function restoreFormulas(raw: string, sources: Map<string, string>) {
    if (!raw.includes("<!--FORMULA_")) {
        return raw;
    }
    let restored = raw;
    for (const [ placeholder, source ] of sources) {
        restored = restored.split(placeholder).join(source);
    }
    return restored;
}

/** The lines of each block token, counted in the source text that `restore` gives back. */
function measureLines(tokens: Token[], restore: Restore) {
    const lines = new Map<object, LineSpan>();
    const getRaw = (token: Token) => restore(token.raw);
    walkBlockTokens(tokens, (token, line) => {
        const raw = getRaw(token).replace(/\n+$/, "");
        lines.set(token, { start: line, end: line + countLineBreaks(raw) });
    }, { getRaw });
    return lines;
}

interface MarkerScan {
    /** The markers that marked tokenized, with their offsets in the text with `\n` endings. */
    spans: Map<BlockMarkerToken, TextSpan>;
    /** Markers inside raw HTML, which mark nothing. */
    rawMarkers: (TextSpan & { id: string | null })[];
    /** The raw HTML blocks, with their lines, text and the block ids of their attributes. */
    htmlBlocks: (LineSpan & { raw: string; ids: string[] })[];
}

/** Finds the markers outside code, and the raw HTML blocks. */
function scanMarkers(
    tokens: Token[],
    lines: Map<object, LineSpan>,
    text: SourceLines,
    restore: Restore
) {
    const scan: MarkerScan = { spans: new Map(), rawMarkers: [], htmlBlocks: [] };
    const addInline = (inline: Token[], startLine: number, findColumn: FindColumn) => {
        const spans = locateInlineMarkers(inline, startLine, findColumn, text, restore);
        for (const [ marker, span ] of spans) {
            scan.spans.set(marker, span);
        }
    };

    walkBlockTokens(tokens, (token) => {
        const span = lines.get(token) as LineSpan;
        switch (token.type) {
            case "paragraph":
            case "text":
                addInline(token.tokens as Token[], span.start, findLineEnd);
                break;
            case "heading":
                addInline(token.tokens as Token[], span.start, findHeadingText);
                break;
            case "table": {
                const { header, rows } = token as Tokens.Table;
                for (const [ index, row ] of [ header, ...rows ].entries()) {
                    // The delimiter row is the second line.
                    const rowLine = span.start + (index === 0 ? 0 : index + 1);
                    let start = 0;
                    for (const cell of row) {
                        const cellStart = start;
                        addInline(cell.tokens, rowLine, (sourceLine, textLine) => {
                            const column = sourceLine.indexOf(textLine, cellStart);
                            start = column < 0 ? start : column + textLine.length;
                            return column;
                        });
                    }
                }
                break;
            }
            case "blockMarkerLine": {
                // A marker line is the only marker on its line.
                const [ found ] = findMarkersInLines(span, text);
                scan.spans.set(token as unknown as BlockMarkerToken, found);
                break;
            }
            case "html": {
                const raw = restore(token.raw);
                const ids = findBlockIdAttributes(raw).flatMap((found) => found.id ?? []);
                scan.htmlBlocks.push({ ...span, raw, ids });
                scan.rawMarkers.push(...findMarkersInLines(span, text));
                break;
            }
            case "tab":
                addInline(token.titleTokens, span.start, findTabTitle);
                break;
        }
    });
    return scan;
}

/** The column of a line of a block's text in its source line, or `-1`. */
type FindColumn = (sourceLine: string, textLine: string, index: number) => number;

/**
 * A line of text ends its source line: a container prefix is cut from the start of a line, and
 * the last item of a list loses the white space at its end.
 */
const findLineEnd: FindColumn = (sourceLine, textLine) => {
    const end = sourceLine.endsWith(textLine)
        ? sourceLine.length
        : sourceLine.replace(/[ \t]+$/, "").length;
    return end - textLine.length;
};

/** The text of an ATX heading starts after its `#` sequence; a setext heading has none. */
const findHeadingText: FindColumn = (sourceLine, textLine, index) => {
    const opening = index === 0 ? /#{1,6}(?:[ \t]+|$)/.exec(sourceLine) : null;
    return sourceLine.indexOf(textLine, opening ? opening.index + opening[0].length : 0);
};

/** The title of a tab is between the quotes of its line. */
const findTabTitle: FindColumn = (sourceLine, textLine) =>
    sourceLine.indexOf(textLine, sourceLine.indexOf("\"") + 1);

/**
 * The offsets of the markers among `inline`, the inline tokens of a block whose text starts on
 * `startLine`. Marked consumes the text token by token, so each token starts where the tokens
 * before it end, and each line of the text is found in its source line. Empty when the source at
 * a span is not the marker: a writer that needs a span then declines.
 */
function locateInlineMarkers(
    inline: Token[],
    startLine: number,
    findColumn: FindColumn,
    text: SourceLines,
    restore: Restore
): Map<BlockMarkerToken, TextSpan> {
    const positions = collectMarkerPositions(inline, null, 0, restore, []);
    if (!positions.length) {
        return new Map();
    }

    const textLines = inline.map((token) => restore(token.raw)).join("").split("\n");
    const lineOffsets: number[] = [];
    const textLineStarts: number[] = [];
    let textOffset = 0;
    for (const [ index, textLine ] of textLines.entries()) {
        const column = findColumn(text.line(startLine + index), textLine, index);
        if (column < 0) {
            return new Map();
        }
        lineOffsets.push(text.lineStart(startLine + index) + column);
        textLineStarts.push(textOffset);
        textOffset += textLine.length + 1;
    }

    const spans = new Map<BlockMarkerToken, TextSpan>();
    for (const { marker, position } of positions) {
        let line = 0;
        while (line + 1 < textLineStarts.length && textLineStarts[line + 1] <= position) {
            line++;
        }
        const from = lineOffsets[line] + position - textLineStarts[line];
        /* v8 ignore next 3 -- defensive: the text of a block is its source, line for line */
        if (text.text.slice(from, from + marker.raw.length) !== marker.raw) {
            return new Map();
        }
        spans.set(marker, { from, to: from + marker.raw.length });
    }
    return spans;
}

/**
 * Collects the positions of the markers among `tokens` in the text of their block. A nested token
 * is found in the text of its parent, after its earlier siblings.
 */
function collectMarkerPositions(
    tokens: Token[],
    parentRaw: string | null,
    base: number,
    restore: Restore,
    positions: { marker: BlockMarkerToken; position: number }[]
) {
    let cursor = 0;
    for (const token of tokens as Tokens.Generic[]) {
        const raw = restore(token.raw);
        const position = parentRaw === null ? cursor : parentRaw.indexOf(raw, cursor);
        /* v8 ignore next 3 -- defensive: marked lexes a token's children from its own text */
        if (position < 0) {
            continue;
        }
        cursor = position + raw.length;
        if (token.type === "blockMarker") {
            positions.push({ marker: token as BlockMarkerToken, position: base + position });
        } else if (Array.isArray(token.tokens)) {
            collectMarkerPositions(token.tokens, raw, base + position, restore, positions);
        }
    }
    return positions;
}

/** The markers on the source lines of `span`, which marked took as raw text. */
function findMarkersInLines(span: LineSpan, text: SourceLines) {
    const found: (TextSpan & { id: string | null })[] = [];
    for (let line = span.start; line <= span.end; line++) {
        for (const marker of findBlockMarkers(text.line(line))) {
            const lineStart = text.lineStart(line);
            found.push({ from: lineStart + marker.from, to: lineStart + marker.to, id: marker.id });
        }
    }
    return found;
}

/** The bookmarks of the output, with the first line of the block that holds each. */
function findAnchors(
    root: BlockNode,
    lineOfSerial: (serial: string | null | undefined) => LineSpan | undefined,
    htmlBlocks: MarkerScan["htmlBlocks"]
) {
    const anchors: { name: string; line: number }[] = [];
    for (const node of walkOwnContent(root)) {
        const name = node.getAttribute?.("id");
        if (!name || !isAnchor(node)) {
            continue;
        }

        let span: LineSpan | undefined;
        for (let current = node.parentNode; current && !span; current = current.parentNode) {
            span = lineOfSerial(current.getAttribute?.(SOURCE_BLOCK_ATTRIBUTE));
        }
        span ??= htmlBlocks.find((html) => decodeHtmlEntities(html.raw).includes(name));
        /* v8 ignore next -- defensive: an anchor outside Markdown blocks is in raw HTML */
        anchors.push({ name, line: span?.start ?? 1 });
    }
    return anchors;
}
