import {
    isInsideCombinedSymbol, isInsideSurrogatePair, type Model, type ModelElement, type ModelNode,
    type ModelPosition
} from "ckeditor5";

import { OPEN_ATTRIBUTE } from "../collapsible/constants.js";

/**
 * The character that stands for an inline object in a line, and for the object of a widget line.
 */
export const OBJECT_CHARACTER = "\u{FFFC}";

/** A line of text: a block, or a part of a block between soft breaks. */
export interface TextLine {
    readonly kind: "text";
    readonly block: ModelElement;
    /** The offsets of the line in `block`. The soft breaks around it are not part of it. */
    start: number;
    end: number;
}

/** A line that a widget fills, such as an image or a horizontal line. */
export interface ObjectLine {
    readonly kind: "object";
    readonly element: ModelElement;
}

export type VimLine = TextLine | ObjectLine;

/** A place in the lines: a line number and a column, as the Vim engine counts them. */
export interface LinePosition {
    line: number;
    ch: number;
}

/** The lines from `first` to `last`. */
export interface LineSpan {
    first: number;
    last: number;
}

/** What shows of the note. The lines of a `LineIndex` leave out what does not. */
export interface LineVisibility {
    /** Whether `node`, a block, is hidden, as the section of a collapsed heading is. */
    isHidden(node: ModelNode): boolean;
    /** Whether the body of `details`, a collapsible block, shows. */
    isOpen(details: ModelElement): boolean;
}

/** The visibility of the whole note, for an index of all its lines. */
export const EVERYTHING_SHOWN: LineVisibility = {
    isHidden: () => false,
    isOpen: () => true
};

/** The visibility of a note without collapsed headings or list items. */
export const DEFAULT_VISIBILITY: LineVisibility = {
    isHidden: () => false,
    isOpen: (details) => !!details.getAttribute(OPEN_ATTRIBUTE)
};

/**
 * The note as the Vim engine sees it: a list of lines. A block that holds text is one line, or one
 * line per part between soft breaks. A widget is a line of one character. Containers, such as
 * lists, quotes, tables and columns, add the lines of their blocks in document order. Hidden
 * blocks and the body of a closed collapsible block add no lines.
 */
export class LineIndex {

    readonly lines: VimLine[] = [];
    /** The first line of each indexed block and widget. */
    private readonly firstLines = new Map<ModelElement, number>();
    private readonly texts: (string | undefined)[] = [];
    /** The index of the first character of each line, counting one character per line break. */
    private offsets: number[] | null = null;
    private readonly containerObjects = new Map<string, boolean>();

    constructor(
        private readonly model: Model,
        private readonly visibility: LineVisibility = DEFAULT_VISIBILITY
    ) {
        this.collect(model.document.getRoot() as ModelElement);
    }

    get lastLine() {
        return Math.max(this.lines.length - 1, 0);
    }

    /** The text of line `line`, or an empty string past the last line. */
    getText(line: number): string {
        const entry = this.lines[line];
        if (!entry) {
            return "";
        }
        let text = this.texts[line];
        if (text === undefined) {
            text = entry.kind === "object" ? OBJECT_CHARACTER : getTextOf(entry);
            this.texts[line] = text;
        }
        return text;
    }

    /** Whether `element`, a block or a widget, has lines in the index. */
    has(element: ModelElement) {
        return this.firstLines.has(element);
    }

    /** The first line of `element`, a block or a widget, or `undefined` when it has none. */
    getFirstLine(element: ModelElement): number | undefined {
        return this.firstLines.get(element);
    }

    /** The last line of `element`, a block or a widget, or `undefined` when it has none. */
    getLastLine(element: ModelElement): number | undefined {
        const first = this.firstLines.get(element);
        if (first === undefined) {
            return undefined;
        }
        let last = first;
        while (this.getElement(last + 1) === element) {
            last++;
        }
        return last;
    }

    /** The block or the widget of line `line`. */
    getElement(line: number): ModelElement | undefined {
        const entry = this.lines[line];
        return entry?.kind === "text" ? entry.block : entry?.element;
    }

    /** The lines from `first` to `last` that `element` holds, in a block split by soft breaks. */
    getLinesOf(element: ModelElement): number[] {
        const first = this.firstLines.get(element);
        const lines: number[] = [];
        for (let line = first ?? -1; line >= 0 && this.getElement(line) === element; line++) {
            lines.push(line);
        }
        return lines;
    }

    /**
     * The model position of column `ch` of line `line`, clamped to the content. A line past the
     * last one is the end of the last line, and a line before the first one is its start.
     */
    positionAt(line: number, ch: number): ModelPosition {
        const model = this.model;
        const isPastEnd = line > this.lastLine;
        const entry = this.lines[Math.min(Math.max(line, 0), this.lastLine)];
        if (!entry) {
            return model.createPositionAt(model.document.getRoot() as ModelElement, 0);
        }
        if (isPastEnd || line < 0) {
            ch = isPastEnd ? Number.MAX_SAFE_INTEGER : 0;
        }
        if (entry.kind === "object") {
            return ch > 0
                ? model.createPositionAfter(entry.element)
                : model.createPositionBefore(entry.element);
        }
        const offset = entry.start + Math.min(Math.max(ch, 0), entry.end - entry.start);
        return model.createPositionAt(entry.block, offset);
    }

    /** The line and the column of `position`, or of the closest place in the lines. */
    locate(position: ModelPosition): LinePosition {
        const ancestors = position.getAncestors().reverse() as ModelElement[];
        for (const [ index, element ] of ancestors.entries()) {
            const first = this.firstLines.get(element);
            if (first === undefined) {
                continue;
            }
            if (this.lines[first].kind === "object") {
                return { line: first, ch: 0 };
            }
            const offset = index ? ancestors[index - 1].startOffset as number : position.offset;
            return this.locateInBlock(first, offset);
        }

        // The end of a widget line is the place right after the widget, unless another widget
        // starts there.
        const afterLine = this.firstLines.get(position.nodeAfter as ModelElement);
        const beforeLine = this.getLastLine(position.nodeBefore as ModelElement);
        const isAfterWidget = beforeLine !== undefined && this.lines[beforeLine].kind === "object";
        if (isAfterWidget && (afterLine === undefined || this.lines[afterLine].kind === "text")) {
            return { line: beforeLine, ch: 1 };
        }
        if (afterLine !== undefined) {
            return { line: afterLine, ch: 0 };
        }
        if (beforeLine !== undefined) {
            return { line: beforeLine, ch: this.getText(beforeLine).length };
        }
        return this.locateNearest(position);
    }

    /** The index of `position` in the text of all lines, with one character per line break. */
    indexOf({ line, ch }: LinePosition): number {
        const offsets = this.getOffsets();
        if (line < 0) {
            return 0;
        }
        if (line > this.lastLine) {
            return offsets[offsets.length - 1] + this.getText(this.lastLine).length;
        }
        return offsets[line] + Math.min(Math.max(ch, 0), this.getText(line).length);
    }

    /** The line and the column of index `index` in the text of all lines. */
    positionOfIndex(index: number): LinePosition {
        const offsets = this.getOffsets();
        let low = 0;
        let high = offsets.length - 1;
        while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            if (offsets[middle] <= index) {
                low = middle;
            } else {
                high = middle - 1;
            }
        }
        const ch = Math.min(Math.max(index - offsets[low], 0), this.getText(low).length);
        return { line: low, ch };
    }

    /**
     * Reads `block` again after a change of its text only. Returns `false` when its lines changed
     * in number, as when a soft break came or went.
     */
    refreshBlock(block: ModelElement): boolean {
        const first = this.firstLines.get(block);
        if (first === undefined) {
            return true;
        }
        const segments = getSegments(block);
        const lines = this.getLinesOf(block);
        if (segments.length !== lines.length) {
            return false;
        }
        for (const [ index, line ] of lines.entries()) {
            const entry = this.lines[line] as TextLine;
            entry.start = segments[index].start;
            entry.end = segments[index].end;
            this.texts[line] = undefined;
        }
        this.offsets = null;
        return true;
    }

    private locateInBlock(first: number, offset: number): LinePosition {
        let line = first;
        while (true) {
            const entry = this.lines[line] as TextLine;
            const next = this.lines[line + 1];
            const isLastOfBlock = next?.kind !== "text" || next.block !== entry.block;
            if (offset <= entry.end || isLastOfBlock) {
                const ch = Math.min(Math.max(offset - entry.start, 0), entry.end - entry.start);
                return { line, ch };
            }
            line++;
        }
    }

    /** The first line that starts at or after `position`, or the number of lines when none does. */
    firstLineFrom(position: ModelPosition): number {
        let low = 0;
        let high = this.lines.length;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (this.positionAt(middle, 0).isBefore(position)) {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        return low;
    }

    /** The lines inside `element`, from its first to its last, or `null` when none shows. */
    getSpan(element: ModelElement): { first: number; last: number } | null {
        const model = this.model;
        const first = this.firstLineFrom(model.createPositionBefore(element));
        const last = this.firstLineFrom(model.createPositionAfter(element)) - 1;
        return first <= last ? { first, last } : null;
    }

    /** The first line at or after `position`, or the end of the last line. */
    private locateNearest(position: ModelPosition): LinePosition {
        const line = this.firstLineFrom(position);
        if (line >= this.lines.length) {
            const last = this.lastLine;
            return { line: last, ch: this.getText(last).length };
        }
        return { line, ch: 0 };
    }

    private getOffsets(): number[] {
        if (!this.offsets) {
            const offsets: number[] = [];
            let total = 0;
            for (let line = 0; line < Math.max(this.lines.length, 1); line++) {
                offsets.push(total);
                total += this.getText(line).length + 1;
            }
            this.offsets = offsets;
        }
        return this.offsets;
    }

    private collect(parent: ModelElement, isTitleOnly = false) {
        const schema = this.model.schema;
        for (const child of parent.getChildren()) {
            if (!child.is("element") || schema.isInline(child) || this.visibility.isHidden(child)) {
                continue;
            }
            if (isTitleOnly && !child.is("element", "summary")) {
                continue;
            }
            if (schema.checkChild(child, "$text")) {
                this.firstLines.set(child, this.lines.length);
                for (const segment of getSegments(child)) {
                    this.lines.push({ kind: "text", block: child, ...segment });
                }
            } else if (schema.isObject(child) && !this.isContainerObject(child)) {
                this.firstLines.set(child, this.lines.length);
                this.lines.push({ kind: "object", element: child });
            } else {
                // A closed collapsible block shows its title only.
                const isClosed = child.is("element", "details") && !this.visibility.isOpen(child);
                this.collect(child, isClosed);
            }
        }
    }

    /**
     * Whether `element`, an object, holds blocks that are written in, as a table, a tabs block or
     * a multicolumn layout does. An image with its caption is a widget.
     */
    private isContainerObject(element: ModelElement): boolean {
        const name = element.name;
        let isContainer = this.containerObjects.get(name);
        if (isContainer === undefined) {
            const schema = this.model.schema;
            isContainer = false;
            for (const item of this.model.createRangeIn(element).getItems()) {
                if (item.is("element") && schema.checkChild(item, "paragraph")) {
                    isContainer = true;
                    break;
                }
            }
            if (isContainer || element.childCount > 0) {
                this.containerObjects.set(name, isContainer);
            }
        }
        return isContainer;
    }
}

/**
 * Column `ch` of `text`, or the edge of the character that it falls inside, as between the halves
 * of an emoji or before a combining accent: its start, or with `isForward`, its end.
 */
export function toCharacterEdge(text: string, ch: number, isForward: boolean): number {
    let edge = ch;
    while (edge > 0 && edge < text.length
        && (isInsideSurrogatePair(text, edge) || isInsideCombinedSymbol(text, edge))) {
        edge += isForward ? 1 : -1;
    }
    return edge;
}

/** The offsets of the parts of `block` between its soft breaks. */
function getSegments(block: ModelElement): { start: number; end: number }[] {
    const segments: { start: number; end: number }[] = [];
    let start = 0;
    for (const child of block.getChildren()) {
        if (child.is("element", "softBreak")) {
            segments.push({ start, end: child.startOffset as number });
            start = (child.startOffset as number) + 1;
        }
    }
    segments.push({ start, end: block.maxOffset });
    return segments;
}

/** The text of `line`, with one `OBJECT_CHARACTER` for each inline object. */
function getTextOf(line: TextLine): string {
    let text = "";
    for (const child of line.block.getChildren()) {
        const start = child.startOffset as number;
        const end = start + child.offsetSize;
        if (end <= line.start || start >= line.end) {
            continue;
        }
        if (child.is("$text")) {
            text += child.data.slice(Math.max(line.start - start, 0), line.end - start);
        } else {
            text += OBJECT_CHARACTER;
        }
    }
    return text;
}
