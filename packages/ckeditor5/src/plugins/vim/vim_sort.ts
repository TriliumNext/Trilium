import {
    _getAllListItemBlocks as getAllListItemBlocks, type Model, type ModelElement, type ModelWriter
} from "ckeditor5";

import { blockText } from "../sort_selection/sort_runs.js";
import type VimAdapter from "./vim_adapter.js";
import type { LineIndex, LineSpan, TextLine } from "./vim_lines.js";
import StringStream from "./vim_string_stream.js";

/** How `:sort` compares lines, from its arguments. */
export interface SortOptions {
    isReverse: boolean;
    isIgnoringCase: boolean;
    isUnique: boolean;
    radix: 10 | 16 | 8 | null;
    pattern: RegExp | null;
    /** Whether the pattern match itself is the key, rather than the text after it. */
    isMatchKey: boolean;
}

/** Blocks that move together, and the text they sort by. */
export interface SortUnit {
    blocks: ModelElement[];
    text: string;
}

/** A sort unit with what it sorts by: a number, a text, or `null` to keep its place. */
interface KeyedUnit {
    unit: SortUnit;
    key: string | number | null;
}

/**
 * Sorts the lines from `line` to `lineEnd` as Vim's `:sort` does, keeping their formatting:
 * paragraphs move whole, list items move with their paragraphs and nested items, and the lines of
 * a code block are sorted as text. Without a range, the list at the level of the cursor or the
 * paragraphs around it are sorted.
 */
export function sortLines(cm: VimAdapter, line: number | undefined, lineEnd: number | undefined,
    argString = "") {
    const t = cm.editor.t;
    const options = parseSortOptions(argString);
    if (!options) {
        cm.host.notify(t("Invalid arguments of :sort"));
        return;
    }
    const index = cm.index();
    const range = line === undefined
        ? getDefaultRange(index, cm.getCursor().line)
        : { first: Math.min(line, lineEnd ?? line), last: Math.max(line, lineEnd ?? line) };
    const firstEntry = index.lines[range.first];
    if (!firstEntry || range.first === range.last) {
        return;
    }

    const codeBlock = firstEntry.kind === "text" && firstEntry.block.is("element", "codeBlock")
        ? firstEntry.block
        : null;
    if (codeBlock && index.getElement(range.last) === codeBlock) {
        sortCodeLines(cm, range.first, range.last, options);
        return;
    }
    const units = getUnits(cm.editor.model, index, range.first, range.last);
    if (!units) {
        cm.host.notify(t("Only whole paragraphs of one kind or whole list items can be sorted"));
        return;
    }
    const sorted = sortUnits(units, options);
    cm.editor.model.change((writer) => applyOrder(writer, units, sorted));
    cm.setCursor(range.first, 0);
}

/**
 * The lines that `:sort` without a range sorts: the items of the list at the level of the cursor,
 * the lines of a code block, or the paragraphs around the cursor up to a block of another kind or
 * an empty paragraph.
 */
function getDefaultRange(index: LineIndex, line: number) {
    const element = index.getElement(line) as ModelElement;
    let first: ModelElement = element;
    let last: ModelElement = element;
    if (element.hasAttribute("listItemId")) {
        const indent = getIndent(element);
        while (isListBlock(first.previousSibling) && getIndent(first.previousSibling) >= indent) {
            first = first.previousSibling;
        }
        while (isListBlock(last.nextSibling) && getIndent(last.nextSibling) >= indent) {
            last = last.nextSibling;
        }
    } else if (!element.is("element", "codeBlock")) {
        while (isSortableNeighbor(first.previousSibling, element)) {
            first = first.previousSibling;
        }
        while (isSortableNeighbor(last.nextSibling, element)) {
            last = last.nextSibling;
        }
    }
    const firstSpan = index.getSpan(first) as LineSpan;
    const lastSpan = index.getSpan(last) as LineSpan;
    return { first: firstSpan.first, last: lastSpan.last };
}

/** Whether `node` is a block of the kind of `element`, which is not an empty paragraph. */
function isSortableNeighbor(node: unknown, element: ModelElement): node is ModelElement {
    const block = node as ModelElement | null;
    return !!block?.is?.("element", element.name) && !block.isEmpty
        && !block.hasAttribute("listItemId");
}

/**
 * The units of the lines from `first` to `last`: whole blocks of one kind in one container, or
 * whole items of one list level with their nested items. `null` for any other range.
 */
function getUnits(model: Model, index: LineIndex, first: number, last: number): SortUnit[] | null {
    const elements: ModelElement[] = [];
    for (let line = first; line <= last; line++) {
        const entry = index.lines[line];
        if (entry?.kind !== "text") {
            return null;
        }
        const lines = index.getLinesOf(entry.block);
        if (lines[0] < first || lines[lines.length - 1] > last) {
            return null;
        }
        if (elements[elements.length - 1] !== entry.block) {
            elements.push(entry.block);
        }
    }
    const isInTable = elements.some((element) =>
        element.getAncestors().some((ancestor) => ancestor.is("element", "tableCell")));
    if (isInTable || !areSiblings(elements)) {
        return null;
    }
    if (elements.every((element) => element.hasAttribute("listItemId"))) {
        return getListUnits(model, elements);
    }
    const name = elements[0].name;
    if (elements.some((element) => element.name !== name || element.hasAttribute("listItemId"))) {
        return null;
    }
    return elements.map((element) => ({ blocks: [ element ], text: blockText(model, element) }));
}

/** The items of the lowest list level among `blocks`, when `blocks` hold every item whole. */
function getListUnits(model: Model, blocks: ModelElement[]): SortUnit[] | null {
    const level = Math.min(...blocks.map(getIndent));
    const units: SortUnit[] = [];
    let covered = 0;
    for (const block of blocks) {
        const item = getAllListItemBlocks(block, { higherIndent: true });
        if (getIndent(block) === level && item[0] === block) {
            units.push({ blocks: item, text: blockText(model, block) });
            covered += item.length;
        }
    }
    const isWhole = covered === blocks.length && units[0]?.blocks[0] === blocks[0];
    return isWhole && units.length > 1 ? units : null;
}

/** Sorts the lines from `first` to `last` of one code block as text. */
function sortCodeLines(cm: VimAdapter, first: number, last: number, options: SortOptions) {
    const index = cm.index();
    const units: SortUnit[] = [];
    for (let line = first; line <= last; line++) {
        units.push({ blocks: [], text: index.getText(line) });
    }
    const texts = sortUnits(units, options).map((unit) => unit.text);
    const firstEntry = index.lines[first] as TextLine;
    const lastEntry = index.lines[last] as TextLine;
    cm.editor.model.change((writer) => {
        const block = firstEntry.block;
        writer.remove(writer.createRange(
            writer.createPositionAt(block, firstEntry.start),
                writer.createPositionAt(block, lastEntry.end)));
        let position = writer.createPositionAt(block, firstEntry.start);
        for (const [ lineIndex, text ] of texts.entries()) {
            if (lineIndex > 0) {
                writer.insertElement("softBreak", position);
                position = position.getShiftedBy(1);
            }
            if (text) {
                writer.insertText(text, position);
                position = position.getShiftedBy(text.length);
            }
        }
    });
    cm.setCursor(first, 0);
}

/**
 * `units` in the order of Vim's `:sort` with `options`. With a number or a pattern to sort by, the
 * lines without one keep their order and come first. `u` leaves out the lines equal to the one
 * before them.
 */
export function sortUnits(units: SortUnit[], options: SortOptions): SortUnit[] {
    const keyed: KeyedUnit[] = units.map((unit) => ({ unit, key: getSortKey(unit.text, options) }));
    const compare = (a: KeyedUnit, b: KeyedUnit) => {
        const order = compareKeys(a.key ?? a.unit.text, b.key ?? b.unit.text, options);
        return options.isReverse ? -order : order;
    };

    let sorted: KeyedUnit[];
    if (options.pattern || options.radix) {
        const withKey = keyed.filter((entry) => entry.key !== null).sort(compare);
        const withoutKey = keyed.filter((entry) => entry.key === null);
        sorted = options.isReverse ? [ ...withKey, ...withoutKey ] : [ ...withoutKey, ...withKey ];
    } else {
        sorted = keyed.sort(compare);
    }
    if (options.isUnique) {
        sorted = sorted.filter((entry, entryIndex) => entryIndex === 0
            || compare(entry, sorted[entryIndex - 1]) !== 0);
    }
    return sorted.map((entry) => entry.unit);
}

/** What `text` sorts by: the number in it, the text after the pattern, the match, or the text. */
function getSortKey(text: string, options: SortOptions): string | number | null {
    let subject = text;
    if (options.pattern) {
        const match = options.pattern.exec(text);
        if (!match) {
            return null;
        }
        subject = options.isMatchKey ? match[0] : text.slice(match.index + match[0].length);
    }
    if (!options.radix) {
        return subject;
    }
    const numberPattern = { 10: /-?\d+/, 16: /-?(?:0x)?[0-9a-f]+/i, 8: /[0-7]+/ }[options.radix];
    const found = numberPattern.exec(subject);
    return found ? parseInt(found[0].replace(/0x/i, ""), options.radix) : null;
}

function compareKeys(a: string | number, b: string | number, options: SortOptions): number {
    if (typeof a === "number" && typeof b === "number") {
        return a - b;
    }
    const left = options.isIgnoringCase ? String(a).toLowerCase() : String(a);
    const right = options.isIgnoringCase ? String(b).toLowerCase() : String(b);
    return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Reads the arguments of `:sort`: `!`, the flags `i`, `n`, `d`, `x`, `o`, `u` and `r`, a
 * `/pattern/`.
 */
export function parseSortOptions(argString: string): SortOptions | null {
    const stream = new StringStream(argString.trim());
    const isReverse = !!stream.eat("!");
    stream.eatSpace();
    const flags = stream.match(/^[dinuoxr]+/);
    const flagText = Array.isArray(flags) ? flags[0] : "";
    stream.eatSpace();
    const pattern = stream.match(/^\/(.*)\/$/);
    const radixes = new Set([ ...flagText ].filter((flag) => "dnxo".includes(flag))
        .map((flag) => (flag === "d" ? "n" : flag)));
    if (!stream.eol() || radixes.size > 1) {
        return null;
    }
    const isIgnoringCase = flagText.includes("i");
    let regExp: RegExp | null = null;
    if (Array.isArray(pattern)) {
        try {
            regExp = new RegExp(pattern[1], isIgnoringCase ? "i" : "");
        } catch {
            return null;
        }
    }
    const radixFlag = [ ...radixes ][0] as "n" | "x" | "o" | undefined;
    return {
        isReverse,
        isIgnoringCase,
        isUnique: flagText.includes("u"),
        radix: radixFlag ? ({ n: 10, x: 16, o: 8 } as const)[radixFlag] : null,
        pattern: regExp,
        isMatchKey: flagText.includes("r")
    };
}

/** Moves the blocks of `units`, which follow each other, into the order of `sorted`. */
function applyOrder(writer: ModelWriter, units: SortUnit[], sorted: SortUnit[]) {
    const kept = new Set(sorted);
    for (const unit of units) {
        if (!kept.has(unit)) {
            for (const block of unit.blocks) {
                writer.remove(block);
            }
        }
    }
    const regionStart = units.find((unit) => kept.has(unit))?.blocks[0];
    let previous: SortUnit | null = null;
    for (const unit of sorted) {
        const insertAt = previous
            ? writer.createPositionAfter(previous.blocks[previous.blocks.length - 1])
            : writer.createPositionBefore(regionStart as ModelElement);
        // `writer.move()` skips a range that is already at `insertAt`.
        writer.move(writer.createRange(
            writer.createPositionBefore(unit.blocks[0]),
            writer.createPositionAfter(unit.blocks[unit.blocks.length - 1])), insertAt);
        previous = unit;
    }
}

function areSiblings(elements: ModelElement[]): boolean {
    return elements.every((element, elementIndex) =>
        elementIndex === 0 || element.previousSibling === elements[elementIndex - 1]);
}

function isListBlock(node: unknown): node is ModelElement {
    const block = node as ModelElement | null;
    return !!block?.is?.("element") && block.hasAttribute("listItemId");
}

function getIndent(block: ModelElement): number {
    return block.getAttribute("listIndent") as number;
}
