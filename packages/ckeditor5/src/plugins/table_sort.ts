import {
    Command,
    Notification,
    Plugin,
    Table,
    TableUtils,
    TableWalker
} from "ckeditor5";
import type { Editor, Model, ModelElement } from "ckeditor5";

import { blockText, sortRuns } from "./sort_selection/sort_runs.js";
import { splitIntoGroups } from "./table_move/table_move_groups.js";
import type { IndexRange } from "./table_move/table_move_groups.js";

/**
 * Sorts the body rows of a table by the column of the selection, with `autoSort`. A caret sorts
 * every body row; a cell selection in one column sorts the selected rows. Header and footer rows
 * never move, and rows tied together by merged cells move as one group.
 */
export default class TableSort extends Plugin {

    static get requires() {
        return [Table, TableUtils, Notification] as const;
    }

    static get pluginName() {
        return "TableSort" as const;
    }

    init() {
        const editor = this.editor;
        editor.commands.add("triliumSortTableRowsAscending",
            new SortTableRowsCommand(editor, false));
        editor.commands.add("triliumSortTableRowsDescending",
            new SortTableRowsCommand(editor, true));
    }

}

interface SortPlan {
    table: ModelElement;
    column: number;
    groups: IndexRange[];
}

interface RowGroup {
    range: IndexRange;
    text: string;
    isTied: boolean;
}

export class SortTableRowsCommand extends Command {

    private readonly isDescending: boolean;

    constructor(editor: Editor, isDescending: boolean) {
        super(editor);
        this.isDescending = isDescending;
    }

    override refresh() {
        this.isEnabled = this.planSort() !== null;
    }

    override execute() {
        const plan = this.planSort();
        if (!plan) {
            return;
        }

        const editor = this.editor;
        const groups = readGroups(editor.model, plan);
        const rows = [...plan.table.getChildren()]
            .filter((child): child is ModelElement => child.is("element", "tableRow"));
        // The selection ranges are live, so they follow the moved rows.
        sortRuns(editor, groups.map(({ range, text }) => ({
            first: rows[range.first],
            last: rows[range.last],
            text
        })), this.isDescending);

        if (groups.some((group) => group.isTied)) {
            const t = editor.t;
            editor.plugins.get(Notification).showInfo(
                t("Some rows were sorted together because merged cells tie them to each other"));
        }
    }

    private planSort(): SortPlan | null {
        const editor = this.editor;
        const tableUtils = editor.plugins.get(TableUtils);
        const selection = editor.model.document.selection;
        const cells = tableUtils.getSelectionAffectedTableCells(selection);
        const table = cells[0]?.findAncestor("table");
        if (!table) {
            return null;
        }

        const columns = tableUtils.getColumnIndexes(cells);
        if (columns.first !== columns.last) {
            return null;
        }

        const footerRows = Number(table.getAttribute("footerRows") ?? 0);
        const bodyFirst = Number(table.getAttribute("headingRows") ?? 0);
        const bodyLast = tableUtils.getRows(table) - footerRows - 1;
        const isCellSelection = tableUtils.getSelectedTableCells(selection).length > 1;
        const selected = isCellSelection ? tableUtils.getRowIndexes(cells) : null;
        const first = Math.max(selected?.first ?? bodyFirst, bodyFirst);
        const last = Math.min(selected?.last ?? bodyLast, bodyLast);
        if (first > last) {
            return null;
        }

        // The table post-fixer keeps merged cells inside the header, body or footer, so every
        // group lies inside the body.
        const groups = splitIntoGroups(table, "row", { first, last });
        return groups.length > 1 ? { table, column: columns.first, groups } : null;
    }

}

/**
 * Reads the text each group sorts by: the cell of its first row in the sort column. A group is tied
 * when the column has more than one cell in it.
 */
function readGroups(model: Model, { table, column, groups }: SortPlan): RowGroup[] {
    // The table post-fixer fills short rows, so every row has a slot in the column.
    const cellsByRow: ModelElement[] = [];
    const walker = new TableWalker(table, {
        startRow: groups[0].first,
        endRow: groups[groups.length - 1].last,
        includeAllSlots: true
    });
    for (const slot of walker) {
        if (slot.column === column) {
            cellsByRow[slot.row] = slot.cell;
        }
    }

    return groups.map((range) => ({
        range,
        text: blockText(model, cellsByRow[range.first]),
        isTied: new Set(cellsByRow.slice(range.first, range.last + 1)).size > 1
    }));
}

declare module "ckeditor5" {
    interface PluginsMap {
        [TableSort.pluginName]: TableSort;
    }

    interface CommandsMap {
        triliumSortTableRowsAscending: SortTableRowsCommand;
        triliumSortTableRowsDescending: SortTableRowsCommand;
    }
}
