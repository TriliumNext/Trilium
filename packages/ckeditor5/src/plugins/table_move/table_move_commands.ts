import { Command, ModelLiveRange, TableUtils, TableWalker } from "ckeditor5";
import type { Editor, ModelDocumentSelection, ModelElement, ModelPosition, ModelWriter } from "ckeditor5";

import { adjustedHeadingCount, planGroupMove } from "./table_move_groups.js";
import type { GroupMovePlan, IndexRange, TableAxis } from "./table_move_groups.js";

interface PlannedMove {
    table: ModelElement;
    plan: GroupMovePlan;
}

/**
 * Moves the span group of rows or columns touched by the selection over the adjacent group
 * (see `planGroupMove`). Enabled only when the selection is in a table and such a target exists,
 * so the commands can back menu items directly.
 */
abstract class MoveTableGroupCommand extends Command {

    protected readonly isForward: boolean;
    protected abstract readonly axis: TableAxis;

    constructor(editor: Editor, isForward: boolean) {
        super(editor);
        this.isForward = isForward;
    }

    override refresh() {
        this.isEnabled = this.planMove() !== null;
    }

    override execute() {
        const planned = this.planMove();
        if (!planned) {
            return;
        }

        const model = this.editor.model;
        const selectionRanges = [...model.document.selection.getRanges()]
            .map((range) => ModelLiveRange.fromRange(range));

        model.change((writer) => {
            this.applyMove(writer, planned.table, planned.plan);
            writer.setSelection(selectionRanges.map((range) => range.toRange()));
        });

        for (const range of selectionRanges) {
            range.detach();
        }

        this.editor.editing.view.focus();
        this.editor.editing.view.scrollToTheSelection();
    }

    protected abstract applyMove(writer: ModelWriter, table: ModelElement, plan: GroupMovePlan): void;

    protected updateHeadingCount(
        writer: ModelWriter,
        table: ModelElement,
        attribute: "headingRows" | "headingColumns",
        plan: GroupMovePlan
    ) {
        const heading = Number(table.getAttribute(attribute) ?? 0);
        const adjusted = adjustedHeadingCount(heading, plan, this.isForward);
        if (adjusted === heading) {
            return;
        }

        if (adjusted > 0) {
            writer.setAttribute(attribute, adjusted, table);
        } else {
            writer.removeAttribute(attribute, table);
        }
    }

    private planMove(): PlannedMove | null {
        const tableUtils = this.editor.plugins.get(TableUtils);
        const cells = tableUtils.getSelectionAffectedTableCells(this.editor.model.document.selection);
        const table = cells[0]?.findAncestor("table");
        if (!table) {
            return null;
        }

        const selected = this.axis === "row"
            ? tableUtils.getRowIndexes(cells)
            : tableUtils.getColumnIndexes(cells);
        const plan = planGroupMove(table, this.axis, selected, this.isForward);
        return plan && { table, plan };
    }

}

export class MoveTableRowCommand extends MoveTableGroupCommand {

    protected readonly axis = "row";

    constructor(editor: Editor, direction: "up" | "down") {
        super(editor, direction === "down");
    }

    protected applyMove(writer: ModelWriter, table: ModelElement, plan: GroupMovePlan) {
        const rows = [...table.getChildren()]
            .filter((child): child is ModelElement => child.is("element", "tableRow"));

        const movedRows = writer.createRange(
            writer.createPositionBefore(rows[plan.source.first]),
            writer.createPositionAfter(rows[plan.source.last])
        );
        const insertAt = this.isForward
            ? writer.createPositionAfter(rows[plan.target.last])
            : writer.createPositionBefore(rows[plan.target.first]);

        writer.move(movedRows, insertAt);
        this.updateHeadingCount(writer, table, "headingRows", plan);
    }

}

export class MoveTableColumnCommand extends MoveTableGroupCommand {

    protected readonly axis = "column";

    constructor(editor: Editor, direction: "left" | "right") {
        super(editor, direction === "right");
    }

    protected applyMove(writer: ModelWriter, table: ModelElement, plan: GroupMovePlan) {
        const left = this.isForward ? plan.source : plan.target;
        const right = this.isForward ? plan.target : plan.source;

        // Swapping the adjacent groups is one operation per row: the right group's anchored
        // cells land where the left group starts. Positions are collected before any move so
        // the walker never iterates a half-changed table.
        const insertPositions = new Map<number, ModelPosition>();
        const movedCells = new Map<number, ModelElement[]>();
        const walker = new TableWalker(table, {
            startColumn: left.first,
            endColumn: right.last,
            includeAllSlots: true
        });
        for (const slot of walker) {
            if (slot.column === left.first) {
                insertPositions.set(slot.row, slot.getPositionBefore());
            }
            if (slot.isAnchor && slot.column >= right.first) {
                const cells = movedCells.get(slot.row) ?? [];
                cells.push(slot.cell);
                movedCells.set(slot.row, cells);
            }
        }

        for (const [row, cells] of movedCells) {
            const insertAt = insertPositions.get(row);
            const movedFrom = writer.createPositionBefore(cells[0]);
            /* v8 ignore next 3 -- includeAllSlots yields a slot at every column, so the position always exists */
            if (!insertAt) {
                continue;
            }
            // A row whose left-group slots are all covered by rowspans from earlier rows keeps
            // its child order; the covering cells move within their own anchor rows.
            if (insertAt.isEqual(movedFrom)) {
                continue;
            }
            writer.move(
                writer.createRange(movedFrom, writer.createPositionAfter(cells[cells.length - 1])),
                insertAt
            );
        }

        moveColumnWidths(writer, table, left, right);
        this.updateHeadingCount(writer, table, "headingColumns", plan);
    }

}

/** Whether the document selection is inside a table. */
export function isSelectionInTable(selection: ModelDocumentSelection): boolean {
    return !!selection.getFirstPosition()?.findAncestor("table");
}

/**
 * Mirrors a column-group swap on the `tableColumn` elements kept by `TableColumnResize`, so
 * every column keeps its width. Tables that were never resized have no `tableColumnGroup`.
 */
function moveColumnWidths(writer: ModelWriter, table: ModelElement, left: IndexRange, right: IndexRange) {
    const columnGroup = [...table.getChildren()]
        .find((child): child is ModelElement => child.is("element", "tableColumnGroup"));
    if (!columnGroup) {
        return;
    }

    const widths: string[] = [];
    for (const column of columnGroup.getChildren()) {
        const span = Number(column.getAttribute("colSpan") ?? 1);
        for (let i = 0; i < span; i++) {
            widths.push(String(column.getAttribute("columnWidth")));
        }
    }
    /* v8 ignore next 3 -- defensive: TableColumnResize's post-fixer keeps one entry per column whenever the group exists */
    if (widths.length <= right.last) {
        return;
    }

    const reordered = [
        ...widths.slice(0, left.first),
        ...widths.slice(right.first, right.last + 1),
        ...widths.slice(left.first, right.first),
        ...widths.slice(right.last + 1)
    ];
    writer.remove(writer.createRangeIn(columnGroup));
    for (const width of reordered) {
        writer.insertElement("tableColumn", { columnWidth: width }, columnGroup, "end");
    }
}
