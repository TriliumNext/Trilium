import {
    _getElementWidthInPixels as getElementWidthInPixels,
    _getTableColumnsWidths as getTableColumnsWidths,
    _getTableWidthInPixels as getTableWidthInPixels,
    _toPrecision as toPrecision,
    Command,
    TableUtils,
    TableWalker,
    TableWidthsCommand
} from "ckeditor5";
import type { Editor, ModelElement } from "ckeditor5";

import type { IndexRange } from "./table_move/table_move_groups.js";

/**
 * Gives the columns touched by the selection an equal share of their combined width. The other
 * columns and the table width stay as they are. Enabled when the selection spans at least two
 * columns of one table.
 *
 * The widths are written through the `resizeColumnWidths` command of `TableColumnResize`, so a
 * table that was never resized gets the same `tableColumnGroup` and `tableWidth` a first drag of a
 * column border would give it.
 */
export class DistributeTableColumnsCommand extends Command {

    override refresh() {
        this.isEnabled = this.findTarget() !== null;
    }

    override execute() {
        const target = this.findTarget();
        const resize = this.editor.commands.get("resizeColumnWidths");
        /* v8 ignore next 3 -- defensive: disabled without a target; requires TableColumnResize */
        if (!target || !(resize instanceof TableWidthsCommand)) {
            return;
        }

        const { table, columns } = target;
        const current = readColumnWidths(this.editor, table);
        if (!current) {
            return;
        }

        const widths = equalizeWidths(current.values, columns);
        resize.execute({
            table,
            tableWidth: current.tableWidth,
            columnWidths: widths.map((width) => `${width}${current.unit}`)
        });
    }

    private findTarget(): { table: ModelElement; columns: IndexRange } | null {
        const tableUtils = this.editor.plugins.get(TableUtils);
        const selection = this.editor.model.document.selection;
        const cells = tableUtils.getSelectionAffectedTableCells(selection);
        const table = cells[0]?.findAncestor("table");
        if (!table) {
            return null;
        }

        const columns = getSpannedColumns(table, cells);
        return columns.last > columns.first ? { table, columns } : null;
    }

}

/**
 * The columns covered by `cells`, including every column a merged cell spans.
 * `TableUtils.getColumnIndexes()` only reports the column each cell starts in.
 */
function getSpannedColumns(table: ModelElement, cells: readonly ModelElement[]): IndexRange {
    const selected = new Set(cells);
    let first = Infinity;
    let last = -1;

    for (const slot of new TableWalker(table)) {
        if (selected.has(slot.cell)) {
            first = Math.min(first, slot.column);
            last = Math.max(last, slot.column + slot.cellWidth - 1);
        }
    }

    return { first, last };
}

/**
 * Replaces the widths in `range` (inclusive) with their average, rounded like the widths
 * `TableColumnResize` stores. The last column of the range takes the rounding remainder, so the
 * range keeps its total.
 */
export function equalizeWidths(widths: readonly number[], range: IndexRange): number[] {
    const { first, last } = range;
    const count = last - first + 1;
    const total = widths.slice(first, last + 1).reduce((sum, width) => sum + width, 0);
    const share = toPrecision(total / count);

    return widths.map((width, index) => {
        if (index < first || index > last) {
            return width;
        }
        return index === last ? toPrecision(total - share * (count - 1)) : share;
    });
}

type WidthUnit = "%" | "px";

interface ColumnWidths {
    values: number[];
    unit: WidthUnit;
    tableWidth: string | undefined;
}

/**
 * Reads the width of every column of `table`: from its `tableColumnGroup` when that holds one
 * width per column in a single unit, otherwise from the rendered cells. Returns `null` when the
 * table is not rendered with a measurable width.
 */
function readColumnWidths(editor: Editor, table: ModelElement): ColumnWidths | null {
    const columnCount = editor.plugins.get(TableUtils).getColumns(table);
    const tableWidthAttribute = table.getAttribute("tableWidth");
    const tableWidth = typeof tableWidthAttribute === "string" ? tableWidthAttribute : undefined;

    const stored = getTableColumnsWidths(table);
    const parsed = stored.length === columnCount ? parseUniformWidths(stored) : null;
    if (parsed) {
        return { ...parsed, tableWidth };
    }

    const measured = measureColumnWidths(editor, table, columnCount);
    if (!measured) {
        return null;
    }
    const measuredTotal = measured.reduce((sum, width) => sum + width, 0);

    if (tableWidth?.trim().endsWith("px")) {
        const scale = parseFloat(tableWidth) / measuredTotal;
        return {
            values: measured.map((width) => toPrecision(width * scale)),
            unit: "px",
            tableWidth
        };
    }

    const resolvedTableWidth = tableWidth ?? measureTableWidthShare(editor, table);
    if (!resolvedTableWidth) {
        return null;
    }
    return {
        values: measured.map((width) => toPrecision(width / measuredTotal * 100)),
        unit: "%",
        tableWidth: resolvedTableWidth
    };
}

/** Parses widths such as `"25%"` or `"120px"`; returns `null` unless all share one unit. */
function parseUniformWidths(widths: string[]): { values: number[]; unit: WidthUnit } | null {
    const values: number[] = [];
    let unit: WidthUnit | null = null;

    for (const width of widths) {
        const match = /^\s*(\d+(?:\.\d+)?)(%|px)\s*$/.exec(width);
        if (!match || (unit && match[2] !== unit)) {
            return null;
        }
        unit = match[2] as WidthUnit;
        values.push(parseFloat(match[1]));
    }

    return unit && { values, unit };
}

/**
 * Measures the rendered width of every column in pixels from the edges of the cells that start or
 * end at each column boundary. A boundary that no cell starts or ends at, because merged cells
 * cross it in every row, is placed proportionally between its nearest measured neighbors.
 * Returns `null` when the table is not rendered with a width, e.g. inside a hidden element.
 */
function measureColumnWidths(
    editor: Editor,
    table: ModelElement,
    columnCount: number
): number[] | null {
    const isRtl = editor.locale.contentLanguageDirection === "rtl";
    const edgeSamples: number[][] = Array.from({ length: columnCount + 1 }, () => []);

    for (const slot of new TableWalker(table)) {
        const viewCell = editor.editing.mapper.toViewElement(slot.cell);
        const domCell = viewCell && editor.editing.view.domConverter.mapViewToDom(viewCell);
        /* v8 ignore next 3 -- defensive: every model cell of a rendered table maps to a DOM cell */
        if (!(domCell instanceof HTMLElement)) {
            continue;
        }

        const rect = domCell.getBoundingClientRect();
        edgeSamples[slot.column].push(isRtl ? -rect.right : rect.left);
        edgeSamples[slot.column + slot.cellWidth].push(isRtl ? -rect.left : rect.right);
    }

    const measured = edgeSamples.map((samples) => samples.length
        ? samples.reduce((sum, value) => sum + value, 0) / samples.length
        : null);
    const firstEdge = measured[0];
    /* v8 ignore next 3 -- defensive: the first and the last boundary always have a cell edge */
    if (firstEdge === null || measured[columnCount] === null) {
        return null;
    }

    const edges = [firstEdge];
    let previous = 0;
    for (let boundary = 1; boundary <= columnCount; boundary++) {
        const edge = measured[boundary];
        if (edge === null) {
            continue;
        }
        for (let missing = previous + 1; missing < boundary; missing++) {
            const ratio = (missing - previous) / (boundary - previous);
            edges[missing] = edges[previous] + (edge - edges[previous]) * ratio;
        }
        edges[boundary] = edge;
        previous = boundary;
    }

    const widths: number[] = [];
    for (let column = 0; column < columnCount; column++) {
        widths.push(Math.max(0, edges[column + 1] - edges[column]));
    }
    return widths.some((width) => width > 0) ? widths : null;
}

/**
 * The rendered width of `table` as a percentage of its container, the value `TableColumnResize`
 * stores as `tableWidth` when a table is resized for the first time.
 */
function measureTableWidthShare(editor: Editor, table: ModelElement): string | null {
    const viewFigure = editor.editing.mapper.toViewElement(table);
    const domFigure = viewFigure && editor.editing.view.domConverter.mapViewToDom(viewFigure);
    const domParent = domFigure?.parentElement;
    /* v8 ignore next 3 -- defensive: a measured table is rendered inside the editable */
    if (!(domFigure instanceof HTMLElement) || !domParent) {
        return null;
    }

    const parentWidth = getElementWidthInPixels(domParent);
    if (!(parentWidth > 0)) {
        return null;
    }

    const tableWidth = getTableWidthInPixels(table, editor);
    const width = Math.max(tableWidth, getElementWidthInPixels(domFigure));
    return `${toPrecision(width / parentWidth * 100)}%`;
}
