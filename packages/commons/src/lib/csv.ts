/**
 * Minimal RFC 4180 CSV reader shared across imports (spreadsheets, Notion database columns).
 *
 * Tokenizes CSV text into a matrix of string fields: a quoted field may contain commas, newlines and
 * doubled `""` quotes; records may end in CRLF, LF or CR; a leading UTF-8 BOM is stripped. A single
 * trailing record terminator does not produce a spurious empty final row, but genuine blank lines in the
 * middle are preserved.
 */
export function parseCsv(csvText: string): string[][] {
    const text = stripBom(csvText);
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let inQuotes = false;
    let i = 0;

    while (i < text.length) {
        const ch = text[i];

        if (inQuotes) {
            if (ch === "\"") {
                // A doubled quote inside a quoted field is a literal quote; a lone one closes it.
                if (text[i + 1] === "\"") { field += "\""; i += 2; continue; }
                inQuotes = false; i++; continue;
            }
            field += ch; i++; continue;
        }

        if (ch === "\"") { inQuotes = true; i++; continue; }
        if (ch === ",") { row.push(field); field = ""; i++; continue; }
        if (ch === "\n") { row.push(field); field = ""; rows.push(row); row = []; i++; continue; }
        if (ch === "\r") {
            row.push(field); field = ""; rows.push(row); row = [];
            i += text[i + 1] === "\n" ? 2 : 1; // swallow the LF of a CRLF pair
            continue;
        }

        field += ch; i++;
    }

    row.push(field);
    rows.push(row);

    // A trailing terminator leaves a final [""] record; drop it (but keep real empty fields).
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === "") rows.pop();

    return rows;
}

/** Strips a leading UTF-8 BOM (which our own spreadsheet exporter writes for Excel) if present. */
function stripBom(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
