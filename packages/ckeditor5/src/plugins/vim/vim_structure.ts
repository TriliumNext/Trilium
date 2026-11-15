import type { Pos } from "@replit/codemirror-vim-core";
import {
    _getAllListItemBlocks as getAllListItemBlocks, type Editor, type ModelElement,
    type ModelPosition, type ModelWriter, TableWalker
} from "ckeditor5";

import { OPEN_ATTRIBUTE } from "../collapsible/constants.js";
import { HEADING_COLLAPSED } from "../collapsible_headings/constants.js";
import {
    getSection, getSectionLevel, isHeadingName
} from "../collapsible_headings/heading_sections.js";
import { LIST_COLLAPSED_ATTRIBUTE } from "../collapsible_list_items.js";
import type VimAdapter from "./vim_adapter.js";
import { VimPosition } from "./vim_adapter.js";
import type { ParagraphObjectKind } from "./vim_hints.js";
import type { LineSpan } from "./vim_lines.js";

/** The containers whose lines `ip` takes, and whose block with the next empty line `ap` takes. */
const WRAPPING_CONTAINERS = new Set([ "blockQuote", "aside", "details" ]);

/** The containers whose lines `ip` and `ap` both take. */
const BOX_CONTAINERS = new Set([ "tableCell", "multicolumnColumn", "tabPanel", "asideContent" ]);

/** The attributes of the owners that hide their content while collapsed. */
const COLLAPSE_ATTRIBUTES = [ HEADING_COLLAPSED, LIST_COLLAPSED_ATTRIBUTE ];

/**
 * A structural block: siblings from `start` to `end`, such as a paragraph, a whole list, or a list
 * item with its nested items.
 */
interface Unit {
    start: ModelElement;
    end: ModelElement;
}

/** A node seen as a structural block: a list block as its item, or as the whole list. */
interface Place {
    element: ModelElement;
    isList: boolean;
}

/** The structural blocks at one nesting level, and the place of the container around them. */
interface Level {
    units: Unit[];
    index: number;
    up: Place | null;
    /** Whether the units are the items of a list rather than the blocks of a container. */
    isListLevel: boolean;
}

/**
 * The start of the structural block `count` blocks after the one of `head`, or before it. Going
 * back, the start of the block of `head` comes first. Past the last block of a container, what
 * follows the container comes next: the next cell, column or tab, or the block after it.
 */
export function findStructuralBlock(
    cm: VimAdapter, head: Pos, count: number, isForward: boolean
): Pos {
    const index = cm.index();
    let place: Place = { element: index.getElement(head.line) as ModelElement, isList: false };
    let remaining = count;
    let target: number | null = null;

    if (!isForward) {
        const level = getLevel(place);
        const span = getSpanOf(cm, level.units[level.index]) as LineSpan;
        if (head.line > span.first || head.ch > 0) {
            target = span.first;
            remaining--;
        }
    }

    while (remaining > 0) {
        const level = getLevel(place);
        const found = findUnitWithLines(cm, level, isForward);
        if (found) {
            // A list at the level of a container is one block, read again as the whole list.
            place = {
                element: found.unit.start,
                isList: !level.isListLevel && found.unit.start.hasAttribute("listItemId")
            };
            target = found.span.first;
            remaining--;
            continue;
        }
        if (!level.up) {
            target = isForward ? null : 0;
            break;
        }
        place = level.up;
    }

    const lastLine = index.lastLine;
    return target === null
        ? new VimPosition(lastLine, index.getText(lastLine).length)
        : new VimPosition(target, 0);
}

/**
 * The lines of the text object `ap` or `ip` around line `line`, `count` structural blocks of it.
 * The innermost container around the line decides: a list item, a quote, an admonition, a cell, a
 * code block, a column, a content tab, an aside, a collapsible block, a widget, a heading with its
 * section for `ap`, or a paragraph. Collapsed content in the result is expanded first, as part of
 * the change when `isChange` is set.
 */
export function findParagraphObject(
    cm: VimAdapter, line: number, count: number, isInner: boolean, isChange: boolean
): LineSpan {
    const element = cm.index().getElement(line) as ModelElement;
    const range = count > 1
        ? getUnitsRange(cm, element, count)
        : getContainerRange(element, isInner);
    expandCollapsed(cm.editor, range, isChange);

    const index = cm.index();
    const first = (index.getSpan(range.start) as LineSpan).first;
    const last = (index.getSpan(range.end) as LineSpan).last;
    const withEmptyLine = !isInner && range.isTrailingLineTaken && isEmptyParagraph(cm, last + 1)
        ? last + 1
        : last;
    return { first, last: withEmptyLine };
}

/** The line of the heading `count` headings after `line`, or before it, or `null`. */
export function findHeading(
    cm: VimAdapter, line: number, count: number, isForward: boolean
): number | null {
    const index = cm.index();
    let found: number | null = null;
    let remaining = count;
    for (let current = line + (isForward ? 1 : -1); current >= 0 && current <= index.lastLine;
        current += isForward ? 1 : -1) {
        const element = index.getElement(current);
        if (element && isHeadingName(element.name) && index.getFirstLine(element) === current) {
            found = current;
            if (--remaining === 0) {
                break;
            }
        }
    }
    return found;
}

/**
 * The first line of the section around `line`, its heading, or its last line: the line before the
 * next heading of the same or a higher level.
 */
export function findSectionEdge(cm: VimAdapter, line: number, isEnd: boolean): number {
    const index = cm.index();
    const heading = findSectionHeading(cm, line);
    if (!isEnd) {
        return heading ? index.getFirstLine(heading) as number : 0;
    }
    if (!heading) {
        const next = findHeading(cm, line, 1, true);
        return next === null ? index.lastLine : next - 1;
    }
    const section = getSection(heading);
    const lastBlock = section.at(-1) ?? heading;
    return index.firstLineFrom(cm.editor.model.createPositionAfter(lastBlock)) - 1;
}

/** What a fold command does: `za`, `zo` and `zc`, and with `isNested`, `zA`, `zO` and `zC`. */
export type FoldAction = "toggle" | "open" | "close";

/**
 * Collapses or expands the collapsible heading, list item or block around line `line`. Returns
 * `false` when there is none.
 */
export function fold(cm: VimAdapter, line: number, action: FoldAction, isNested: boolean): boolean {
    const editor = cm.editor;
    const owner = findFoldOwner(cm, cm.index().getElement(line) as ModelElement);
    if (!owner) {
        return false;
    }
    const isOpen = !isCollapsed(owner);
    const isOpening = action === "toggle" ? !isOpen : action === "open";
    const owners = isNested ? [ owner, ...getNestedOwners(editor, owner) ] : [ owner ];
    editor.model.enqueueChange({ isUndoable: false }, (writer) => {
        for (const each of owners) {
            setCollapsed(writer, each, !isOpening);
        }
        const focus = editor.model.document.selection.focus as ModelPosition;
        if (!isOpening && !isInsideShownPart(owner, focus.parent as ModelElement)) {
            writer.setSelection(getShownPart(owner), "end");
        }
    });
    return true;
}

/** Whether a fold command collapses or expands something around line `line`. */
export function canFold(cm: VimAdapter, line: number): boolean {
    return !!findFoldOwner(cm, cm.index().getElement(line) as ModelElement);
}

/** The block that `ip` and `ap` take around line `line`, by the rule of `findParagraphObject()`. */
export function getParagraphObjectKind(cm: VimAdapter, line: number): ParagraphObjectKind {
    const element = cm.index().getElement(line) as ModelElement;
    if (element.root.document?.model.schema.isObject(element)) {
        return "widget";
    }
    if (getSectionLevel(element) !== null) {
        return "heading";
    }
    if (element.hasAttribute("listItemId")) {
        return "listItem";
    }
    if (element.is("element", "codeBlock")) {
        return "codeBlock";
    }
    if (element.is("element", "summary")) {
        return "collapsibleTitle";
    }
    for (const ancestor of element.getAncestors().reverse() as ModelElement[]) {
        if (ancestor.is("element", "details")) {
            return "collapsibleBody";
        }
        if (WRAPPING_CONTAINERS.has(ancestor.name)) {
            return ancestor.is("element", "aside") ? "admonition" : "quote";
        }
        if (BOX_CONTAINERS.has(ancestor.name)) {
            return "box";
        }
    }
    return "paragraph";
}

/**
 * The parts of the lines from `first` to `last` that an operator takes after `j` or `k`, which move
 * down and up the columns of a table: in a table that holds an end, only the cells in the columns
 * of the ends. `null` when that leaves out no line.
 */
export function getColumnParts(cm: VimAdapter, first: number, last: number): LineSpan[] | null {
    const index = cm.index();
    // The cells that the ends are in, by their table.
    const ends = new Map<ModelElement, ModelElement[]>();
    for (const line of [ first, last ]) {
        for (const cell of getCells(index.getElement(line) as ModelElement)) {
            const table = getTableOf(cell);
            ends.set(table, [ ...ends.get(table) ?? [], cell ]);
        }
    }
    if (!ends.size) {
        return null;
    }
    const leftOut = new Set<ModelElement>();
    for (const [ table, cells ] of ends) {
        for (const cell of getCellsOutside(table, cells)) {
            leftOut.add(cell);
        }
    }

    const parts: LineSpan[] = [];
    let isAnyLeftOut = false;
    for (let line = first; line <= last; line++) {
        const cells = getCells(index.getElement(line) as ModelElement);
        if (cells.some((cell) => leftOut.has(cell))) {
            isAnyLeftOut = true;
            continue;
        }
        const previous = parts.at(-1);
        if (previous?.last === line - 1) {
            previous.last = line;
        } else {
            parts.push({ first: line, last: line });
        }
    }
    return isAnyLeftOut ? parts : null;
}

/** The table cells around `element`. */
function getCells(element: ModelElement): ModelElement[] {
    return element.getAncestors({ includeSelf: true })
        .filter((ancestor) => ancestor.is("element", "tableCell")) as ModelElement[];
}

function getTableOf(cell: ModelElement): ModelElement {
    return (cell.parent as ModelElement).parent as ModelElement;
}

/**
 * The cells of `table` that lie wholly outside the columns of `cells`. A merged cell that reaches
 * into those columns is inside them.
 */
function getCellsOutside(table: ModelElement, cells: ModelElement[]): ModelElement[] {
    const slots = [ ...new TableWalker(table, { includeAllSlots: true }) ];
    const columns = slots.filter((slot) => cells.includes(slot.cell)).map((slot) => slot.column);
    const firstColumn = Math.min(...columns);
    const lastColumn = Math.max(...columns);
    const inside = new Set(slots.filter((slot) => slot.column >= firstColumn
        && slot.column <= lastColumn).map((slot) => slot.cell));
    return slots.map((slot) => slot.cell).filter((cell) => !inside.has(cell));
}

/** The units of the level of `place`, and the place of the container around them. */
function getLevel(place: Place): Level {
    const element = place.element;
    if (element.hasAttribute("listItemId") && !place.isList) {
        return getListLevel(element);
    }
    if (element.is("element", "tableCell")) {
        return getCellLevel(element);
    }

    const parent = element.parent as ModelElement;
    const units: Unit[] = [];
    let unitIndex = 0;
    let current: Unit | null = null;
    for (const child of parent.getChildren()) {
        const block = child as ModelElement;
        const isListBlock = block.hasAttribute("listItemId");
        if (isListBlock && current?.start.hasAttribute("listItemId")) {
            current.end = block;
        } else {
            current = { start: block, end: block };
            units.push(current);
        }
        if (block === element) {
            unitIndex = units.length - 1;
        }
    }
    const up = parent.is("rootElement") ? null : { element: parent, isList: false };
    return { units, index: unitIndex, up, isListLevel: false };
}

/** The cells of the table of `cell`, in reading order. */
function getCellLevel(cell: ModelElement): Level {
    const table = cell.parent?.parent as ModelElement;
    const cells: ModelElement[] = [];
    for (const row of table.getChildren()) {
        if (row.is("element", "tableRow")) {
            cells.push(...row.getChildren() as Iterable<ModelElement>);
        }
    }
    return {
        units: cells.map((each) => ({ start: each, end: each })),
        index: cells.indexOf(cell),
        up: { element: table, isList: false },
        isListLevel: false
    };
}

/** The items of a list at the level of `block`, inside the item that holds them. */
function getListLevel(block: ModelElement): Level {
    const indent = getIndent(block);
    let start: ModelElement = block;
    while (isListSibling(start.previousSibling) && getIndent(start.previousSibling) >= indent) {
        start = start.previousSibling;
    }
    const parentItem = isListSibling(start.previousSibling) ? start.previousSibling : null;

    const units: Unit[] = [];
    let unitIndex = 0;
    for (let node: ModelElement | null = start; isListSibling(node) && getIndent(node) >= indent;
        node = node.nextSibling as ModelElement | null) {
        const lastItemId = units.at(-1)?.start.getAttribute("listItemId");
        const isItemStart = getIndent(node) === indent
            && node.getAttribute("listItemId") !== lastItemId;
        if (isItemStart) {
            units.push({ start: node, end: node });
        } else {
            units[units.length - 1].end = node;
        }
        if (node === block) {
            unitIndex = units.length - 1;
        }
    }

    let up: Place;
    if (parentItem) {
        up = { element: getAllListItemBlocks(parentItem)[0] as ModelElement, isList: false };
    } else {
        up = { element: start, isList: true };
    }
    return { units, index: unitIndex, up, isListLevel: true };
}

/** The next unit of `level` that has lines, after the current one or before it. */
function findUnitWithLines(cm: VimAdapter, level: Level, isForward: boolean) {
    for (let unitIndex = level.index + (isForward ? 1 : -1);
        unitIndex >= 0 && unitIndex < level.units.length; unitIndex += isForward ? 1 : -1) {
        const unit = level.units[unitIndex];
        const span = getSpanOf(cm, unit);
        if (span) {
            return { unit, span };
        }
    }
    return null;
}

function getSpanOf(cm: VimAdapter, unit: Unit): LineSpan | null {
    const index = cm.index();
    const first = index.getSpan(unit.start)?.first;
    const last = index.getSpan(unit.end)?.last;
    return first !== undefined && last !== undefined ? { first, last } : null;
}

/** The blocks of a text object, and whether `ap` takes the empty line after them. */
interface ObjectRange {
    start: ModelElement;
    end: ModelElement;
    isTrailingLineTaken: boolean;
}

/** The container of a text object around `element`, by the innermost container rule. */
function getContainerRange(element: ModelElement, isInner: boolean): ObjectRange {
    const single = { start: element, end: element, isTrailingLineTaken: false };
    if (element.root.document?.model.schema.isObject(element)) {
        return single;
    }
    if (getSectionLevel(element) !== null) {
        const section = getSection(element);
        return isInner || !section.length
            ? single
            : { start: element, end: section[section.length - 1], isTrailingLineTaken: false };
    }
    if (element.hasAttribute("listItemId")) {
        const options = isInner ? {} : { higherIndent: true };
        const blocks = getAllListItemBlocks(element, options) as ModelElement[];
        return { start: blocks[0], end: blocks[blocks.length - 1], isTrailingLineTaken: false };
    }
    if (element.is("element", "codeBlock")) {
        return { ...single, isTrailingLineTaken: true };
    }
    if (element.is("element", "summary")) {
        const details = element.parent as ModelElement;
        return isInner ? single : { start: details, end: details, isTrailingLineTaken: true };
    }

    for (const ancestor of element.getAncestors().reverse() as ModelElement[]) {
        if (WRAPPING_CONTAINERS.has(ancestor.name)) {
            if (!isInner) {
                return { start: ancestor, end: ancestor, isTrailingLineTaken: true };
            }
            const children = [ ...ancestor.getChildren() ] as ModelElement[];
            const body = ancestor.is("element", "details") ? children.slice(1) : children;
            return { start: body[0], end: body[body.length - 1], isTrailingLineTaken: false };
        }
        if (BOX_CONTAINERS.has(ancestor.name)) {
            const children = [ ...ancestor.getChildren() ] as ModelElement[];
            const end = children[children.length - 1];
            return { start: children[0], end, isTrailingLineTaken: false };
        }
    }
    return { ...single, isTrailingLineTaken: true };
}

/**
 * `count` structural blocks from the one of `element`, at its nesting level. The count stops at
 * the end of the container and before a heading, whose section goes with `dap` on it only.
 */
function getUnitsRange(cm: VimAdapter, element: ModelElement, count: number): ObjectRange {
    const level = getLevel({ element, isList: false });
    const first = level.units[level.index];
    let last = first;
    const isHeading = getSectionLevel(first.start) !== null;
    if (isHeading) {
        const section = getSection(first.start);
        last = { start: first.start, end: section.at(-1) ?? first.start };
    }
    for (let taken = 1; taken < count && !isHeading; taken++) {
        const next = level.units[level.units.indexOf(last) + 1];
        if (!next) {
            break;
        }
        if (getSectionLevel(next.start) !== null) {
            cm.host.notify(cm.editor.t("The count stopped at a heading"));
            break;
        }
        last = next;
    }
    if (isHeading && count > 1) {
        cm.host.notify(cm.editor.t("The count stopped at a heading"));
    }
    return { start: first.start, end: last.end, isTrailingLineTaken: true };
}

/**
 * Expands the collapsed headings, list items and collapsible blocks from `range.start` to
 * `range.end`.
 */
function expandCollapsed(editor: Editor, range: ObjectRange, isChange: boolean) {
    const model = editor.model;
    const owners: ModelElement[] = [];
    const start = model.createPositionBefore(range.start);
    const modelRange = model.createRange(start, model.createPositionAfter(range.end));
    for (const item of modelRange.getItems()) {
        if (item.is("element") && isCollapsed(item) && isFoldable(item)) {
            owners.push(item);
        }
    }
    if (!owners.length) {
        return;
    }
    const expand = (writer: ModelWriter) => {
        for (const owner of owners) {
            setCollapsed(writer, owner, false);
        }
    };
    if (isChange) {
        model.change(expand);
    } else {
        model.enqueueChange({ isUndoable: false }, expand);
    }
}

/**
 * Whether `element` hides some of its content: a collapsed heading or list item, a closed block.
 */
function isCollapsed(element: ModelElement): boolean {
    if (element.is("element", "details")) {
        return !element.getAttribute(OPEN_ATTRIBUTE);
    }
    return COLLAPSE_ATTRIBUTES.some((attribute) => !!element.getAttribute(attribute));
}

/** Whether `element` can hide some of its content. */
function isFoldable(element: ModelElement): boolean {
    if (element.is("element", "details")) {
        return true;
    }
    if (getSectionLevel(element) !== null) {
        return getSection(element).length > 0;
    }
    return element.hasAttribute("listItemId")
        && getAllListItemBlocks(element, { higherIndent: true }).length
            > getAllListItemBlocks(element).length;
}

function setCollapsed(writer: ModelWriter, owner: ModelElement, isClosed: boolean) {
    if (owner.is("element", "details")) {
        if (isClosed) {
            writer.removeAttribute(OPEN_ATTRIBUTE, owner);
        } else {
            writer.setAttribute(OPEN_ATTRIBUTE, true, owner);
        }
        return;
    }
    const isHeading = getSectionLevel(owner) !== null;
    const attribute = isHeading ? HEADING_COLLAPSED : LIST_COLLAPSED_ATTRIBUTE;
    const blocks = isHeading ? [ owner ] : getAllListItemBlocks(owner);
    for (const block of blocks) {
        if (isClosed) {
            writer.setAttribute(attribute, true, block);
        } else {
            writer.removeAttribute(attribute, block);
        }
    }
}

/**
 * The innermost foldable structure around `element`: the heading itself, its list item or the one
 * whose nested items hold it, its collapsible block, or the heading whose section holds it.
 */
function findFoldOwner(cm: VimAdapter, element: ModelElement): ModelElement | null {
    if (isFoldable(element) && !element.is("element", "details")) {
        return element.hasAttribute("listItemId")
            ? getAllListItemBlocks(element)[0] as ModelElement
            : element;
    }
    if (element.hasAttribute("listItemId")) {
        const indent = getIndent(element);
        for (let node = element.previousSibling as ModelElement | null; isListSibling(node);
            node = node.previousSibling as ModelElement | null) {
            if (getIndent(node) < indent && isFoldable(node)) {
                return getAllListItemBlocks(node)[0] as ModelElement;
            }
        }
    }
    for (const ancestor of element.getAncestors().reverse() as ModelElement[]) {
        if (ancestor.is("element", "details")) {
            return ancestor;
        }
    }
    const heading = findSectionHeading(cm, cm.index().getFirstLine(element) as number);
    return heading && isFoldable(heading) ? heading : null;
}

/** The heading whose section holds line `line`, or the heading of the line, or `null`. */
function findSectionHeading(cm: VimAdapter, line: number): ModelElement | null {
    let block = cm.index().getElement(line) as ModelElement;
    while (block.parent && !block.parent.is("rootElement")) {
        block = block.parent as ModelElement;
    }
    if (getSectionLevel(block) !== null) {
        return block;
    }
    for (let node = block.previousSibling; node; node = node.previousSibling) {
        if (getSectionLevel(node) !== null) {
            return node as ModelElement;
        }
    }
    return null;
}

/** The foldable structures inside the content that `owner` hides. */
function getNestedOwners(editor: Editor, owner: ModelElement): ModelElement[] {
    const model = editor.model;
    const content: ModelElement[] = owner.is("element", "details")
        ? [ owner ]
        : getSectionLevel(owner) !== null
            ? getSection(owner)
            : getAllListItemBlocks(owner, { higherIndent: true });
    const owners: ModelElement[] = [];
    for (const block of content) {
        for (const item of model.createRangeOn(block).getItems()) {
            if (item.is("element") && item !== owner && isFoldable(item)) {
                owners.push(item);
            }
        }
    }
    return owners;
}

/** Whether `block` is in the part of `owner` that shows while it is collapsed. */
function isInsideShownPart(owner: ModelElement, block: ModelElement): boolean {
    if (owner.hasAttribute("listItemId")) {
        return (getAllListItemBlocks(owner) as ModelElement[]).includes(block);
    }
    const shown = getShownPart(owner);
    return block === shown || block.getAncestors().includes(shown);
}

/** The part of `owner` that shows while it is collapsed: its title, or the owner itself. */
function getShownPart(owner: ModelElement): ModelElement {
    if (owner.is("element", "details")) {
        return owner.getChild(0) as ModelElement;
    }
    return owner.hasAttribute("listItemId")
        ? getAllListItemBlocks(owner).at(-1) as ModelElement
        : owner;
}

function isEmptyParagraph(cm: VimAdapter, line: number): boolean {
    const element = cm.index().getElement(line);
    return !!element && element.is("element", "paragraph") && element.isEmpty
        && !element.hasAttribute("listItemId");
}

function isListSibling(node: unknown): node is ModelElement {
    return !!node && (node as ModelElement).is?.("element")
        && (node as ModelElement).hasAttribute("listItemId");
}

function getIndent(block: ModelElement): number {
    return block.getAttribute("listIndent") as number;
}
