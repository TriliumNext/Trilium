import { Command, Plugin, Table, TableClipboard, TableUtils, TableWalker } from "ckeditor5";
import type { Editor, ModelInsertContentEvent } from "ckeditor5";

import CutToNotePlugin from "./cuttonote.js";
import { splitIntoGroups } from "./table_move/table_move_groups.js";

/**
 * Registers `triliumPasteTableRowsAbove` and `triliumPasteTableRowsBelow`, which paste clipboard
 * content as new rows next to the row of the selection instead of over its cells.
 */
export default class TablePasteRows extends Plugin {

    static get requires() {
        return [CutToNotePlugin, Table, TableUtils] as const;
    }

    static get pluginName() {
        return "TablePasteRows" as const;
    }

    init() {
        const editor = this.editor;
        editor.commands.add("triliumPasteTableRowsAbove",
            new TablePasteRowsCommand(editor, "above"));
        editor.commands.add("triliumPasteTableRowsBelow",
            new TablePasteRowsCommand(editor, "below"));
    }

}

/** The two clipboard flavors {@link TablePasteRowsCommand} pastes. */
export interface TablePasteRowsOptions {
    html: string;
    text: string;
}

/**
 * Pastes clipboard content as new rows next to the row of the selection, and selects them.
 * Enabled while the selection is in a single row.
 */
export class TablePasteRowsCommand extends Command {

    private readonly direction: "above" | "below";

    constructor(editor: Editor, direction: "above" | "below") {
        super(editor);
        this.direction = direction;
    }

    refresh() {
        const tableUtils = this.editor.plugins.get(TableUtils);
        const selection = this.editor.model.document.selection;
        const cells = tableUtils.getSelectionAffectedTableCells(selection);
        if (!cells.length) {
            this.isEnabled = false;
            return;
        }

        const { first, last } = tableUtils.getRowIndexes(cells);
        this.isEnabled = first === last;
    }

    execute({ html, text }: TablePasteRowsOptions) {
        const editor = this.editor;
        const model = editor.model;
        const tableUtils = editor.plugins.get(TableUtils);
        const cells = tableUtils.getSelectionAffectedTableCells(model.document.selection);
        const table = cells[0]?.findAncestor("table");
        /* v8 ignore next 3 -- defensive: disabled whenever the selection is outside a table */
        if (!table) {
            return;
        }

        // The new rows go outside the block of rows that merged cells join to this one.
        const [group] = splitIntoGroups(table, "row", tableUtils.getRowIndexes(cells));
        const at = this.direction === "above" ? group.first : group.last + 1;
        let insertedRows = 0;

        // Runs ahead of `TableClipboard`, which then pastes a table into the new rows from the
        // caret in their first cell, adding columns when the pasted table is wider.
        const onInsertContent = (_evt: unknown, [content]: ModelInsertContentEvent["args"][0]) => {
            if (insertedRows > 0) {
                return;
            }

            const pastedTable = editor.plugins.get(TableClipboard)
                .getTableIfOnlyTableInContent(content, model);
            insertedRows = pastedTable ? tableUtils.getRows(pastedTable) : 1;
            model.change((writer) => {
                tableUtils.insertRows(table, { at, rows: insertedRows });
                const [firstSlot] = new TableWalker(table, { row: at });
                const caret = model.schema
                    .getNearestSelectionRange(writer.createPositionAt(firstSlot.cell, 0));
                writer.setSelection(caret);
            });
        };

        this.listenTo<ModelInsertContentEvent>(model, "insertContent", onInsertContent,
            { priority: "highest" });
        try {
            editor.pasteContent(html, text);
        } finally {
            this.stopListening(model, "insertContent", onInsertContent);
        }

        if (insertedRows > 0) {
            const rows = new TableWalker(table, { startRow: at, endRow: at + insertedRows - 1 });
            model.change((writer) => {
                writer.setSelection(Array.from(rows, ({ cell }) => writer.createRangeOn(cell)));
            });
        }
    }

}

declare module "ckeditor5" {
    interface PluginsMap {
        [TablePasteRows.pluginName]: TablePasteRows;
    }

    interface CommandsMap {
        triliumPasteTableRowsAbove: TablePasteRowsCommand;
        triliumPasteTableRowsBelow: TablePasteRowsCommand;
    }
}
