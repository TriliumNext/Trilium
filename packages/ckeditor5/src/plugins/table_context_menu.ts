import {
    Command,
    MouseObserver,
    Plugin,
    Table,
    TableColumnResize,
    TableSelection,
    TableUtils,
    TableWalker
} from "ckeditor5";
import type { Editor, ModelElement, ViewDocumentMouseDownEvent } from "ckeditor5";

import { DistributeTableColumnsCommand } from "./table_distribute_columns.js";

/**
 * Editor-side support for the client's table context menu.
 *
 * Registers insert commands that honor the size of the current selection (the upstream
 * `insertTableRow*` / `insertTableColumn*` commands always insert one row or column) and
 * `triliumDistributeTableColumns`, keeps a multi-cell selection alive under a right-click, and
 * moves the selection to the cell a context menu is opened on. Merge, split and delete need no
 * counterparts here: the upstream `mergeTableCells`, `splitTableCell*` and `removeTableRow` /
 * `removeTableColumn` commands already act on the whole selection.
 */
export default class TableContextMenu extends Plugin {

    static get requires() {
        return [Table, TableColumnResize, TableSelection, TableUtils] as const;
    }

    static get pluginName() {
        return "TableContextMenu" as const;
    }

    init() {
        const editor = this.editor;

        editor.commands.add("triliumInsertTableRowsAbove",
            new TableMultiInsertCommand(editor, "above"));
        editor.commands.add("triliumInsertTableRowsBelow",
            new TableMultiInsertCommand(editor, "below"));
        editor.commands.add("triliumInsertTableColumnsLeft",
            new TableMultiInsertCommand(editor, "left"));
        editor.commands.add("triliumInsertTableColumnsRight",
            new TableMultiInsertCommand(editor, "right"));
        editor.commands.add("triliumDistributeTableColumns",
            new DistributeTableColumnsCommand(editor));
        editor.commands.add("triliumDeleteTable", new DeleteTableCommand(editor));
        editor.commands.add("triliumResetTableCellSpans", new ResetTableCellSpansCommand(editor));
        editor.commands.add("triliumSelectTable", new SelectTableCommand(editor));
        editor.commands.add("triliumSetTableHeaderRow",
            new TableHeaderRowsCommand(editor, "firstRows"));
        editor.commands.add("triliumSetTableHeaderUpToRow",
            new TableHeaderRowsCommand(editor, "laterRow"));

        const view = editor.editing.view;
        view.addObserver(MouseObserver);
        this.listenTo<ViewDocumentMouseDownEvent>(view.document, "mousedown", (evt, data) => {
            // Stops the caret move that would collapse a multi-cell selection before the
            // `contextmenu` event fires.
            const isRightButton = data.domEvent.button === RIGHT_MOUSE_BUTTON;
            if (isRightButton && this.isInsideCellSelection(data.domTarget)) {
                data.preventDefault();
            }
        }, { priority: "high" });
    }

    /**
     * Moves the model selection into the table cell containing `domTarget`, so commands run
     * against the cell the context menu is opened on. A target inside the current selection keeps
     * that selection. Returns `false` when the target is not in a table cell of this editor.
     */
    syncSelectionToDomTarget(domTarget: Node): boolean {
        const editor = this.editor;
        const modelCell = resolveModelCell(editor, domTarget);
        if (!modelCell) {
            return false;
        }

        const tableUtils = editor.plugins.get(TableUtils);
        const selection = editor.model.document.selection;
        if (!tableUtils.getSelectionAffectedTableCells(selection).includes(modelCell)) {
            editor.model.change((writer) => {
                writer.setSelection(writer.createPositionAt(modelCell, 0));
            });
        }

        return true;
    }

    /** Whether `domTarget` sits in one of the cells the selection covers from the outside. */
    private isInsideCellSelection(domTarget: Node): boolean {
        const editor = this.editor;
        const modelCell = resolveModelCell(editor, domTarget);
        if (!modelCell) {
            return false;
        }

        const tableUtils = editor.plugins.get(TableUtils);
        return tableUtils.getSelectedTableCells(editor.model.document.selection).includes(modelCell);
    }

}

const RIGHT_MOUSE_BUTTON = 2;

/** Where {@link TableMultiInsertCommand} inserts, relative to the rows or columns it spans. */
export type TableMultiInsertDirection = "above" | "below" | "left" | "right";

/**
 * Inserts as many rows or columns as the selection spans, next to the spanned block.
 */
export class TableMultiInsertCommand extends Command {

    private readonly direction: TableMultiInsertDirection;

    constructor(editor: Editor, direction: TableMultiInsertDirection) {
        super(editor);
        this.direction = direction;
    }

    refresh() {
        const tableUtils = this.editor.plugins.get(TableUtils);
        const selection = this.editor.model.document.selection;
        this.isEnabled = tableUtils.getSelectionAffectedTableCells(selection).length > 0;
    }

    execute() {
        const tableUtils = this.editor.plugins.get(TableUtils);
        const selection = this.editor.model.document.selection;
        const cells = tableUtils.getSelectionAffectedTableCells(selection);
        const table = cells[0]?.findAncestor("table");
        /* v8 ignore next 3 -- defensive: disabled whenever the selection is outside a table */
        if (!table) {
            return;
        }

        if (this.direction === "above" || this.direction === "below") {
            const { first, last } = tableUtils.getRowIndexes(cells);
            const insertAbove = this.direction === "above";
            tableUtils.insertRows(table, {
                at: insertAbove ? first : last + 1,
                rows: last - first + 1,
                copyStructureFromAbove: !insertAbove
            });
        } else {
            const { first, last } = tableUtils.getColumnIndexes(cells);
            tableUtils.insertColumns(table, {
                at: this.direction === "left" ? first : last + 1,
                columns: last - first + 1
            });
        }
    }

}

/**
 * Deletes the table the selection is in, the innermost one when tables are nested. The table is
 * replaced by an empty paragraph holding the caret, as when a selected table is deleted with the
 * Delete key.
 */
export class DeleteTableCommand extends Command {

    refresh() {
        this.isEnabled = findSelectionTable(this.editor) !== null;
    }

    execute() {
        const table = findSelectionTable(this.editor);
        /* v8 ignore next 3 -- defensive: disabled whenever the selection is outside a table */
        if (!table) {
            return;
        }

        const model = this.editor.model;
        model.change((writer) => {
            const selection = writer.createSelection(table, "on");
            model.deleteContent(selection);
            writer.setSelection(selection);
        });
    }

}

/**
 * The selections a {@link TableHeaderRowsCommand} acts on: rows starting at the first row of the
 * table, or a single row below it.
 */
export type TableHeaderRowsScope = "firstRows" | "laterRow";

/**
 * Toggles the heading rows through the upstream `setTableRowHeader`, for the selections of its
 * `scope`. `value` is `true` while every selected row is a heading row.
 */
export class TableHeaderRowsCommand extends Command {

    private readonly scope: TableHeaderRowsScope;

    constructor(editor: Editor, scope: TableHeaderRowsScope) {
        super(editor);
        this.scope = scope;
    }

    refresh() {
        const tableUtils = this.editor.plugins.get(TableUtils);
        const selection = this.editor.model.document.selection;
        const cells = tableUtils.getSelectionAffectedTableCells(selection);
        const table = cells[0]?.findAncestor("table");
        if (!table) {
            this.isEnabled = false;
            this.value = false;
            return;
        }

        const { first, last } = tableUtils.getRowIndexes(cells);
        this.isEnabled = this.scope === "firstRows"
            ? first === 0
            : first === last && first > 0;
        this.value = this.isEnabled && last < Number(table.getAttribute("headingRows") ?? 0);
    }

    execute() {
        this.editor.execute("setTableRowHeader", { forceValue: !this.value });
    }

}

/**
 * Selects every cell of the table the selection is in, the innermost one when tables are nested.
 * Like `selectTableRow` and `selectTableColumn`, it stays enabled in read-only mode.
 */
export class SelectTableCommand extends Command {

    constructor(editor: Editor) {
        super(editor);
        this.affectsData = false;
    }

    refresh() {
        this.isEnabled = findSelectionTable(this.editor) !== null;
    }

    execute() {
        const table = findSelectionTable(this.editor);
        /* v8 ignore next 3 -- defensive: disabled whenever the selection is outside a table */
        if (!table) {
            return;
        }

        const model = this.editor.model;
        const ranges = Array.from(new TableWalker(table), ({ cell }) => model.createRangeOn(cell));
        model.change((writer) => {
            writer.setSelection(ranges);
        });
    }

}

/**
 * Splits every merged cell touched by the selection back into single cells, the reverse of a
 * merge. The content stays in the top-left cell; the others are created empty. Cells that are not
 * merged are left alone.
 */
export class ResetTableCellSpansCommand extends Command {

    refresh() {
        this.isEnabled = this.findMergedCells().length > 0;
    }

    execute() {
        const tableUtils = this.editor.plugins.get(TableUtils);
        const mergedCells = this.findMergedCells();

        // Splitting a cell into as many cells as it spans only redistributes the span, so the grid
        // keeps its size and the other cells stay where they are.
        this.editor.model.change(() => {
            for (const cell of mergedCells) {
                const colspan = getSpan(cell, "colspan");
                const rowspan = getSpan(cell, "rowspan");
                const rowCells = [cell];

                if (colspan > 1) {
                    tableUtils.splitCellVertically(cell, colspan);
                    let next = cell.nextSibling;
                    while (rowCells.length < colspan && next?.is("element", "tableCell")) {
                        rowCells.push(next);
                        next = next.nextSibling;
                    }
                }
                if (rowspan > 1) {
                    for (const rowCell of rowCells) {
                        tableUtils.splitCellHorizontally(rowCell, rowspan);
                    }
                }
            }
        });
    }

    private findMergedCells(): ModelElement[] {
        const tableUtils = this.editor.plugins.get(TableUtils);
        return tableUtils.getSelectionAffectedTableCells(this.editor.model.document.selection)
            .filter((cell) => getSpan(cell, "colspan") > 1 || getSpan(cell, "rowspan") > 1);
    }

}

/** The table the selection is in, the innermost one when tables are nested. */
function findSelectionTable(editor: Editor): ModelElement | null {
    const tableUtils = editor.plugins.get(TableUtils);
    const selection = editor.model.document.selection;
    return tableUtils.getSelectionAffectedTableCells(selection)[0]?.findAncestor("table") ?? null;
}

function getSpan(cell: ModelElement, attribute: "colspan" | "rowspan"): number {
    return Number(cell.getAttribute(attribute) ?? 1);
}

/** The model `tableCell` whose rendered cell contains `domTarget`, or `null` when there is none. */
function resolveModelCell(editor: Editor, domTarget: Node): ModelElement | null {
    const domElement = domTarget instanceof Element ? domTarget : domTarget.parentElement;
    const domCell = domElement?.closest<HTMLTableCellElement>("td, th");
    if (!domCell) {
        return null;
    }

    const viewCell = editor.editing.view.domConverter.mapDomToView(domCell);
    if (!viewCell?.is("element")) {
        return null;
    }

    const modelCell = editor.editing.mapper.toModelElement(viewCell);
    return modelCell?.is("element", "tableCell") ? modelCell : null;
}

declare module "ckeditor5" {
    interface PluginsMap {
        [TableContextMenu.pluginName]: TableContextMenu;
    }

    interface CommandsMap {
        triliumInsertTableRowsAbove: TableMultiInsertCommand;
        triliumInsertTableRowsBelow: TableMultiInsertCommand;
        triliumInsertTableColumnsLeft: TableMultiInsertCommand;
        triliumInsertTableColumnsRight: TableMultiInsertCommand;
        triliumDistributeTableColumns: DistributeTableColumnsCommand;
        triliumDeleteTable: DeleteTableCommand;
        triliumResetTableCellSpans: ResetTableCellSpansCommand;
        triliumSelectTable: SelectTableCommand;
        triliumSetTableHeaderRow: TableHeaderRowsCommand;
        triliumSetTableHeaderUpToRow: TableHeaderRowsCommand;
    }
}
