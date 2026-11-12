import {
    BubblingEventInfo, type Editor, type ModelElement, ModelLivePosition, type ModelPosition,
    type ModelRange, type ModelSchema, type ModelWriter, ViewDocumentDomEventData, type ViewRange
} from "ckeditor5";

import HiddenBlocks from "../hidden_blocks.js";
import type { LineIndex, LinePosition, TextLine } from "./vim_lines.js";

/** The attributes whose boundary the caret steps over in two presses, as at the end of a link. */
const TWO_STEP_ATTRIBUTES = [ "linkHref", "code" ];

/** A block or a widget to remove, or the range of some parts of a block between soft breaks. */
type Removal = { element: ModelElement } | { range: ModelRange };

/**
 * The lines that the range from `from` to `to` covers whole: from the start of a line to the
 * start of the line after the last one, from the end of a line to past the end of the note, or a
 * widget line.
 */
export function getWholeLines(
    index: LineIndex, from: LinePosition, to: LinePosition
): { first: number; last: number } | null {
    const lastLine = index.lastLine;
    if (from.ch === 0 && to.ch === 0 && to.line > from.line) {
        return { first: from.line, last: Math.min(to.line - 1, lastLine) };
    }
    const isWidget = index.lines[from.line]?.kind === "object";
    if (isWidget && from.line === to.line && from.ch === 0 && to.ch > 0) {
        return { first: from.line, last: from.line };
    }
    const isAtLineEnd = from.ch >= index.getText(from.line).length;
    if (isAtLineEnd && to.line > lastLine && from.line < lastLine) {
        return { first: from.line + 1, last: lastLine };
    }
    return null;
}

/**
 * Removes the lines from `first` to `last`. A block goes with its last line, and a container goes
 * with its content, such as a quote with its last block or a table with the lines of all its
 * cells. A limit, such as a table cell or a column, otherwise keeps one empty block, and a title,
 * such as that of a collapsible block, is cleared. A part of a block between soft breaks goes with
 * one of its soft breaks.
 */
export function removeLines(editor: Editor, index: LineIndex, first: number, last: number) {
    const model = editor.model;
    const removals: Removal[] = [];
    const removedElements = new Set<ModelElement>();
    let line = first;
    while (line <= last) {
        const element = index.getElement(line) as ModelElement;
        const lines = index.getLinesOf(element);
        const removed = lines.filter((blockLine) => blockLine >= first && blockLine <= last);
        if (removed.length === lines.length) {
            removedElements.add(element);
            removals.push({ element });
        } else {
            removals.push({ range: getSegmentRange(editor, index, lines, removed) });
        }
        line = removed[removed.length - 1] + 1;
    }
    const units = new Set<ModelElement>();
    for (const removal of removals) {
        if ("element" in removal) {
            removal.element = getRemovalUnit(model.schema, removal.element, removedElements);
        }
    }

    model.change((writer) => {
        for (const removal of removals.reverse()) {
            if (!("element" in removal)) {
                writer.remove(removal.range);
            } else if (!units.has(removal.element)) {
                units.add(removal.element);
                removeBlock(writer, removal.element);
            }
        }
    });
}

/**
 * The outermost element around `element` whose content all goes with `removed`, such as the
 * collapsible block of a removed title and body. A table cell or a column goes only with its table
 * or its layout.
 */
function getRemovalUnit(
    schema: ModelSchema, element: ModelElement, removed: Set<ModelElement>
): ModelElement {
    let unit = element;
    for (let parent = element.parent as ModelElement | null; parent && !parent.is("rootElement")
        && isRemovedWhole(parent, removed); parent = parent.parent as ModelElement | null) {
        if (!schema.isLimit(parent) || schema.isObject(parent)) {
            unit = parent;
        }
    }
    return unit;
}

function isRemovedWhole(element: ModelElement, removed: Set<ModelElement>): boolean {
    return removed.has(element) || (element.childCount > 0 && [ ...element.getChildren() ]
        .every((child) => child.is("element") && isRemovedWhole(child, removed)));
}

/**
 * The range of the parts `removed` of a block between soft breaks, with the soft break after the
 * last one, or before the first one when they end the block.
 */
function getSegmentRange(
    editor: Editor, index: LineIndex, lines: number[], removed: number[]
): ModelRange {
    const model = editor.model;
    const firstEntry = index.lines[removed[0]] as TextLine;
    const lastEntry = index.lines[removed[removed.length - 1]] as TextLine;
    const isAtEnd = removed[removed.length - 1] === lines[lines.length - 1];
    const start = isAtEnd ? firstEntry.start - 1 : firstEntry.start;
    const end = isAtEnd ? lastEntry.end : lastEntry.end + 1;
    const block = firstEntry.block;
    return model.createRange(
        model.createPositionAt(block, start), model.createPositionAt(block, end));
}

/**
 * Removes `block`, or clears it when it is a title. A limit that it leaves empty keeps a paragraph.
 */
function removeBlock(writer: ModelWriter, block: ModelElement) {
    if (isTitle(writer, block)) {
        writer.remove(writer.createRangeIn(block));
        return;
    }
    const parent = block.parent as ModelElement;
    writer.remove(block);
    if (!parent.is("rootElement") && parent.isEmpty) {
        writer.insertElement("paragraph", parent, 0);
    }
}

/** Whether `block` is a title that its container cannot do without, such as a table caption. */
function isTitle(writer: ModelWriter, block: ModelElement) {
    const schema = writer.model.schema;
    return block.is("element", "summary") || (schema.isLimit(block) && !schema.isObject(block));
}

/**
 * Replaces `range`, which holds `oldText`, with `text`. A line break in `text` splits the block, or
 * adds a soft break in a code block or a title. The new text takes the formatting of the text it
 * replaces, as typed text would. Returns the position after the new text, or `null` when nothing
 * changed: an object is never replaced by text.
 */
export function replaceText(
    editor: Editor, range: ModelRange, text: string, oldText: string
): ModelPosition | null {
    const model = editor.model;
    if (text && isOnlyObjects(editor, range)) {
        return null;
    }
    if (!range.isCollapsed && oldText === text) {
        return range.end;
    }

    let end: ModelPosition | null = null;
    model.change((writer) => {
        const attributes = getTextAttributes(range);
        let position = range.start;
        if (!range.isCollapsed) {
            const selection = writer.createSelection(range);
            model.deleteContent(selection, { doNotResetEntireContent: true });
            position = selection.getFirstPosition() as ModelPosition;
        }
        end = insertLines(writer, position, text.split("\n"), attributes);
    });
    return end;
}

/** Inserts `lines` at `position`, with a line break between two of them. Returns where they end. */
function insertLines(
    writer: ModelWriter, position: ModelPosition, lines: string[], attributes: [ string, unknown ][]
): ModelPosition {
    const schema = writer.model.schema;
    let current = position;
    for (const [ lineIndex, line ] of lines.entries()) {
        if (lineIndex > 0) {
            current = insertBreak(writer, current);
        }
        if (line && schema.checkChild(current, "$text")) {
            const context = schema.createContext(current).push("$text");
            const allowed = attributes.filter(([ key ]) => schema.checkAttribute(context, key));
            writer.insertText(line, Object.fromEntries(allowed), current);
            current = current.getShiftedBy(line.length);
        }
    }
    return current;
}

/** Splits the block at `position`, or adds a soft break in a code block and in a title. */
function insertBreak(writer: ModelWriter, position: ModelPosition): ModelPosition {
    const block = position.parent as ModelElement;
    const isSplittable = block.is("element") && !block.is("rootElement")
        && !block.is("element", "codeBlock") && !isTitle(writer, block);
    if (isSplittable) {
        const { position: between } = writer.split(position);
        return writer.createPositionAt(between.nodeAfter as ModelElement, 0);
    }
    if (writer.model.schema.checkChild(position, "softBreak")) {
        writer.insertElement("softBreak", position);
        return position.getShiftedBy(1);
    }
    return position;
}

/** Whether `range` holds objects and nothing else. */
function isOnlyObjects(editor: Editor, range: ModelRange): boolean {
    const schema = editor.model.schema;
    let hasObject = false;
    for (const item of range.getItems({ shallow: true })) {
        if (!item.is("element") || !schema.isObject(item)) {
            return false;
        }
        hasObject = true;
    }
    return hasObject;
}

/** The formatting that text written at the start of `range` gets, as typed text would. */
function getTextAttributes(range: ModelRange): [ string, unknown ][] {
    const start = range.start;
    const before = start.textNode ?? start.nodeBefore;
    const after = start.textNode ?? start.nodeAfter;
    const node = range.isCollapsed ? before ?? after : after ?? before;
    return node?.is("$text") ? [ ...node.getAttributes() ] : [];
}

/**
 * Opens a new line below line `line`, or above it, as Enter at its end or at its start does. On a
 * widget, Enter adds a paragraph after it, and Shift+Enter before it. A heading opened this way is
 * a paragraph. `getIndex()` returns the lines as they are after a change.
 */
export function openLine(
    editor: Editor, getIndex: () => LineIndex, line: number, isAfter: boolean
) {
    const model = editor.model;
    const entry = getIndex().lines[line];
    if (!entry) {
        return;
    }
    if (entry.kind === "object") {
        model.change((writer) => writer.setSelection(entry.element, "on"));
        fireViewEvent(editor, "enter", { isSoft: !isAfter });
        return;
    }

    model.change((writer) => writer.setSelection(
        writer.createPositionAt(entry.block, isAfter ? entry.end : entry.start)));
    fireViewEvent(editor, "enter", { isSoft: false });

    model.change((writer) => {
        const index = getIndex();
        const focus = model.document.selection.focus as ModelPosition;
        const found = index.locate(focus);
        // Enter at the start of a line adds the line before it and leaves the caret where it was.
        if (!isAfter && found.line === line + 1 && found.ch === 0) {
            writer.setSelection(index.positionAt(line, Number.MAX_SAFE_INTEGER));
        }
        const block = (model.document.selection.focus as ModelPosition).parent as ModelElement;
        if (/^heading[1-6]$/.test(block.name) && block.isEmpty) {
            writer.rename(block, "paragraph");
        }
    });
}

/**
 * Joins line `line` with the next line, as Backspace at the start of the next line does, and puts
 * one space where two texts meet when `addSpace` is set. Does nothing next to a widget, across a
 * limit, into or out of a collapsible block, and after a collapsed heading or list item. Returns
 * where the caret goes, the end of line `line` when Backspace moved blocks without joining texts,
 * or `null` when nothing changed.
 */
export function joinLine(
    editor: Editor, index: LineIndex, line: number, addSpace: boolean
): ModelPosition | null {
    const model = editor.model;
    const current = index.lines[line];
    const next = index.lines[line + 1];
    if (current?.kind !== "text" || next?.kind !== "text" || !canJoin(editor, current, next)) {
        return null;
    }

    const joinPoint = ModelLivePosition.fromPosition(
        model.createPositionAt(current.block, current.end), "toPrevious");
    const leftText = index.getText(line);
    const rightText = index.getText(line + 1);
    model.change((writer) => writer.setSelection(writer.createPositionAt(next.block, next.start)));
    fireViewEvent(editor, "delete", { direction: "backward", unit: "character", sequence: 1 });

    const position = joinPoint.toPosition();
    joinPoint.detach();
    const isJoined = current.block === next.block || next.block.root.rootName === "$graveyard";
    if (!isJoined) {
        return position;
    }
    if (addSpace) {
        model.change((writer) => {
            const leading = (/^\s*/.exec(rightText) as RegExpExecArray)[0].length;
            if (leading) {
                writer.remove(writer.createRange(position, position.getShiftedBy(leading)));
            }
            if (leftText && rightText.length > leading) {
                const attributes = getTextAttributes(writer.createRange(position));
                writer.insertText(" ", Object.fromEntries(attributes), position);
            }
        });
    }
    return position;
}

/** Whether Backspace at the start of `next` would merge it into `current` or move blocks. */
function canJoin(editor: Editor, current: TextLine, next: TextLine): boolean {
    if (current.block === next.block) {
        return true;
    }
    const model = editor.model;
    const hiddenBlocks = editor.plugins.has(HiddenBlocks) ? editor.plugins.get(HiddenBlocks) : null;
    if (hiddenBlocks?.getHiddenRunAfter(current.block).length) {
        return false;
    }
    const currentLimit = model.schema.getLimitElement(model.createPositionAt(current.block, 0));
    const nextLimit = model.schema.getLimitElement(model.createPositionAt(next.block, 0));
    if (currentLimit !== nextLimit) {
        return false;
    }
    const nextCollapsible = getCollapsible(next.block);
    if (current.block.is("element", "summary")) {
        return nextCollapsible === current.block.parent;
    }
    return getCollapsible(current.block) === nextCollapsible;
}

/** The collapsible block around `block`, or `null`. */
function getCollapsible(block: ModelElement): ModelElement | null {
    for (const ancestor of block.getAncestors().reverse()) {
        if (ancestor.is("element", "details")) {
            return ancestor;
        }
    }
    return null;
}

/** Indents the lines from `first` to `last`, or outdents them, as the toolbar buttons do. */
export function indentLines(
    editor: Editor, index: LineIndex, first: number, last: number, isIndent: boolean
) {
    const lines: TextLine[] = [];
    for (let line = first; line <= last; line++) {
        const entry = index.lines[line];
        if (entry?.kind === "text") {
            lines.push(entry);
        }
    }
    const commandName = isIndent ? "indent" : "outdent";
    if (!lines.length || !editor.commands.get(commandName)) {
        return;
    }
    const firstLine = lines[0];
    const lastLine = lines[lines.length - 1];
    editor.model.change((writer) => writer.setSelection(writer.createRange(
        writer.createPositionAt(firstLine.block, firstLine.start),
        writer.createPositionAt(lastLine.block, lastLine.end))));
    if (editor.commands.get(commandName)?.isEnabled) {
        editor.execute(commandName);
    }
}

/**
 * Whether text typed at `position` would continue a link or inline code that ends there, which
 * the caret then leaves, as the arrow keys do.
 */
export function isAtTwoStepBoundary(position: ModelPosition): boolean {
    const before = position.textNode ? null : position.nodeBefore;
    const after = position.textNode ?? position.nodeAfter;
    return !!before && TWO_STEP_ATTRIBUTES.some((key) => before.hasAttribute(key)
        && before.getAttribute(key) !== after?.getAttribute(key));
}

/** Fires view event `name` at the selection, as typing Enter or Backspace does. */
function fireViewEvent(editor: Editor, name: "enter" | "delete", data: Record<string, unknown>) {
    const view = editor.editing.view;
    const domEvent = new Event(name === "enter" ? "beforeinput" : "keydown", { cancelable: true });
    const range = view.document.selection.getFirstRange() as ViewRange;
    const eventInfo = new BubblingEventInfo(view.document, name, range);
    view.document.fire(eventInfo, new ViewDocumentDomEventData(view, domEvent, data));
}
