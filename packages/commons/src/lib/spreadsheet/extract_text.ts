/**
 * Extracts plain text from a UniversJS workbook JSON structure for full-text search indexing.
 * Mirrors the traversal logic of {@link renderSpreadsheetToHtml}: only visible sheets,
 * skipping hidden rows and columns.
 *
 * Handles both original camelCase keys and lowercased keys (the search preprocessor
 * runs `normalize()` on content before passing it here, which lowercases the entire
 * JSON string).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Read a property by trying the camelCase name first, then the lowercased form. */
function prop(obj: any, camel: string): any {
    if (obj == null) return undefined;
    return obj[camel] ?? obj[camel.toLowerCase()];
}

/**
 * Parses the raw JSON content of a spreadsheet note and extracts all visible
 * cell values as a single plain-text string (space-separated).
 *
 * Returns an empty string for invalid or empty spreadsheets.
 */
export function extractSpreadsheetText(jsonContent: string): string {
    let data: any;
    try {
        data = JSON.parse(jsonContent);
    } catch {
        return "";
    }

    const workbook = prop(data, "workbook");
    const sheets = workbook && prop(workbook, "sheets");
    if (!sheets) {
        return "";
    }

    const sheetOrder: string[] | undefined = prop(workbook, "sheetOrder");
    const sheetIds = sheetOrder ?? Object.keys(sheets);
    const visibleSheets = sheetIds
        .map((id: string) => sheets[id])
        .filter((s: any) => s && !prop(s, "hidden"));

    if (visibleSheets.length === 0) {
        return "";
    }

    const parts: string[] = [];
    for (const sheet of visibleSheets) {
        extractSheetText(sheet, parts);
    }

    return parts.join(" ");
}

function extractSheetText(sheet: any, parts: string[]): void {
    const cellData = prop(sheet, "cellData");
    if (!cellData) return;

    const rowData = prop(sheet, "rowData") ?? {};
    const columnData = prop(sheet, "columnData") ?? {};

    for (const rowStr of Object.keys(cellData)) {
        const row = Number(rowStr);
        if (prop(rowData[row], "hd")) continue;

        const cols = cellData[row];
        for (const colStr of Object.keys(cols)) {
            const col = Number(colStr);
            if (prop(columnData[col], "hd")) continue;

            const cell = cols[col];
            if (cell?.v == null) continue;

            if (typeof cell.v === "boolean") {
                parts.push(cell.v ? "TRUE" : "FALSE");
            } else {
                const text = String(cell.v).trim();
                if (text) {
                    parts.push(text);
                }
            }
        }
    }
}
