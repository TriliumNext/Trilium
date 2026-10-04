import { TableSelection } from "ckeditor5";
import type { ClassicEditor, ModelElement } from "ckeditor5";

/**
 * Table fixtures for the spec suite. `modelTable` builds table model markup the way the
 * upstream test helper does (that helper is not exported from the `ckeditor5` bundle),
 * including merged cells and table attributes:
 *
 * ```ts
 * modelTable([
 *     [{ contents: "a", rowspan: 2 }, "b"],
 *     ["c"]
 * ], 'headingRows="1"');
 * ```
 */

export type CellSpec = string | {
    contents: string;
    colspan?: number;
    rowspan?: number;
};

export function modelTable(rows: CellSpec[][], attributes = ""): string {
    const rowsMarkup = rows
        .map((cells) => `<tableRow>${cells.map(cellMarkup).join("")}</tableRow>`)
        .join("");
    return `<table${attributes ? ` ${attributes}` : ""}>${rowsMarkup}</table>`;
}

/**
 * Returns the model cell at the given child indexes of the table (the first table in the
 * root). With merged cells these are child positions, not grid coordinates.
 */
export function cellAt(editor: ClassicEditor, rowIndex: number, cellIndex: number): ModelElement {
    const table = editor.model.document.getRoot()?.getChild(0);
    if (!table?.is("element", "table")) {
        throw new Error("The first root child is not a table.");
    }
    const row = table.getChild(rowIndex);
    if (!row?.is("element", "tableRow")) {
        throw new Error(`No table row at index ${rowIndex}.`);
    }
    const cell = row.getChild(cellIndex);
    if (!cell?.is("element", "tableCell")) {
        throw new Error(`No table cell at row ${rowIndex}, child ${cellIndex}.`);
    }
    return cell;
}

/** Selects the rectangle of cells between two child-index positions (see `cellAt`). */
export function selectCells(
    editor: ClassicEditor,
    anchor: [number, number],
    target: [number, number]
) {
    editor.plugins.get(TableSelection).setCellSelection(
        cellAt(editor, anchor[0], anchor[1]),
        cellAt(editor, target[0], target[1])
    );
}

function cellMarkup(cell: CellSpec): string {
    const spec = typeof cell === "string" ? { contents: cell } : cell;
    const attributes =
        (spec.colspan ? ` colspan="${spec.colspan}"` : "") +
        (spec.rowspan ? ` rowspan="${spec.rowspan}"` : "");
    return `<tableCell${attributes}><paragraph>${spec.contents}</paragraph></tableCell>`;
}
