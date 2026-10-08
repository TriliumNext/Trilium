import { Command, type Editor, type ModelElement, type ModelWriter } from "ckeditor5";

import {
    COLUMN_RATIOS, ELEMENTS, getColumnCount, getDefaultRatios, MIN_COLUMNS, RATIOS_ATTRIBUTE
} from "./constants.js";

/**
 * Inserts a layout with two equal columns at the selection. Selected content moves into the first
 * column, and the caret goes to the end of that column.
 */
export class InsertMulticolumnLayoutCommand extends Command {

    public override refresh(): void {
        const model = this.editor.model;
        const position = model.document.selection.getFirstPosition();
        this.isEnabled = !!position && !!model.schema.findAllowedParent(position, ELEMENTS.layout);
    }

    public override execute(): void {
        const model = this.editor.model;
        const selection = model.document.selection;

        model.change(writer => {
            const content = selection.isCollapsed ? null : model.getSelectedContent(selection);
            const layout = writer.createElement(ELEMENTS.layout, {
                [RATIOS_ATTRIBUTE]: getDefaultRatios(MIN_COLUMNS)
            });
            const firstColumn = createColumn(writer);
            writer.append(firstColumn, layout);
            writer.append(createColumn(writer), layout);

            model.insertObject(layout);
            if (content) {
                model.insertContent(content, writer.createRangeIn(firstColumn));
            }
            writer.setSelection(firstColumn, "end");
        });
    }
}

/**
 * Sets the column weights of the selected layout. For more columns, empty columns are added at the
 * end. For fewer columns, the last columns are merged into the last remaining one.
 */
export class ColumnLayoutCommand extends Command {

    declare public value: string | undefined;

    public override refresh(): void {
        const layout = getSelectedLayout(this.editor);
        this.isEnabled = !!layout;
        this.value = layout?.getAttribute(RATIOS_ATTRIBUTE) as string | undefined;
    }

    public override execute({ value }: { value: string }): void {
        const layout = getSelectedLayout(this.editor);
        if (!layout || !COLUMN_RATIOS.includes(value)) {
            return;
        }

        this.editor.model.change(writer => {
            setColumnCount(writer, layout, getColumnCount(value));
            writer.setAttribute(RATIOS_ATTRIBUTE, value, layout);
        });
    }
}

/**
 * Replaces the selected layout with the content of its columns, one column after another. Empty
 * columns add nothing, and a layout with only empty columns leaves one empty paragraph.
 */
export class RemoveMulticolumnLayoutCommand extends Command {

    public override refresh(): void {
        this.isEnabled = !!getSelectedLayout(this.editor);
    }

    public override execute(): void {
        const layout = getSelectedLayout(this.editor);
        /* v8 ignore next 3 -- execute() runs only while refresh() keeps the command enabled */
        if (!layout) {
            return;
        }

        this.editor.model.change(writer => {
            const columns = [...layout.getChildren()] as ModelElement[];
            const filled = columns.filter(hasContent);
            for (const column of filled.length ? filled : columns.slice(0, 1)) {
                writer.move(writer.createRangeIn(column), writer.createPositionBefore(layout));
            }
            writer.remove(layout);
        });
    }
}

/**
 * Returns the selected layout, or the innermost layout that contains the selection.
 */
export function getSelectedLayout(editor: Editor): ModelElement | null {
    const selection = editor.model.document.selection;
    const selected = selection.getSelectedElement();
    if (selected?.is("element", ELEMENTS.layout)) {
        return selected;
    }
    return selection.getFirstPosition()?.findAncestor(ELEMENTS.layout) ?? null;
}

/**
 * Appends empty columns to `layout`, or merges its last columns into the column before them, until
 * it has `count` columns.
 */
export function setColumnCount(writer: ModelWriter, layout: ModelElement, count: number) {
    while (layout.childCount < count) {
        writer.append(createColumn(writer), layout);
    }
    while (layout.childCount > count) {
        const last = layout.getChild(layout.childCount - 1) as ModelElement;
        mergeColumn(writer, last, last.previousSibling as ModelElement);
    }
}

function createColumn(writer: ModelWriter): ModelElement {
    const column = writer.createElement(ELEMENTS.column);
    writer.appendElement("paragraph", column);
    return column;
}

/**
 * Moves the content of `from` to the end of `to` and removes `from`. A column with only an empty
 * paragraph counts as empty, so a merge adds no blank line.
 */
function mergeColumn(writer: ModelWriter, from: ModelElement, to: ModelElement) {
    if (hasContent(from)) {
        const placeholder = hasContent(to) ? null : to.getChild(0);
        writer.move(writer.createRangeIn(from), writer.createPositionAt(to, "end"));
        if (placeholder) {
            writer.remove(placeholder);
        }
    }
    writer.remove(from);
}

function hasContent(column: ModelElement) {
    const first = column.getChild(0);
    if (!first) {
        return false;
    }
    return column.childCount > 1 || !first.is("element", "paragraph") || !first.isEmpty;
}
