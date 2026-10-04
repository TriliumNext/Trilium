import { autoSort } from "@triliumnext/commons";
import {
    Command,
    Notification,
    Plugin,
    Table,
    TableUtils,
    TableWalker
} from "ckeditor5";
import type { Editor, Model, ModelElement, ModelPosition, ModelWriter } from "ckeditor5";

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
        const sorted = autoSort(groups, (group) => group.text, {
            locale: editor.locale.contentLanguage,
            isDescending: this.isDescending,
            dateFormats: editor.config.get("autoSort")?.dateFormats
        });

        if (sorted.some((group, index) => group !== groups[index])) {
            this.applyOrder(plan.table, plan.groups[0].first, sorted.map((group) => group.range));
        }

        if (groups.some((group) => group.isTied)) {
            const t = editor.t;
            editor.plugins.get(Notification).showInfo(
                t("Some rows were sorted together because merged cells tie them to each other"));
        }
    }

    /** Moves the row groups into `order`, starting at row `firstIndex`, in one undo step. */
    private applyOrder(table: ModelElement, firstIndex: number, order: IndexRange[]) {
        const model = this.editor.model;
        const rows = [...table.getChildren()]
            .filter((child): child is ModelElement => child.is("element", "tableRow"));
        const firstRow = rows[firstIndex];

        // The selection ranges are live, so they follow the moved rows.
        model.change((writer) => {
            let previous: ModelElement | null = null;
            for (const range of order) {
                const insertAt = previous
                    ? writer.createPositionAfter(previous)
                    : writer.createPositionBefore(firstRow);
                moveRows(writer, rows[range.first], rows[range.last], insertAt);
                previous = rows[range.last];
            }
        });
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
        text: cellText(model, cellsByRow[range.first]),
        isTied: new Set(cellsByRow.slice(range.first, range.last + 1)).size > 1
    }));
}

/** The plain text of a cell. Elements such as paragraphs and line breaks become spaces. */
function cellText(model: Model, cell: ModelElement): string {
    let text = "";
    for (const item of model.createRangeIn(cell).getItems()) {
        text += item.is("$textProxy") ? item.data : " ";
    }
    return text;
}

function moveRows(
    writer: ModelWriter,
    firstRow: ModelElement,
    lastRow: ModelElement,
    insertAt: ModelPosition
) {
    const start = writer.createPositionBefore(firstRow);
    if (!start.isEqual(insertAt)) {
        writer.move(writer.createRange(start, writer.createPositionAfter(lastRow)), insertAt);
    }
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
