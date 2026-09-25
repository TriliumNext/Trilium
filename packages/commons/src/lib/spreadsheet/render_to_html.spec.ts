import { describe, expect, it } from "vitest";
import { renderSpreadsheetToHtml as renderRaw } from "./render_to_html.js";
import { BorderStyle, HorizontalAlign, VerticalAlign, WrapStrategy } from "./workbook_model.js";

/**
 * Renders, then expands the emitted `<style>` back into `style` attributes, so a test asserts on
 * the declarations a cell resolves to rather than on generated class names. What the renderer
 * actually emits is covered by the "style deduplication" block, which uses `renderRaw`.
 */
function renderSpreadsheetToHtml(jsonContent: string): string {
    return withInlineStyles(renderRaw(jsonContent));
}

function withInlineStyles(html: string): string {
    const stylesheet = /^<style>([\s\S]*?)<\/style>\n/.exec(html);
    if (!stylesheet) return html;

    const declarations = new Map<string, string>();
    for (const rule of stylesheet[1].matchAll(/\.spreadsheet-table(?::where\(\.[\w-]+\))? \.([\w-]+)\{([^}]*)\}/g)) {
        declarations.set(rule[1], withoutThemedColors(rule[2]));
    }
    const body = html.slice(stylesheet[0].length).replace(/ class="([^"]*)"/g, (_whole, names: string) => {
        const kept: string[] = [];
        const css: string[] = [];
        for (const name of names.split(" ")) {
            const declaration = declarations.get(name);
            if (declaration) css.push(declaration);
            else kept.push(name);
        }
        return (kept.length ? ` class="${kept.join(" ")}"` : "") + (css.length ? ` style="${css.join(";")}"` : "");
    });

    return body;
}

/**
 * Drops the `light-dark()` declaration each color is followed by, leaving the plain one in front
 * of it — which is what a light theme renders, and what every assertion here is written against.
 * The pairing itself is covered by the "dark mode" block, reading what is actually emitted.
 */
function withoutThemedColors(declarations: string): string {
    return declarations.split(";").filter((part) => !part.includes("light-dark(")).join(";");
}

/**
 * The markup with the box model stripped: each cell's sizing box and the padding it is measured
 * against, leaving the content and the cell's own theming.
 */
function unboxed(html: string): string {
    return html
        .replace(/<td([^>]*)><span style="display:block;overflow:hidden[^"]*">([\s\S]*?)<\/span><\/td>/g, "<td$1>$2</td>")
        .replace(/padding:[^;"]*;?/g, "")
        .replace(/;"/g, '"')
        .replace(/ style=""/g, "");
}

describe("renderSpreadsheetToHtml", () => {
    it("accepts an already-parsed workbook as well as its JSON", () => {
        // The XLSX preview holds the workbook `parseXlsxToWorkbook` returns, so it renders it
        // directly instead of serializing it for the renderer to parse back.
        const data = {
            version: 1,
            workbook: {
                sheetOrder: ["sheet1"],
                styles: { boldStyle: { bl: 1 } },
                sheets: {
                    sheet1: {
                        id: "sheet1",
                        name: "Sheet1",
                        cellData: { 0: { 0: { v: "Hello", t: 1, s: "boldStyle" } } }
                    }
                }
            }
        };

        expect(renderRaw(data)).toBe(renderRaw(JSON.stringify(data)));
        expect(renderRaw(data)).toContain("Hello");
    });

    it("renders a basic spreadsheet with values and styles", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                id: "test",
                sheetOrder: ["sheet1"],
                name: "",
                appVersion: "0.16.1",
                locale: "zhCN",
                styles: {
                    boldStyle: { bl: 1 }
                },
                sheets: {
                    sheet1: {
                        id: "sheet1",
                        name: "Sheet1",
                        hidden: 0,
                        rowCount: 1000,
                        columnCount: 20,
                        defaultColumnWidth: 88,
                        defaultRowHeight: 24,
                        mergeData: [],
                        cellData: {
                            "1": {
                                "1": { v: "lol", t: 1 }
                            },
                            "3": {
                                "0": { v: "wut", t: 1 },
                                "2": { s: "boldStyle", v: "Bold string", t: 1 }
                            }
                        },
                        rowData: {},
                        columnData: {},
                        showGridlines: 1
                    }
                }
            }
        });

        const html = renderSpreadsheetToHtml(input);

        // Should contain a table.
        expect(html).toContain("<table");
        expect(html).toContain("</table>");

        // Should contain cell values.
        expect(html).toContain("lol");
        expect(html).toContain("wut");
        expect(html).toContain("Bold string");

        // Bold cell should have font-weight:bold.
        expect(html).toContain("font-weight:bold");

        // Should not render sheet header for single sheet.
        expect(html).not.toContain("<h3>");
    });

    it("renders multiple visible sheets with headers", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1", "s2"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Data",
                        hidden: 0,
                        rowCount: 10,
                        columnCount: 5,
                        mergeData: [],
                        cellData: { "0": { "0": { v: "A1" } } },
                        rowData: {},
                        columnData: {}
                    },
                    s2: {
                        id: "s2",
                        name: "Summary",
                        hidden: 0,
                        rowCount: 10,
                        columnCount: 5,
                        mergeData: [],
                        cellData: { "0": { "0": { v: "B1" } } },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });

        const html = renderSpreadsheetToHtml(input);
        expect(html).toContain("<h3>Data</h3>");
        expect(html).toContain("<h3>Summary</h3>");
        expect(html).toContain("A1");
        expect(html).toContain("B1");
    });

    it("skips hidden sheets", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1", "s2"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Visible",
                        hidden: 0,
                        rowCount: 10,
                        columnCount: 5,
                        mergeData: [],
                        cellData: { "0": { "0": { v: "shown" } } },
                        rowData: {},
                        columnData: {}
                    },
                    s2: {
                        id: "s2",
                        name: "Hidden",
                        hidden: 1,
                        rowCount: 10,
                        columnCount: 5,
                        mergeData: [],
                        cellData: { "0": { "0": { v: "secret" } } },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });

        const html = renderSpreadsheetToHtml(input);
        expect(html).toContain("shown");
        expect(html).not.toContain("secret");
        // Single visible sheet, no header.
        expect(html).not.toContain("<h3>");
    });

    it("handles merged cells", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        rowCount: 10,
                        columnCount: 5,
                        mergeData: [
                            { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 }
                        ],
                        cellData: {
                            "0": { "0": { v: "merged" } }
                        },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });

        const html = renderSpreadsheetToHtml(input);
        expect(html).toContain('rowspan="2"');
        expect(html).toContain('colspan="2"');
        expect(html).toContain("merged");
    });

    it("escapes HTML in cell values", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        rowCount: 10,
                        columnCount: 5,
                        mergeData: [],
                        cellData: {
                            "0": { "0": { v: "<script>alert('xss')</script>" } }
                        },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });

        const html = renderSpreadsheetToHtml(input);
        expect(html).not.toContain("<script>");
        expect(html).toContain("&lt;script&gt;");
    });

    it("handles invalid JSON gracefully", () => {
        const html = renderSpreadsheetToHtml("not json");
        expect(html).toContain("Unable to parse");
    });

    it("handles empty workbook", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        rowCount: 10,
                        columnCount: 5,
                        mergeData: [],
                        cellData: {},
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });

        const html = renderSpreadsheetToHtml(input);
        expect(html).toContain("Empty sheet");
    });

    it("renders boolean values", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        rowCount: 10,
                        columnCount: 5,
                        mergeData: [],
                        cellData: {
                            "0": {
                                "0": { v: true, t: 3 },
                                "1": { v: false, t: 3 }
                            }
                        },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });

        const html = renderSpreadsheetToHtml(input);
        expect(html).toContain("TRUE");
        expect(html).toContain("FALSE");
    });

    it("applies inline styles for colors, alignment, and borders", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        rowCount: 10,
                        columnCount: 5,
                        mergeData: [],
                        cellData: {
                            "0": {
                                "0": {
                                    v: "styled",
                                    s: {
                                        bg: { rgb: "#FF0000" },
                                        cl: { rgb: "#FFFFFF" },
                                        ht: 2,
                                        bd: {
                                            b: { s: 1, cl: { rgb: "#000000" } }
                                        }
                                    }
                                }
                            }
                        },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });

        const html = renderSpreadsheetToHtml(input);
        expect(html).toContain("background-color:#FF0000");
        expect(html).toContain("color:#FFFFFF");
        expect(html).toContain("text-align:center");
        expect(html).toContain("border-bottom:");
    });

    it("sanitizes CSS injection in color values", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        rowCount: 10,
                        columnCount: 5,
                        mergeData: [],
                        cellData: {
                            "0": {
                                "0": {
                                    v: "test",
                                    s: {
                                        bg: { rgb: "red;background:url(//evil.com/steal)" },
                                        cl: { rgb: "#FFF;color:expression(alert(1))" }
                                    }
                                }
                            }
                        },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });

        const html = renderSpreadsheetToHtml(input);
        expect(html).not.toContain("evil.com");
        expect(html).not.toContain("expression");
        expect(html).toContain("transparent");
    });

    it("sanitizes CSS injection in font-family", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        rowCount: 10,
                        columnCount: 5,
                        mergeData: [],
                        cellData: {
                            "0": {
                                "0": {
                                    v: "test",
                                    s: {
                                        ff: "Arial;}</style><script>alert(1)</script>"
                                    }
                                }
                            }
                        },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });

        const html = renderRaw(input);
        expect(html).not.toContain("<script>");
        // The value cannot close the stylesheet it is written into: exactly the one this
        // renderer emits, and nothing after it that a font name smuggled in.
        expect(html.match(/<\/style>/g)).toHaveLength(1);
        expect(html).toContain("font-family:Arial");
    });

    it("sanitizes CSS injection in border colors", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        rowCount: 10,
                        columnCount: 5,
                        mergeData: [],
                        cellData: {
                            "0": {
                                "0": {
                                    v: "test",
                                    s: {
                                        bd: {
                                            b: { s: 1, cl: { rgb: "#000;background:url(//evil.com)" } }
                                        }
                                    }
                                }
                            }
                        },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });

        const html = renderSpreadsheetToHtml(input);
        expect(html).not.toContain("evil.com");
        expect(html).toContain("transparent");
    });

    it("renders a cell whose text lives only in its rich-text document", () => {
        const html = renderSpreadsheetToHtml(singleCellWorkbook({ p: { body: { dataStream: "Notebook\r\n" } } }));
        expect(html).toContain("Notebook");
    });

    it("renders a hyperlink whether or not the cell also has a plain value", () => {
        const link = (cell: Record<string, unknown>) => renderSpreadsheetToHtml(singleCellWorkbook({
            ...cell,
            p: {
                body: {
                    dataStream: "Pen\r\n",
                    customRanges: [{ startIndex: 0, endIndex: 2, properties: { url: "https://example.com/pen" } }]
                }
            }
        }));

        const expected = `<a href="https://example.com/pen" target="_blank" rel="noopener noreferrer">Pen</a>`;
        expect(link({})).toContain(expected);
        expect(link({ v: "Pen", t: 1 })).toContain(expected);
    });

    it("links only the run a range covers, leaving the rest as text", () => {
        const html = renderSpreadsheetToHtml(singleCellWorkbook({
            p: {
                body: {
                    dataStream: "see supplier now\r\n",
                    customRanges: [{ startIndex: 4, endIndex: 11, properties: { url: "https://example.com" } }]
                }
            }
        }));

        expect(html).toContain(`see <a href="https://example.com" target="_blank" rel="noopener noreferrer">supplier</a> now`);
    });

    it("drops an unsafe or malformed link target, keeping its text", () => {
        const withUrl = (url: unknown) => renderSpreadsheetToHtml(singleCellWorkbook({
            p: {
                body: {
                    dataStream: "Pen\r\n",
                    customRanges: [{ startIndex: 0, endIndex: 2, properties: { url } }]
                }
            }
        }));

        for (const url of ["javascript:alert(1)", "data:text/html,<script>", " ", 42, undefined]) {
            const html = withUrl(url);
            expect(html, String(url)).toContain("Pen");
            expect(html, String(url)).not.toContain("<a ");
        }
    });

    it("ignores link ranges that are out of order, overlapping or out of bounds", () => {
        const html = renderSpreadsheetToHtml(singleCellWorkbook({
            p: {
                body: {
                    dataStream: "abcdef\r\n",
                    customRanges: [
                        { startIndex: 3, endIndex: 99, properties: { url: "https://example.com/second" } },
                        { startIndex: 0, endIndex: 1, properties: { url: "https://example.com/first" } },
                        { startIndex: 4, endIndex: 5, properties: { url: "https://example.com/overlapping" } },
                        { startIndex: 2, properties: { url: "https://example.com/unbounded" } }
                    ]
                }
            }
        }));

        expect(html).toContain(">ab</a>c<a ");
        expect(html).toContain(">def</a>");
        expect(html).not.toContain("overlapping");
        expect(html).not.toContain("unbounded");
    });

    it("keeps the number format of a linked numeric cell", () => {
        const html = renderSpreadsheetToHtml(singleCellWorkbook({
            v: 0.42,
            t: 2,
            s: { n: { pattern: "0.0%" } },
            p: {
                body: {
                    dataStream: "42%\r\n",
                    customRanges: [{ startIndex: 0, endIndex: 2, properties: { url: "https://example.com" } }]
                }
            }
        }));

        expect(html).toContain("42.0%");
    });

    it("rotates a cell's text", () => {
        const rotated = (tr: unknown) => renderSpreadsheetToHtml(singleCellWorkbook({ v: "Days left", t: 1, s: { tr } }));

        // A quarter turn either way becomes a vertical writing mode, so the row can grow to fit it.
        // Univer measures the angle the way CSS turns, so -90 lifts the text and reads upwards.
        expect(rotated({ a: -90 })).toContain(
            `<span style="display:inline-block;vertical-align:top;writing-mode:vertical-rl;transform:rotate(180deg)">Days left</span>`);
        expect(rotated({ a: 90 })).toContain(
            `<span style="display:inline-block;vertical-align:top;writing-mode:vertical-rl">Days left</span>`);

        // Stacked text reads downwards with upright characters.
        expect(rotated({ v: 1 })).toContain(
            `<span style="display:inline-block;vertical-align:top;writing-mode:vertical-rl;text-orientation:upright">Days left</span>`);

        // Any other angle turns the glyphs about a bottom corner of the cell, shifted by the line
        // height the turn would otherwise swing past that corner: lifting text from the bottom
        // left, dropping text from the bottom right.
        expect(rotated({ a: -45 })).toContain(
            `transform:translateX(calc(1lh * 0.707)) rotate(-45deg);transform-origin:left bottom">Days left</span>`);
        expect(rotated({ a: 45 })).toContain(
            `transform:translateX(calc(1lh * -0.707)) rotate(45deg);transform-origin:right bottom">Days left</span>`);
        expect(rotated({ a: -30.5 })).toContain(`transform:translateX(calc(1lh * 0.508)) rotate(-30.5deg)`);
    });

    it("anchors turned text to the cell edge the string meets", () => {
        const tilted = (s: Record<string, unknown>) => renderSpreadsheetToHtml(singleCellWorkbook({ v: "Days left", t: 1, s }));

        // Against the bottom, lifting text meets the edge with its start, dropping text with its end.
        expect(tilted({ tr: { a: -45 } })).toContain("align-items:flex-end;justify-content:flex-start");
        expect(tilted({ tr: { a: 45 } })).toContain("align-items:flex-end;justify-content:flex-end");

        // Against the top the ends swap over; a middle-aligned cell keeps the bottom's sides.
        expect(tilted({ tr: { a: -45 }, vt: VerticalAlign.TOP })).toContain("align-items:flex-start;justify-content:flex-end");
        expect(tilted({ tr: { a: 45 }, vt: VerticalAlign.TOP })).toContain("align-items:flex-start;justify-content:flex-start");
        expect(tilted({ tr: { a: 45 }, vt: VerticalAlign.MIDDLE })).toContain("align-items:center;justify-content:flex-end");

        // A cell that states its own alignment keeps it.
        expect(tilted({ tr: { a: 45 }, ht: HorizontalAlign.CENTER })).toContain("justify-content:center");
    });

    it("turns text about the cell edge it hangs from", () => {
        const tilted = (a: number, vt?: number) =>
            renderSpreadsheetToHtml(singleCellWorkbook({ v: "Days left", t: 1, s: { tr: { a }, vt } }));

        expect(tilted(-45)).toContain(`translateX(calc(1lh * 0.707)) rotate(-45deg);transform-origin:left bottom`);
        expect(tilted(45)).toContain(`translateX(calc(1lh * -0.707)) rotate(45deg);transform-origin:right bottom`);

        expect(tilted(-45, VerticalAlign.TOP)).toContain(`translateX(calc(1lh * -0.707)) rotate(-45deg);transform-origin:right top`);
        expect(tilted(45, VerticalAlign.TOP)).toContain(`translateX(calc(1lh * 0.707)) rotate(45deg);transform-origin:left top`);

        // Turning about the centre needs no correction and leaves the shape centred in the cell.
        expect(tilted(45, VerticalAlign.MIDDLE)).toContain(`transform:rotate(45deg)">Days left</span>`);
    });

    it("holds turned text inside its own cell", () => {
        const rotated = (a: number) => renderSpreadsheetToHtml(singleCellWorkbook({ v: "Days left", t: 1, s: { tr: { a } } }));

        // Every turn sits in a box that fills the cell, so the cell is what cuts an overrun. A box
        // only as tall as the text would clip a band across the turn instead.
        for (const angle of [45, -45, 90, -90]) {
            expect(rotated(angle), `${angle} degrees`).toContain(`<span style="display:flex;overflow:hidden`);
            expect(rotated(angle), `${angle} degrees`).toContain("height:22px");
        }

        // An untouched cell keeps the box that only caps it, so its own alignment still places it.
        expect(rotated(0)).toContain(`<span style="display:block;overflow:hidden;max-height:22px;line-height:normal">`);
    });

    it("leaves a cell unwrapped when it has no rotation to apply", () => {
        const plain = (s: unknown) => unboxed(renderSpreadsheetToHtml(singleCellWorkbook({ v: "Days left", t: 1, s })));

        expect(plain({})).toContain("<td>Days left</td>");
        expect(plain({ tr: { a: 0, v: 0 } })).toContain("<td>Days left</td>");
        expect(plain({ tr: { v: 0 } })).toContain("<td>Days left</td>");

        // An empty cell gets no wrapper either, rotation or not.
        expect(renderSpreadsheetToHtml(singleCellWorkbook({ s: { tr: { a: 90 } } }))).toContain("<td></td>");
    });

    it("keeps a cell's image upright when its text is rotated", () => {
        const html = renderSpreadsheetToHtml(singleCellWorkbook({
            v: "Days left",
            t: 1,
            s: { tr: { a: 90 } },
            p: {
                drawings: { d1: { drawingId: "d1", source: "api/attachments/abc123/image/i.png" } },
                drawingsOrder: ["d1"]
            }
        }));

        expect(html).toContain(`Days left</span></span><img class="spreadsheet-cell-image"`);
    });

    describe("overflow into neighbouring cells", () => {
        /** A sheet from a `cellData` matrix, with optional sheet-level overrides. */
        function grid(cellData: Record<number, unknown>, extra: Record<string, unknown> = {}): string {
            return JSON.stringify({
                version: 1,
                workbook: {
                    sheetOrder: ["s1"],
                    styles: {},
                    sheets: {
                        s1: {
                            id: "s1",
                            name: "Sheet1",
                            hidden: 0,
                            mergeData: [],
                            cellData,
                            rowData: {},
                            columnData: {},
                            ...extra
                        }
                    }
                }
            });
        }

        /** One row of `cells`, keyed by column. */
        function row(cells: Record<number, unknown>, extra: Record<string, unknown> = {}): string {
            return grid({ "0": cells }, extra);
        }

        /**
         * The px of room the workbook's cell at `column` is given on each side, `[0, 0]` when it is
         * held to its own edges, and `null` when nothing bounds it. The render always starts at A1.
         */
        function room(json: string, column: number): [number, number] | null {
            const cells = renderSpreadsheetToHtml(json).match(/<td[^>]*>(?:<span style="[^"]*">)?/g) ?? [];
            const cell = cells[column] ?? "";
            if (!cell.includes("width:calc")) return cell.includes("overflow:hidden") ? [0, 0] : null;

            const before = /margin-left:-([\d.]+)px/.exec(cell)?.[1] ?? "0";
            const after = /margin-right:-([\d.]+)px/.exec(cell)?.[1] ?? "0";
            return [Number(before), Number(after)];
        }

        it("holds text to its own edge when the neighbour beside it holds a value", () => {
            expect(room(row({ 0: { v: "a long label", t: 1 }, 1: { v: "next", t: 1 } }), 0)).toEqual([0, 0]);

            // A cell that carries only formatting does not extend the grid, so there is no column
            // beside these to run into.
            expect(room(row({ 0: { v: "a long label", t: 1 } }), 0)).toEqual([0, 0]);
            expect(room(row({ 0: { v: "a long label", t: 1 }, 1: { s: { bl: 1 } } }), 0)).toEqual([0, 0]);
            expect(room(row({ 0: { v: "a long label", t: 1 }, 1: { v: "", t: 1 } }), 0)).toEqual([0, 0]);

            // With a column of content beyond it, the empty one between is room to run across.
            expect(room(row({ 0: { v: "a long label", t: 1 }, 2: { v: "next", t: 1 } }), 0)).toEqual([0, 88]);
        });

        it("gives the text the width of the empty cells it can run across", () => {
            const long = { v: "a long label", t: 1 };
            const widths = { 1: { w: 30 }, 2: { w: 50 } };

            // Two empty columns, then a value: the text runs over both and is cut before the value.
            expect(room(row({ 0: long, 3: { v: "next", t: 1 } }, { columnData: widths }), 0)).toEqual([0, 80]);

            // A hidden column between them contributes nothing, since none of it reaches the page.
            expect(room(
                row({ 0: long, 3: { v: "next", t: 1 } }, { columnData: { ...widths, 2: { w: 50, hd: 1 } } }),
                0
            )).toEqual([0, 30]);
        });

        it("follows the alignment to decide which side the text spills towards", () => {
            const rightAligned = { t: 1, s: { ht: HorizontalAlign.RIGHT } };
            expect(room(row({ 0: { v: "before", t: 1 }, 1: { v: "x", ...rightAligned } }), 1)).toEqual([0, 0]);
            expect(room(row({ 1: { v: "x", ...rightAligned }, 2: { v: "after", t: 1 } }), 1)).toEqual([88, 0]);

            const centered = { t: 1, s: { ht: HorizontalAlign.CENTER } };
            expect(room(row({ 0: { v: "before", t: 1 }, 1: { v: "x", ...centered } }), 1)).toEqual([0, 0]);
            // Nothing to its right, so the room on its left is given up to keep it centred.
            expect(room(row({ 1: { v: "x", ...centered } }), 1)).toEqual([0, 0]);

            // Centred text is given the same room on both sides, so the middle of the text stays on
            // the middle of the cell: stopped on the right, it gives up the room on its left too.
            expect(room(row({ 1: { v: "x", ...centered }, 2: { v: "after", t: 1 } }), 1)).toEqual([0, 0]);
            expect(room(row({ 1: { v: "x", ...centered }, 3: { v: "after", t: 1 } }), 1)).toEqual([88, 88]);
        });

        it("keeps turned text in its own cell rather than running it into a neighbour", () => {
            const turned = { v: "a long label", t: 1, s: { tr: { a: 45 } } };
            expect(room(row({ 0: turned }), 0)).toEqual([0, 0]);
            expect(room(row({ 0: turned, 1: {} }), 0)).toEqual([0, 0]);
        });

        it("never spills a number, a boolean or a clipped cell, and never bounds a wrapped one", () => {
            expect(room(row({ 0: { v: 42, t: 2 } }), 0)).toEqual([0, 0]);
            expect(room(row({ 0: { v: true, t: 3 } }), 0)).toEqual([0, 0]);
            expect(room(row({ 0: { v: "a long label", t: 1, s: { tb: WrapStrategy.CLIP } } }), 0)).toEqual([0, 0]);

            expect(room(row({ 0: { v: "a long label", t: 1, s: { tb: WrapStrategy.WRAP } }, 1: { v: "next", t: 1 } }), 0)).toEqual([0, 0]);
            expect(room(row({ 0: { s: { bl: 1 } }, 1: { v: "next", t: 1 } }), 0)).toBeNull();
        });

        it("judges adjacency on the rendered row rather than the cell matrix", () => {
            const long = { v: "a long label", t: 1 };

            // A hidden column reaches nobody, so the cell steps over it in both directions.
            expect(room(row({ 0: long, 1: { v: "next", t: 1 } }, { columnData: { 1: { hd: 1 } } }), 0)).toEqual([0, 0]);
            expect(room(row({ 0: long, 1: {}, 2: { v: "next", t: 1 } }, { columnData: { 1: { hd: 1 } } }), 0)).toEqual([0, 0]);

            // A merged cell starts looking past the last column its own range covers.
            const merged = [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 }];
            expect(room(row({ 0: long, 1: {}, 2: { v: "next", t: 1 } }, { mergeData: merged }), 0)).toEqual([0, 0]);
            expect(room(row({ 0: long, 1: {} }, { mergeData: merged }), 0)).toEqual([0, 0]);
        });

        it("reads a column a merge spans into as holding that range's content", () => {
            // The second row renders only the right-aligned cell; the range fills the column beside it.
            const html = renderSpreadsheetToHtml(grid(
                { "0": { 0: { v: "tall", t: 1 } }, "1": { 1: { v: "x", t: 1, s: { ht: HorizontalAlign.RIGHT } } } },
                { mergeData: [{ startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 }] }
            ));

            expect(unboxed(html).split("</tr>")[1]).toContain(`<td style="text-align:right">x</td>`);
        });

        it("counts a cell whose text lives only in its rich-text document as occupied", () => {
            const html = row({
                0: { v: "a long label", t: 1 },
                1: { p: { body: { dataStream: "linked\r\n" } } }
            });
            expect(room(html, 0)).toEqual([0, 0]);
        });
    });

    describe("borders of a merged range", () => {
        const THIN = { s: BorderStyle.THIN };

        /** A sheet of `cellData` (keyed by row, then column) carrying the given merges. */
        function mergedWorkbook(cellData: Record<number, Record<number, unknown>>, mergeData: unknown[]): string {
            return JSON.stringify({
                version: 1,
                workbook: {
                    sheetOrder: ["s1"],
                    styles: {},
                    sheets: {
                        s1: {
                            id: "s1",
                            name: "Sheet1",
                            hidden: 0,
                            mergeData,
                            cellData,
                            rowData: {},
                            columnData: {}
                        }
                    }
                }
            });
        }

        /** The border declarations of the first cell in the rendered row. */
        function bordersOfFirstCell(html: string): string[] {
            const style = (html.match(/<td[^>]*style="([^"]*)"/) ?? [])[1] ?? "";
            return style.split(";").filter((part) => part.startsWith("border"));
        }

        it("takes the right edge from the range's last column and the bottom from its last row", () => {
            // Excel spreads a range's outline over its member cells, so A1:B1 keeps its right
            // border on B1 and A1:A2 keeps its bottom on A2.
            const across = renderSpreadsheetToHtml(mergedWorkbook(
                { 0: { 0: { v: "x", s: { bd: { l: THIN } } }, 1: { s: { bd: { r: THIN } } } } },
                [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 }]
            ));
            expect(bordersOfFirstCell(across)).toEqual(["border-right:1px solid #000", "border-left:1px solid #000"]);

            const down = renderSpreadsheetToHtml(mergedWorkbook(
                { 0: { 0: { v: "x", s: { bd: { t: THIN } } } }, 1: { 0: { s: { bd: { b: THIN } } } } },
                [{ startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 }]
            ));
            expect(bordersOfFirstCell(down)).toEqual(["border-top:1px solid #000", "border-bottom:1px solid #000"]);
        });

        it("drops the anchor's own right and bottom when they fall inside the range", () => {
            // In a 2x2 range the anchor's right and bottom are internal edges the merge hides.
            const html = renderSpreadsheetToHtml(mergedWorkbook(
                { 0: { 0: { v: "x", s: { bd: { t: THIN, r: THIN, b: THIN } } }, 1: {} }, 1: { 0: {}, 1: {} } },
                [{ startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 }]
            ));
            expect(bordersOfFirstCell(html)).toEqual(["border-top:1px solid #000"]);
        });

        it("leaves an unmerged cell's borders alone", () => {
            const html = renderSpreadsheetToHtml(mergedWorkbook({ 0: { 0: { v: "x", s: { bd: { r: THIN, b: THIN } } } } }, []));
            expect(bordersOfFirstCell(html)).toEqual(["border-right:1px solid #000", "border-bottom:1px solid #000"]);
        });

        it("keeps its own edges when the range is one cell wide and tall", () => {
            const html = renderSpreadsheetToHtml(mergedWorkbook(
                { 0: { 0: { v: "x", s: { bd: { r: THIN, b: THIN } } } } },
                [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }]
            ));
            expect(bordersOfFirstCell(html)).toEqual(["border-right:1px solid #000", "border-bottom:1px solid #000"]);
        });

        it("emits no border when neither the anchor nor the edge cells carry one", () => {
            const html = renderSpreadsheetToHtml(mergedWorkbook(
                { 0: { 0: { v: "x", s: { bl: 1 } }, 1: {} } },
                [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 }]
            ));
            expect(bordersOfFirstCell(html)).toEqual([]);
        });
    });

    // Helper to wrap a single styled cell into a complete workbook payload.
    function singleCellWorkbook(cell: unknown, sheetExtra: Record<string, unknown> = {}): string {
        return JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        rowCount: 10,
                        columnCount: 5,
                        mergeData: [],
                        cellData: {
                            "0": {
                                "0": cell
                            }
                        },
                        rowData: {},
                        columnData: {},
                        ...sheetExtra
                    }
                }
            }
        });
    }

    it("returns empty spreadsheet message when workbook.sheets is missing", () => {
        const input = JSON.stringify({ version: 1, workbook: { sheetOrder: [] } });
        const html = renderSpreadsheetToHtml(input);
        expect(html).toBe("<p>Empty spreadsheet.</p>");
    });

    it("returns empty spreadsheet message when there are no top-level keys", () => {
        const html = renderSpreadsheetToHtml(JSON.stringify(null));
        expect(html).toBe("<p>Empty spreadsheet.</p>");
    });

    it("returns empty spreadsheet message when sheetOrder is empty", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: [],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        rowCount: 10,
                        columnCount: 5,
                        mergeData: [],
                        cellData: { "0": { "0": { v: "x" } } },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });
        const html = renderSpreadsheetToHtml(input);
        expect(html).toBe("<p>Empty spreadsheet.</p>");
    });

    it("returns empty spreadsheet message when all sheets are hidden", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Hidden",
                        hidden: 1,
                        rowCount: 10,
                        columnCount: 5,
                        mergeData: [],
                        cellData: { "0": { "0": { v: "x" } } },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });
        const html = renderSpreadsheetToHtml(input);
        expect(html).toBe("<p>Empty spreadsheet.</p>");
    });

    it("falls back to Object.keys(sheets) when sheetOrder is absent", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        rowCount: 10,
                        columnCount: 5,
                        mergeData: [],
                        cellData: { "0": { "0": { v: "fromKeys" } } },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });
        const html = renderSpreadsheetToHtml(input);
        expect(html).toContain("fromKeys");
    });

    it("uses default workbook styles object when workbook.styles is absent", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        rowCount: 10,
                        columnCount: 5,
                        mergeData: [],
                        cellData: { "0": { "0": { s: "missingStyle", v: "noStyle" } } },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });
        const html = renderSpreadsheetToHtml(input);
        expect(html).toContain("noStyle");
        // Missing style id resolves to null -> no inline style attribute.
        expect(unboxed(html)).toContain("<td>noStyle</td>");
    });

    it("renders bold, italic and underline inline styles", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({ v: "fancy", s: { bl: 1, it: 1, ul: { s: 1 } } })
        );
        expect(html).toContain("font-weight:bold");
        expect(html).toContain("font-style:italic");
        expect(html).toContain("text-decoration:underline");
        expect(html).not.toContain("line-through");
    });

    it("renders strikethrough alone", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({ v: "strike", s: { st: { s: 1 } } })
        );
        expect(html).toContain("text-decoration:line-through");
        expect(html).not.toContain("text-decoration:underline line-through");
    });

    it("combines underline and strikethrough into one text-decoration", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({ v: "both", s: { ul: { s: 1 }, st: { s: 1 } } })
        );
        expect(html).toContain("text-decoration:underline line-through");
    });

    it("renders font-size and font-family", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({ v: "sized", s: { fs: 14, ff: "Times New Roman" } })
        );
        expect(html).toContain("font-size:14pt");
        expect(html).toContain("font-family:Times New Roman");
    });

    it("ignores non-finite font-size", () => {
        // fs stored as a string from a stringified payload should not produce font-size.
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({ v: "badsize", s: { fs: "20" } })
        );
        expect(html).not.toContain("font-size");
        expect(html).toContain("badsize");
    });

    it("strips dangerous characters from font-family", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({ v: "ff", s: { ff: "Arial;}<x>" } })
        );
        expect(html).toContain("font-family:Arialx");
        expect(html).not.toContain(";}");
        expect(html).not.toContain("<x>");
    });

    it("renders all horizontal alignment values", () => {
        const left = renderSpreadsheetToHtml(singleCellWorkbook({ v: "l", s: { ht: 1 } }));
        const center = renderSpreadsheetToHtml(singleCellWorkbook({ v: "c", s: { ht: 2 } }));
        const right = renderSpreadsheetToHtml(singleCellWorkbook({ v: "r", s: { ht: 3 } }));
        expect(left).toContain("text-align:left");
        expect(center).toContain("text-align:center");
        expect(right).toContain("text-align:right");
    });

    it("omits text-align for an unknown horizontal alignment", () => {
        const html = renderSpreadsheetToHtml(singleCellWorkbook({ v: "x", s: { ht: 9 } }));
        expect(html).not.toContain("text-align");
        expect(unboxed(html)).toContain("<td>x</td>");
    });

    it("wraps a cell whose style enables the wrap strategy", () => {
        // Univer WrapStrategy.WRAP === 3. Cells default to nowrap (overflow) via the stylesheet;
        // a wrapping cell must opt back into normal wrapping inline.
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({ v: "This is a cell with line-wrapping", t: 1, s: { tb: 3 } })
        );
        expect(html).toContain("white-space:normal");
        expect(html).toContain("overflow-wrap:break-word");
    });

    it("wraps a cell via a referenced style that enables wrapping", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: { wrapStyle: { tb: 3 } },
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        rowCount: 10,
                        columnCount: 5,
                        mergeData: [],
                        cellData: { "0": { "0": { v: "wrapped", s: "wrapStyle" } } },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });
        const html = renderSpreadsheetToHtml(input);
        expect(html).toContain("white-space:normal");
    });

    it("does not emit wrap styling for a non-wrapping (overflow) cell", () => {
        // WrapStrategy.OVERFLOW === 1 -> the cell keeps the default nowrap/overflow behaviour.
        const html = renderSpreadsheetToHtml(singleCellWorkbook({ v: "plain", s: { tb: 1 } }));
        expect(html).not.toContain("white-space:normal");
    });

    it("renders all vertical alignment values", () => {
        const top = renderSpreadsheetToHtml(singleCellWorkbook({ v: "t", s: { vt: 1 } }));
        const middle = renderSpreadsheetToHtml(singleCellWorkbook({ v: "m", s: { vt: 2 } }));
        const bottom = renderSpreadsheetToHtml(singleCellWorkbook({ v: "b", s: { vt: 3 } }));
        expect(top).toContain("vertical-align:top");
        expect(middle).toContain("vertical-align:middle");
        expect(bottom).toContain("vertical-align:bottom");
    });

    it("omits vertical-align for an unknown vertical alignment", () => {
        const html = renderSpreadsheetToHtml(singleCellWorkbook({ v: "x", s: { vt: 9 } }));
        // The cell contributes none, so it falls back to the row's.
        expect(unboxed(html)).toContain("<td>x</td>");
        expect(html).toContain(`<tr style="height:24px;vertical-align:bottom">`);
    });

    it("defaults a row to the bottom, which a cell's own alignment overrides", () => {
        // Univer leaves a cell at the bottom of its row unless it sets `vt`, unlike HTML.
        const html = renderSpreadsheetToHtml(singleCellWorkbook({ v: "x" }));
        expect(html).toContain(`<tr style="height:24px;vertical-align:bottom">`);
        expect(unboxed(html)).toContain("<td>x</td>");

        const middle = renderSpreadsheetToHtml(singleCellWorkbook({ v: "x", s: { vt: 2 } }));
        expect(unboxed(middle)).toContain(`<td style="vertical-align:middle">x</td>`);
    });

    it("renders borders on all four sides with the correct Univer widths and styles", () => {
        // Univer BorderStyleTypes: THIN=1, DOTTED=3, DOUBLE=7, MEDIUM=8, THICK=13.
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({
                v: "bordered",
                s: {
                    bd: {
                        t: { s: 1, cl: { rgb: "#111111" } }, // THIN -> 1px solid
                        r: { s: 8, cl: { rgb: "#222222" } }, // MEDIUM -> 2px solid
                        b: { s: 13, cl: { rgb: "#333333" } }, // THICK -> 3px solid
                        l: { s: 4, cl: { rgb: "#444444" } } // DASHED -> 1px dashed
                    }
                }
            })
        );
        expect(html).toContain("border-top:1px solid #111111");
        expect(html).toContain("border-right:2px solid #222222");
        expect(html).toContain("border-bottom:3px solid #333333");
        expect(html).toContain("border-left:1px dashed #444444");
    });

    it("renders dotted (3), double (7) and medium-dashed (9) border styles", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({
                v: "styles",
                s: {
                    bd: {
                        t: { s: 3, cl: { rgb: "#111111" } }, // DOTTED -> 1px dotted
                        r: { s: 7, cl: { rgb: "#222222" } }, // DOUBLE -> 3px double
                        b: { s: 9, cl: { rgb: "#333333" } } // MEDIUM_DASHED -> 2px dashed
                    }
                }
            })
        );
        expect(html).toContain("border-top:1px dotted #111111");
        expect(html).toContain("border-right:3px double #222222");
        expect(html).toContain("border-bottom:2px dashed #333333");
    });

    it("defaults a missing border style to 1px solid and missing color to #000", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({
                v: "default",
                s: {
                    bd: {
                        t: {} // no style, no color -> 1px solid #000
                    }
                }
            })
        );
        expect(html).toContain("border-top:1px solid #000");
    });

    it("skips a border side explicitly set to NONE (0)", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({
                v: "none",
                s: {
                    bd: {
                        t: { s: 0, cl: { rgb: "#111111" } },
                        b: { s: 1, cl: { rgb: "#222222" } }
                    }
                }
            })
        );
        expect(html).not.toContain("border-top");
        expect(html).toContain("border-bottom:1px solid #222222");
    });

    it("skips border sides that are null or undefined", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({
                v: "partial",
                s: {
                    bd: {
                        t: { s: 1, cl: { rgb: "#000000" } },
                        r: null,
                        b: undefined,
                        l: null
                    }
                }
            })
        );
        expect(html).toContain("border-top:1px solid #000000");
        expect(html).not.toContain("border-right");
        expect(html).not.toContain("border-bottom");
        expect(html).not.toContain("border-left");
    });

    it("accepts named, rgb and hsl color notations", () => {
        const named = renderSpreadsheetToHtml(singleCellWorkbook({ v: "n", s: { bg: { rgb: "red" } } }));
        const hex = renderSpreadsheetToHtml(singleCellWorkbook({ v: "h", s: { bg: { rgb: "#abcdef" } } }));
        const rgb = renderSpreadsheetToHtml(singleCellWorkbook({ v: "rg", s: { cl: { rgb: "rgb(1,2,3)" } } }));
        const hsl = renderSpreadsheetToHtml(singleCellWorkbook({ v: "hs", s: { cl: { rgb: "hsl(0,0%,0%)" } } }));
        expect(named).toContain("background-color:red");
        expect(hex).toContain("background-color:#abcdef");
        expect(rgb).toContain("color:rgb(1,2,3)");
        expect(hsl).toContain("color:hsl(0,0%,0%)");
    });

    it("falls back to transparent for an invalid functional color", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({ v: "bad", s: { bg: { rgb: "url(x)" } } })
        );
        expect(html).toContain("background-color:transparent");
    });

    it("resolves a style referenced by id and an empty cell style object", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {
                    redBold: { bl: 1, cl: { rgb: "#ff0000" } },
                    nullStyle: null
                },
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        rowCount: 10,
                        columnCount: 5,
                        mergeData: [],
                        cellData: {
                            "0": {
                                "0": { s: "redBold", v: "byId" },
                                "1": { s: "nullStyle", v: "nulled" },
                                "2": { s: {}, v: "emptyStyle" }
                            }
                        },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });
        const html = renderSpreadsheetToHtml(input);
        expect(html).toContain("font-weight:bold");
        expect(html).toContain("color:#ff0000");
        expect(html).toContain("byId");
        // null style id and empty style object -> no styling of their own.
        expect(unboxed(html)).toContain("<td>nulled</td>");
        expect(unboxed(html)).toContain("<td>emptyStyle</td>");
    });

    it("skips hidden rows and hidden columns", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        rowCount: 10,
                        columnCount: 5,
                        mergeData: [],
                        cellData: {
                            "0": { "0": { v: "keepA" }, "1": { v: "hideCol" } },
                            "1": { "0": { v: "hideRow" } },
                            "2": { "0": { v: "keepB" } }
                        },
                        rowData: { "1": { hd: 1 } },
                        columnData: { "1": { hd: 1 } }
                    }
                }
            }
        });
        const html = renderSpreadsheetToHtml(input);
        expect(html).toContain("keepA");
        expect(html).toContain("keepB");
        expect(html).not.toContain("hideCol");
        expect(html).not.toContain("hideRow");
    });

    it("uses explicit column width and row height when provided", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        rowCount: 10,
                        columnCount: 5,
                        defaultColumnWidth: 88,
                        defaultRowHeight: 24,
                        mergeData: [],
                        cellData: { "0": { "0": { v: "sized" } } },
                        rowData: { "0": { h: 50 } },
                        columnData: { "0": { w: 200 } }
                    }
                }
            }
        });
        const html = renderSpreadsheetToHtml(input);
        expect(html).toContain('<col style="width:200px">');
        expect(html).toContain('<tr style="height:50px;vertical-align:bottom">');
    });

    it("lays a cell out with the padding it states", () => {
        const html = renderSpreadsheetToHtml(singleCellWorkbook({ v: "x", t: 1, s: { pd: { t: 3, r: 6, b: 5, l: 6 } } }));

        expect(html).toContain(`<td style="padding:3px 6px 5px 6px">`);
        // The box is measured against that padding rather than the default.
        expect(html).toContain("max-height:16px");
    });

    it("takes a self-sizing row's height from the height Univer measured for it", () => {
        const html = renderSpreadsheetToHtml(JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        mergeData: [],
                        cellData: { "0": { "0": { v: "a" } }, "1": { "0": { v: "b" } }, "2": { "0": { v: "c" } }, "3": { "0": { v: "d" } } },
                        rowData: {
                            // Measured with no `ia`, and measured while explicitly self-sizing.
                            "0": { ah: 34 },
                            "1": { ah: 40, h: 20, ia: 1 },
                            // Sized by hand, so the measurement is ignored even when both are there.
                            "2": { ah: 24, h: 99, ia: 0 },
                            "3": { h: 55, ia: 0 }
                        },
                        columnData: {}
                    }
                }
            }
        }));

        const heights = [...html.matchAll(/<tr style="height:([\d.]+)px/g)].map((match) => Number(match[1]));
        expect(heights).toEqual([34, 40, 99, 55]);
    });

    it("falls back to default column width and row height when absent", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        rowCount: 10,
                        columnCount: 5,
                        mergeData: [],
                        cellData: { "0": { "0": { v: "defaults" } } },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });
        const html = renderSpreadsheetToHtml(input);
        expect(html).toContain('<col style="width:88px">');
        expect(html).toContain('<tr style="height:24px;vertical-align:bottom">');
    });

    it("renders an empty string for a cell with null value", () => {
        const html = renderSpreadsheetToHtml(singleCellWorkbook({ v: null }));
        expect(html).toContain("<td></td>");
    });

    it("renders an empty string for a cell with no value field", () => {
        const html = renderSpreadsheetToHtml(singleCellWorkbook({ t: 1 }));
        expect(html).toContain("<td></td>");
    });

    it("renders an empty string for missing cell within bounds", () => {
        // Bounds extended by a merge so an absent cell is visited.
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        rowCount: 10,
                        columnCount: 5,
                        mergeData: [],
                        cellData: {
                            "0": { "0": { v: "A" }, "2": { v: "C" } }
                        },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });
        const html = renderSpreadsheetToHtml(input);
        // Column 1 between A and C has no cell -> empty <td>.
        expect(html).toContain("<td></td>");
        expect(unboxed(html)).toContain("<td>C</td>");
        // A can run across the empty column, so its text carries the room it has.
        expect(html).toContain(`<td style="padding:0px 2px 2px 2px"><span style="display:block;overflow:hidden;max-height:22px;width:calc(100% + 88px);margin-right:-88px;line-height:normal">A</span></td>`);
    });

    it("renders numeric cell values", () => {
        const html = renderSpreadsheetToHtml(singleCellWorkbook({ v: 42, t: 2 }));
        expect(unboxed(html)).toContain(">42</td>");
    });

    it("aligns a cell by its value type when it sets no alignment of its own", () => {
        // Univer right-aligns numbers and centers booleans; text keeps the table default.
        expect(unboxed(renderSpreadsheetToHtml(singleCellWorkbook({ v: 42, t: 2 })))).toContain(`<td style="text-align:right">`);
        expect(unboxed(renderSpreadsheetToHtml(singleCellWorkbook({ v: true, t: 3 })))).toContain(`<td style="text-align:center">`);
        expect(unboxed(renderSpreadsheetToHtml(singleCellWorkbook({ v: "A", t: 1 })))).toContain("<td>A</td>");

        // A number formatted and styled by the workbook still gets the fallback alignment.
        expect(unboxed(renderSpreadsheetToHtml(singleCellWorkbook({ v: 42, t: 2, s: { bl: 1 } }))))
            .toContain(`<td style="text-align:right;font-weight:bold">`);

        // An explicit alignment wins over the fallback.
        expect(unboxed(renderSpreadsheetToHtml(singleCellWorkbook({ v: 42, t: 2, s: { ht: HorizontalAlign.LEFT } }))))
            .toContain(`<td style="text-align:left">`);
    });

    it("emits colspan only for a purely horizontal merge", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        rowCount: 10,
                        columnCount: 5,
                        mergeData: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 2 }],
                        cellData: { "0": { "0": { v: "wide" } } },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });
        const html = renderSpreadsheetToHtml(input);
        expect(html).toContain('colspan="3"');
        expect(html).not.toContain("rowspan");
    });

    it("emits rowspan only for a purely vertical merge", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        rowCount: 10,
                        columnCount: 5,
                        mergeData: [{ startRow: 0, endRow: 2, startColumn: 0, endColumn: 0 }],
                        cellData: { "0": { "0": { v: "tall" } } },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });
        const html = renderSpreadsheetToHtml(input);
        expect(html).toContain('rowspan="3"');
        expect(html).not.toContain("colspan");
    });

    it("formats a numeric cell using its number-format pattern", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({ v: 1234.5, t: 2, s: { n: { pattern: "#,##0.00" } } })
        );
        expect(unboxed(html)).toContain(">1,234.50</td>");
        expect(html).not.toContain("1234.5<");
    });

    it("formats a numeric cell via a style referenced by id", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {
                    money: { n: { pattern: "#,##0.00" } }
                },
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        rowCount: 10,
                        columnCount: 5,
                        mergeData: [],
                        cellData: { "0": { "0": { s: "money", v: 1000000, t: 2 } } },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });
        const html = renderSpreadsheetToHtml(input);
        expect(html).toContain("1,000,000.00");
    });

    it("applies the [Red] negative color from the pattern as a text color", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({ v: -8800.2, t: 2, s: { n: { pattern: "#,##0.00;[Red]#,##0.00" } } })
        );
        // Negative section has no minus sign -> value shown unsigned, in red.
        expect(html).toContain("8,800.20");
        expect(html).not.toContain("-8,800.20");
        expect(html).toContain("color:red");
    });

    it("gives a filled cell the color Excel shows an automatic font in", () => {
        // The fill comes from the workbook, the surrounding text color from the theme, so a pale
        // fill would be unreadable wherever that theme is dark.
        const html = renderSpreadsheetToHtml(singleCellWorkbook({ v: "x", t: 1, s: { bg: { rgb: "#FFE699" } } }));

        expect(html).toContain("background-color:#FFE699");
        expect(html).toContain("color:#000");
    });

    it("leaves a filled cell's own text color alone, and an unfilled cell with none", () => {
        const own = renderSpreadsheetToHtml(
            singleCellWorkbook({ v: "x", t: 1, s: { bg: { rgb: "#203864" }, cl: { rgb: "#FFFFFF" } } })
        );
        expect(own).toContain("color:#FFFFFF");
        expect(own).not.toContain("color:#000");

        // With no fill there is nothing absolute to read against, so the cell goes on inheriting.
        expect(renderSpreadsheetToHtml(singleCellWorkbook({ v: "x", t: 1, s: { bl: 1 } })))
            .not.toContain("color:");
    });

    it("lets a number format's color win over a fill's automatic one", () => {
        const html = renderSpreadsheetToHtml(singleCellWorkbook({
            v: -8800.2, t: 2, s: { bg: { rgb: "#FFE699" }, n: { pattern: "#,##0.00;[Red]#,##0.00" } }
        }));

        expect(html).toContain("color:red");
        expect(html).not.toContain("color:#000");
    });

    it("does not apply the pattern color to a positive value", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({ v: 12.5, t: 2, s: { n: { pattern: "#,##0.00;[Red]#,##0.00" } } })
        );
        expect(html).toContain("12.50");
        expect(html).not.toContain("color:red");
    });

    it("lets the pattern's negative color win over an explicit cell color (matching Univer)", () => {
        // In the Univer editor, a [Red] negative section overrides an explicit text
        // color: setting a different color on a negative cell does not take effect.
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({
                v: -5,
                t: 2,
                s: { n: { pattern: "#,##0.00;[Red]#,##0.00" }, cl: { rgb: "#0da471" } }
            })
        );
        expect(html).toContain("color:red");
        expect(html).not.toContain("color:#0da471");
    });

    it("uses the explicit cell color when the pattern yields no color for the value", () => {
        // Positive value -> the [Red] section never applies, so cl is used.
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({
                v: 5,
                t: 2,
                s: { n: { pattern: "#,##0.00;[Red]#,##0.00" }, cl: { rgb: "#0da471" } }
            })
        );
        expect(html).toContain("color:#0da471");
    });

    it("formats percentages and dates", () => {
        const percent = renderSpreadsheetToHtml(
            singleCellWorkbook({ v: 0.156, t: 2, s: { n: { pattern: "0.0%" } } })
        );
        expect(percent).toContain("15.6%");

        const date = renderSpreadsheetToHtml(
            singleCellWorkbook({ v: 45000, t: 2, s: { n: { pattern: "yyyy-mm-dd" } } })
        );
        expect(date).toContain("2023-03-15");
    });

    it("escapes formatted output that contains HTML-significant characters", () => {
        // A pattern that wraps the number in literal angle brackets.
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({ v: 5, t: 2, s: { n: { pattern: "\"<b>\"0\"</b>\"" } } })
        );
        expect(html).not.toContain("<b>5</b>");
        expect(html).toContain("&lt;b&gt;5&lt;/b&gt;");
    });

    it("leaves a string cell untouched even when a number pattern is present", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({ v: "n/a", t: 1, s: { n: { pattern: "#,##0.00" } } })
        );
        expect(unboxed(html)).toContain("<td>n/a</td>");
    });

    it("falls back to the raw value for an invalid pattern instead of throwing", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({ v: 42, t: 2, s: { n: { pattern: "[" } } })
        );
        // Must not throw; the cell still renders something containing the digits.
        expect(html).toContain("<table");
        expect(html).toContain("42");
    });

    it("renders an unformatted number when no pattern is set", () => {
        const html = renderSpreadsheetToHtml(singleCellWorkbook({ v: 1234.5, t: 2 }));
        expect(unboxed(html)).toContain(">1234.5</td>");
    });

    it("marks the table with show-gridlines when the sheet has gridlines enabled", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({ v: "x" }, { showGridlines: 1 })
        );
        expect(html).toMatch(/<table class="spreadsheet-table[^"]*\bshow-gridlines\b[^"]*" style="width:88px">/);
    });

    it("emits an explicit fixed table width summing the visible column widths", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        rowCount: 10,
                        columnCount: 5,
                        defaultColumnWidth: 88,
                        mergeData: [],
                        cellData: { "0": { "0": { v: "a" }, "1": { v: "b" } } },
                        rowData: {},
                        columnData: { "0": { w: 120 } }
                    }
                }
            }
        });
        const html = renderSpreadsheetToHtml(input);
        // Column 0 is 120, column 1 falls back to the default 88 -> 208.
        expect(html).toContain('style="width:208px"');
    });

    it("marks a filled cell with has-fill so gridlines can be suppressed under the fill", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({ v: "x", s: { bg: { rgb: "#f9f9f9" } } }, { showGridlines: 1 })
        );
        expect(html).toContain('class="has-fill"');
    });

    it("marks a cell filled via a referenced style", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: { band: { bg: { rgb: "#f1f1f1" } } },
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        rowCount: 10,
                        columnCount: 5,
                        mergeData: [],
                        cellData: { "0": { "0": { s: "band", v: "x" } } },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });
        const html = renderSpreadsheetToHtml(input);
        expect(html).toContain('class="has-fill"');
    });

    it("does not add has-fill to a cell without a background", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({ v: "x", s: { cl: { rgb: "#414657" } } }, { showGridlines: 1 })
        );
        expect(html).not.toContain("has-fill");
    });

    it("shows gridlines by default when showGridlines is absent (editor default)", () => {
        // singleCellWorkbook does not set showGridlines.
        const html = renderSpreadsheetToHtml(singleCellWorkbook({ v: "x" }));
        expect(html).toMatch(/<table class="spreadsheet-table[^"]*\bshow-gridlines\b/);
    });

    it("omits show-gridlines when the sheet hides gridlines", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({ v: "x" }, { showGridlines: 0 })
        );
        expect(html).toMatch(/<table class="spreadsheet-table[^"]*" style="width:88px">/);
        expect(html).not.toContain("show-gridlines");
    });

    it("emits a custom gridline color as a CSS variable", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({ v: "x" }, { showGridlines: 1, gridlinesColor: "#abcdef" })
        );
        expect(html).toContain("--spreadsheet-gridline-color:#abcdef");
    });

    it("does not emit a gridline color variable when gridlines are hidden", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({ v: "x" }, { showGridlines: 0, gridlinesColor: "#abcdef" })
        );
        expect(html).not.toContain("--spreadsheet-gridline-color");
    });

    it("sanitizes a malicious gridline color", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({ v: "x" }, { showGridlines: 1, gridlinesColor: "#000;background:url(//evil.com)" })
        );
        expect(html).not.toContain("evil.com");
        expect(html).toContain("--spreadsheet-gridline-color:transparent");
    });

    // Builds a workbook whose single sheet carries floating drawings in the
    // SHEET_DRAWING_PLUGIN resource (Univer's z-ordered floating images).
    function workbookWithFloatingDrawings(
        drawings: Array<Record<string, unknown> & { drawingId: string }>,
        opts: { cellData?: unknown; rowData?: unknown; columnData?: unknown; sheetExtra?: Record<string, unknown> } = {}
    ): string {
        const sheetId = "s1";
        const data: Record<string, unknown> = {};
        for (const d of drawings) data[d.drawingId] = d;
        const order = drawings.map((d) => d.drawingId);
        return JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: [sheetId],
                styles: {},
                sheets: {
                    [sheetId]: {
                        id: sheetId,
                        name: "Sheet1",
                        hidden: 0,
                        rowCount: 1000,
                        columnCount: 20,
                        defaultColumnWidth: 88,
                        defaultRowHeight: 24,
                        mergeData: [],
                        cellData: opts.cellData ?? { "0": { "0": { v: "anchor" } } },
                        rowData: opts.rowData ?? {},
                        columnData: opts.columnData ?? {},
                        ...(opts.sheetExtra ?? {})
                    }
                },
                resources: [
                    { name: "SHEET_DRAWING_PLUGIN", data: JSON.stringify({ [sheetId]: { data, order } }) },
                    { name: "SHEET_DATA_VALIDATION_PLUGIN", data: JSON.stringify({ [sheetId]: [] }) }
                ]
            }
        });
    }

    const urlDrawing = (id: string, source: string, transform: Record<string, number>) => ({
        drawingId: id,
        unitId: "u",
        subUnitId: "s1",
        drawingType: 0,
        imageSourceType: "URL",
        source,
        transform
    });

    // #region Cell images (cellData[r][c].p.drawings)

    it("renders a cell image embedded in a cell's rich-text document", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({
                p: {
                    drawings: {
                        d1: {
                            drawingId: "d1",
                            imageSourceType: "URL",
                            source: "api/attachments/NyhtJbXR6Qxh/image/image.png",
                            transform: { width: 113, height: 96.72268495835375 }
                        }
                    },
                    drawingsOrder: ["d1"]
                }
            })
        );
        expect(html).toContain('<img class="spreadsheet-cell-image"');
        expect(html).toContain('src="api/attachments/NyhtJbXR6Qxh/image/image.png"');
        // The image lives inside a table cell, not a floating wrapper.
        expect(html).toContain("<td");
        expect(html).not.toContain("spreadsheet-sheet");
        // Dimensions come from the drawing transform, rounded to 2 decimals.
        expect(html).toContain("width:113px");
        expect(html).toContain("height:96.72px");
    });

    it("renders a base64 cell image", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({
                p: {
                    drawings: {
                        d1: {
                            drawingId: "d1",
                            imageSourceType: "BASE64",
                            source: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
                            transform: { width: 10, height: 10 }
                        }
                    },
                    drawingsOrder: ["d1"]
                }
            })
        );
        expect(html).toContain('src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="');
    });

    it("renders multiple cell images in drawingsOrder", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({
                p: {
                    drawings: {
                        first: { drawingId: "first", source: "api/attachments/AAAAAAAAAAAA/image/a.png", transform: { width: 5, height: 5 } },
                        second: { drawingId: "second", source: "api/attachments/BBBBBBBBBBBB/image/b.png", transform: { width: 5, height: 5 } }
                    },
                    drawingsOrder: ["first", "second"]
                }
            })
        );
        expect(html.indexOf("AAAAAAAAAAAA")).toBeLessThan(html.indexOf("BBBBBBBBBBBB"));
    });

    it("falls back to insertion order when a cell document has no drawingsOrder", () => {
        // `drawingsOrder` is only written once a document has reordered its images, so a
        // single-image cell commonly arrives without it.
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({
                p: {
                    drawings: {
                        first: { drawingId: "first", source: "api/attachments/AAAAAAAAAAAA/image/a.png", transform: { width: 5, height: 5 } },
                        second: { drawingId: "second", source: "api/attachments/BBBBBBBBBBBB/image/b.png", transform: { width: 5, height: 5 } }
                    }
                }
            })
        );
        expect(html.indexOf("AAAAAAAAAAAA")).toBeLessThan(html.indexOf("BBBBBBBBBBBB"));
    });

    it("skips an id in drawingsOrder that has no matching drawing", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({
                p: {
                    drawings: {
                        d1: { drawingId: "d1", source: "api/attachments/AAAAAAAAAAAA/image/a.png", transform: { width: 5, height: 5 } }
                    },
                    drawingsOrder: ["stale", "d1"]
                }
            })
        );
        expect(html.match(/<img/g)?.length).toBe(1);
        expect(html).toContain("AAAAAAAAAAAA");
    });

    it("omits the style attribute when a cell image has no usable dimensions", () => {
        // Univer can store a drawing before its size is measured; the image should still render,
        // just without width/height so it falls back to its intrinsic size.
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({
                p: {
                    drawings: {
                        d1: { drawingId: "d1", source: "api/attachments/AAAAAAAAAAAA/image/a.png" },
                        d2: { drawingId: "d2", source: "api/attachments/BBBBBBBBBBBB/image/b.png", transform: { width: "wide", height: null } }
                    },
                    drawingsOrder: ["d1", "d2"]
                }
            })
        );
        const imgs = html.match(/<img[^>]*>/g) ?? [];
        expect(imgs.length).toBe(2);
        expect(imgs.every((img) => !img.includes("style="))).toBe(true);
    });

    it("emits only the dimension that is present", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({
                p: {
                    drawings: {
                        d1: { drawingId: "d1", source: "api/attachments/AAAAAAAAAAAA/image/a.png", transform: { width: 20 } }
                    },
                    drawingsOrder: ["d1"]
                }
            })
        );
        expect(html).toContain('style="width:20px"');
    });

    it("skips a cell image whose source is missing or not a string", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({
                p: {
                    drawings: {
                        d1: { drawingId: "d1", transform: { width: 10, height: 10 } },
                        d2: { drawingId: "d2", source: 42, transform: { width: 10, height: 10 } }
                    },
                    drawingsOrder: ["d1", "d2"]
                }
            })
        );
        expect(html).not.toContain("<img");
    });

    it("skips a cell image with an unsafe source", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({
                p: {
                    drawings: {
                        d1: { drawingId: "d1", source: "javascript:alert(1)", transform: { width: 10, height: 10 } },
                        d2: { drawingId: "d2", source: "http://evil.example/x.png", transform: { width: 10, height: 10 } }
                    },
                    drawingsOrder: ["d1", "d2"]
                }
            })
        );
        expect(html).not.toContain("<img");
        expect(html).not.toContain("javascript:");
        expect(html).not.toContain("evil.example");
    });

    // #endregion

    // #region Floating images (SHEET_DRAWING_PLUGIN resource)

    it("shows a cropped drawing through its box, with the whole image held inside", () => {
        const cropped = {
            ...urlDrawing("img1", "api/attachments/cgN4jEBCA1Kn/image/image.png", { left: 10, top: 20, width: 100, height: 50 }),
            srcRect: { left: 4, top: 8, right: 6, bottom: 12 }
        };
        const html = renderSpreadsheetToHtml(workbookWithFloatingDrawings([cropped]));

        // The box stays the drawing's own size and clips; the image inside grows by the insets and
        // is pulled back by them, so the visible window is the part the editor shows.
        expect(html).toContain(`<span class="spreadsheet-floating-image" style="position:absolute;left:10px;top:20px;`
            + `width:100px;height:50px;display:block;overflow:hidden">`);
        expect(html).toContain(`<img style="position:absolute;left:-4px;top:-8px;width:110px;height:70px"`);
    });

    it("treats a crop side the drawing leaves out as no inset", () => {
        const html = renderSpreadsheetToHtml(workbookWithFloatingDrawings([{
            ...urlDrawing("img1", "api/attachments/cgN4jEBCA1Kn/image/image.png", { left: 0, top: 0, width: 100, height: 50 }),
            srcRect: { left: 4 }
        }]));

        // Only the left is cut, so the image grows by that alone and is pulled back by it.
        expect(html).toContain(`<img style="position:absolute;left:-4px;top:0px;width:104px;height:50px"`);
    });

    it("leaves a drawing whose crop takes nothing as a bare image", () => {
        const html = renderSpreadsheetToHtml(workbookWithFloatingDrawings([{
            ...urlDrawing("img1", "api/attachments/cgN4jEBCA1Kn/image/image.png", { left: 0, top: 0, width: 100, height: 50 }),
            srcRect: { left: 0, top: 0, right: 0, bottom: 0 }
        }]));

        expect(html).toContain('<img class="spreadsheet-floating-image"');
        expect(html).not.toContain(`<span class="spreadsheet-floating-image"`);
    });

    it("bounds the grid by the cells that hold something, not the ones that only carry formatting", () => {
        // A fill applied across whole rows leaves formatting far past the data. Rendering out to it
        // would cost a cell per column for a band drawn as one rectangle.
        const html = renderSpreadsheetToHtml(JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        mergeData: [],
                        cellData: {
                            "0": { "0": { v: "a", t: 1 }, "1": { v: "b", t: 1 }, "500": { s: { bg: { rgb: "#FFE699" } } } },
                            "1": { "0": { v: "c", t: 1 }, "500": { s: { bg: { rgb: "#FFE699" } } } }
                        },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        }));

        expect((html.match(/<td/g) ?? []).length).toBe(4);
        expect(html).toContain(`<col span="2" style="width:88px">`);
    });

    it("lets a merged banner widen the grid unless it was applied to entire rows", () => {
        const banner = (endColumn: number, columnCount: number) => renderSpreadsheetToHtml(JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        mergeData: [{ startRow: 0, endRow: 0, startColumn: 0, endColumn }],
                        cellData: { "0": { "0": { v: "Banner", t: 1 } }, "1": { "0": { v: "a", t: 1 }, "3": { v: "d", t: 1 } } },
                        rowData: {},
                        columnData: {},
                        rowCount: 1000,
                        columnCount
                    }
                }
            }
        }));

        // Merged by hand: the sheet declares only the columns it uses, so the banner keeps its span.
        expect(banner(25, 26)).toContain(`colspan="26"`);

        // Applied to entire rows: the sheet declares every column Excel has, and the banner is
        // clamped into the content rather than carrying the grid out to meet it.
        expect(banner(16383, 16384)).toContain(`colspan="4"`);
    });

    it("lets a tall merge widen the grid unless it was applied to entire columns", () => {
        const tall = (endRow: number, rowCount: number) => renderSpreadsheetToHtml(JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        mergeData: [{ startRow: 0, endRow, startColumn: 0, endColumn: 0 }],
                        cellData: { "0": { "0": { v: "Side", t: 1 }, "1": { v: "a", t: 1 } }, "1": { "1": { v: "b", t: 1 } } },
                        rowData: {},
                        columnData: {},
                        rowCount,
                        columnCount: 20
                    }
                }
            }
        }));

        // Merged by hand down a sheet shorter than the rows one starts with: the span is kept.
        expect(tall(49, 50)).toContain(`rowspan="50"`);

        // Applied to entire columns, so it covers at least those rows and is clamped to the content.
        expect(tall(999, 1000)).toContain(`rowspan="2"`);
        expect(tall(1048575, 1000)).toContain(`rowspan="2"`);
    });

    it("gives up half an edge to a bordered neighbour when sizing a cell's box", () => {
        // Under border-collapse the wider of two facing borders wins the shared edge, so a cell with
        // none of its own still loses half of its neighbour's. A cell that fills its row exactly,
        // which a turned one does, is a border's half too tall without this.
        const html = renderSpreadsheetToHtml(JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        mergeData: [],
                        rowData: { "0": { h: 40 }, "1": { h: 24 } },
                        columnData: {},
                        cellData: {
                            "0": { "0": { v: "turned", t: 1, s: { tr: { a: 90 } } } },
                            "1": { "0": { v: "bordered", t: 1, s: { bd: { t: { s: BorderStyle.MEDIUM } } } } }
                        }
                    }
                }
            }
        }));

        // 40 less the 2px of padding, less half of the neighbour's 2px border.
        expect(html).toContain("height:37px");
    });

    it("counts a border as structure the grid has to reach, but not a fill", () => {
        const beyond = (style: unknown) => renderSpreadsheetToHtml(JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        mergeData: [],
                        cellData: { "0": { "0": { v: "a", t: 1 } }, "1": { "3": { s: style } } },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        }));

        // An empty bordered cell is a drawn box someone means to keep, so the grid reaches it.
        const bordered = beyond({ bd: { t: { s: BorderStyle.THIN }, b: { s: BorderStyle.THIN } } });
        expect((bordered.match(/<td/g) ?? []).length).toBe(8);
        expect(bordered).toContain("border-top");

        // A fill comes from colouring whole rows, so it does not carry the grid out to meet it.
        expect((beyond({ bg: { rgb: "#FFE699" } }).match(/<td/g) ?? []).length).toBe(1);
        expect((beyond({ bd: { t: { s: BorderStyle.NONE } } }).match(/<td/g) ?? []).length).toBe(1);
    });

    it("falls back to every cell for a sheet that is nothing but formatting", () => {
        const html = renderSpreadsheetToHtml(JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        mergeData: [],
                        cellData: { "0": { "0": { s: { bg: { rgb: "#FFE699" } } }, "1": { s: { bg: { rgb: "#FFE699" } } } } },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        }));

        expect((html.match(/<td/g) ?? []).length).toBe(2);
        expect(html).toContain("background-color:#FFE699");
    });

    it("renders a floating image absolutely positioned in a per-sheet wrapper", () => {
        const html = renderSpreadsheetToHtml(
            workbookWithFloatingDrawings([
                urlDrawing("img1", "api/attachments/cgN4jEBCA1Kn/image/image.png", { left: 50, top: 60, width: 100, height: 80 })
            ])
        );
        expect(html).toContain('<div class="spreadsheet-sheet"');
        expect(html).toContain("position:relative");
        expect(html).toContain('<img class="spreadsheet-floating-image"');
        expect(html).toContain('src="api/attachments/cgN4jEBCA1Kn/image/image.png"');
        expect(html).toContain("position:absolute");
        // Anchor cell is at (0,0), so the origin offset is zero.
        expect(html).toContain("left:50px");
        expect(html).toContain("top:60px");
        expect(html).toContain("width:100px");
        expect(html).toContain("height:80px");
    });

    it("positions a floating image at its absolute sheet coordinates regardless of where data starts", () => {
        // Data only at row 2, col 1. Because the grid is rendered from the sheet origin (A1),
        // the floating image keeps the absolute transform coordinates Univer stored (no offset).
        const html = renderSpreadsheetToHtml(
            workbookWithFloatingDrawings(
                [urlDrawing("img1", "api/attachments/cgN4jEBCA1Kn/image/image.png", { left: 200, top: 100, width: 50, height: 40 })],
                { cellData: { "2": { "1": { v: "x" } } } }
            )
        );
        expect(html).toContain("left:200px");
        expect(html).toContain("top:100px");
    });

    it("extends the grid down to cover a floating image below the data rows", () => {
        const html = renderSpreadsheetToHtml(
            workbookWithFloatingDrawings([
                urlDrawing("img1", "api/attachments/cgN4jEBCA1Kn/image/image.png", { left: 0, top: 0, width: 50, height: 240 })
            ])
        );
        // Default 24px rows: the image bottom at 240px reaches row 9, so 10 rows are emitted.
        const rowCount = (html.match(/<tr/g) ?? []).length;
        expect(rowCount).toBe(10);
    });

    it("extends the grid right to cover a floating image beyond the data columns", () => {
        const html = renderSpreadsheetToHtml(
            workbookWithFloatingDrawings([
                urlDrawing("img1", "api/attachments/cgN4jEBCA1Kn/image/image.png", { left: 0, top: 0, width: 200, height: 10 })
            ])
        );
        // Default 88px columns: the image right edge at 200px reaches column 2, so 3 columns emit,
        // as one `col` spanning them since they share a width.
        expect(html).toContain(`<col span="3" style="width:88px">`);
    });

    it("does not shrink the grid when a floating image fits within the data bounds", () => {
        const html = renderSpreadsheetToHtml(
            workbookWithFloatingDrawings(
                [urlDrawing("img1", "api/attachments/cgN4jEBCA1Kn/image/image.png", { left: 0, top: 0, width: 50, height: 10 })],
                { cellData: { "5": { "0": { v: "x" } } } }
            )
        );
        // Data extends to row 5 (6 rows); the small image must not reduce that.
        const rowCount = (html.match(/<tr/g) ?? []).length;
        expect(rowCount).toBe(6);
    });

    it("preserves floating image z-order", () => {
        const html = renderSpreadsheetToHtml(
            workbookWithFloatingDrawings([
                urlDrawing("img1", "api/attachments/AAAAAAAAAAAA/image/a.png", { left: 0, top: 0, width: 10, height: 10 }),
                urlDrawing("img2", "api/attachments/BBBBBBBBBBBB/image/b.png", { left: 0, top: 0, width: 10, height: 10 })
            ])
        );
        expect(html.indexOf("AAAAAAAAAAAA")).toBeLessThan(html.indexOf("BBBBBBBBBBBB"));
    });

    it("shifts floating images by the row/column header sizes (Univer transforms include headers)", () => {
        // Univer measures transform.left/top from the viewport corner, including the row header
        // (width 46) and column header (height 20). The HTML grid has no headers, so subtract them.
        const html = renderSpreadsheetToHtml(
            workbookWithFloatingDrawings(
                [urlDrawing("img1", "api/attachments/cgN4jEBCA1Kn/image/image.png", { left: 77, top: 208.8, width: 100, height: 80 })],
                { sheetExtra: { rowHeader: { width: 46, hidden: 0 }, columnHeader: { height: 20, hidden: 0 } } }
            )
        );
        expect(html).toContain("left:31px"); // 77 - 46
        expect(html).toContain("top:188.8px"); // 208.8 - 20
    });

    it("does not subtract header sizes when the headers are hidden", () => {
        const html = renderSpreadsheetToHtml(
            workbookWithFloatingDrawings(
                [urlDrawing("img1", "api/attachments/cgN4jEBCA1Kn/image/image.png", { left: 77, top: 208.8, width: 100, height: 80 })],
                { sheetExtra: { rowHeader: { width: 46, hidden: 1 }, columnHeader: { height: 20, hidden: 1 } } }
            )
        );
        expect(html).toContain("left:77px");
        expect(html).toContain("top:208.8px");
    });

    it("rotates a floating image by its transform angle", () => {
        const html = renderSpreadsheetToHtml(
            workbookWithFloatingDrawings([
                { drawingId: "img1", imageSourceType: "URL", source: "api/attachments/cgN4jEBCA1Kn/image/image.png", transform: { left: 0, top: 0, width: 50, height: 50, angle: 45 } }
            ])
        );
        expect(html).toContain("transform:rotate(45deg)");
    });

    it("flips a floating image horizontally and vertically", () => {
        const html = renderSpreadsheetToHtml(
            workbookWithFloatingDrawings([
                { drawingId: "img1", source: "api/attachments/cgN4jEBCA1Kn/image/image.png", transform: { left: 0, top: 0, width: 50, height: 50, flipX: true, flipY: true } }
            ])
        );
        expect(html).toContain("scaleX(-1)");
        expect(html).toContain("scaleY(-1)");
    });

    it("combines rotation and flip (flip first, then rotate)", () => {
        const html = renderSpreadsheetToHtml(
            workbookWithFloatingDrawings([
                { drawingId: "img1", source: "api/attachments/cgN4jEBCA1Kn/image/image.png", transform: { left: 0, top: 0, width: 50, height: 50, angle: 90, flipX: true } }
            ])
        );
        expect(html).toContain("transform:rotate(90deg) scaleX(-1)");
    });

    it("does not emit a transform for an unrotated, unflipped image", () => {
        const html = renderSpreadsheetToHtml(
            workbookWithFloatingDrawings([
                urlDrawing("img1", "api/attachments/cgN4jEBCA1Kn/image/image.png", { left: 0, top: 0, width: 50, height: 50 })
            ])
        );
        expect(html).not.toContain("transform:");
    });

    it("renders a base64 floating image", () => {
        const html = renderSpreadsheetToHtml(
            workbookWithFloatingDrawings([
                { drawingId: "img1", imageSourceType: "BASE64", source: "data:image/jpeg;base64,/9j/4AAQSk==", transform: { left: 0, top: 0, width: 10, height: 10 } }
            ])
        );
        expect(html).toContain('src="data:image/jpeg;base64,/9j/4AAQSk=="');
    });

    it("rounds fractional floating-image coordinates to two decimals", () => {
        const html = renderSpreadsheetToHtml(
            workbookWithFloatingDrawings([
                urlDrawing("img1", "api/attachments/cgN4jEBCA1Kn/image/image.png", { left: 262.3, top: 458.1, width: 549.4, height: 148.555 })
            ])
        );
        expect(html).toContain("width:549.4px");
        expect(html).toContain("height:148.56px");
    });

    it("does not wrap the sheet when all floating drawings have unsafe sources", () => {
        const html = renderSpreadsheetToHtml(
            workbookWithFloatingDrawings([
                { drawingId: "img1", imageSourceType: "URL", source: "http://evil.example/x.png", transform: { left: 0, top: 0, width: 10, height: 10 } }
            ])
        );
        expect(html).not.toContain("spreadsheet-sheet");
        expect(html).not.toContain("<img");
        expect(html).not.toContain("evil.example");
    });

    it("treats a floating image's missing coordinates as zero", () => {
        // Univer writes a transform as soon as an image is inserted, but individual fields can be
        // absent before the image is moved or resized; those must read as 0, not NaN.
        const html = renderSpreadsheetToHtml(
            workbookWithFloatingDrawings([
                { drawingId: "img1", source: "api/attachments/cgN4jEBCA1Kn/image/image.png", transform: { angle: 0 } }
            ])
        );
        expect(html).toContain("left:0px;top:0px;width:0px;height:0px");
    });

    it("extends the grid using the default track sizes when the sheet declares none", () => {
        // A sheet saved without explicit defaults still has to grow enough rows and columns to
        // contain an image that reaches past the last populated cell.
        const html = renderSpreadsheetToHtml(
            workbookWithFloatingDrawings(
                [urlDrawing("img1", "api/attachments/cgN4jEBCA1Kn/image/image.png", { left: 300, top: 200, width: 100, height: 80 })],
                { sheetExtra: { defaultColumnWidth: undefined, defaultRowHeight: undefined, rowCount: undefined, columnCount: undefined } }
            )
        );
        // 280px of height at the default 24px row is ~12 rows; the single-cell sheet had one.
        expect((html.match(/<tr/g) ?? []).length).toBeGreaterThan(5);
        expect(html).toContain("spreadsheet-sheet");
    });

    it("does not grow an axis the images do not reach past", () => {
        // A flat image extends the sheet rightwards only; the vertical walk gets a non-positive
        // target and must stop immediately rather than counting rows.
        const html = renderSpreadsheetToHtml(
            workbookWithFloatingDrawings([
                urlDrawing("img1", "api/attachments/cgN4jEBCA1Kn/image/image.png", { left: 300, top: 0, width: 100, height: 0 })
            ])
        );
        expect((html.match(/<tr/g) ?? []).length).toBe(1);
    });

    it("stops extending an axis whose default track size is degenerate", () => {
        const html = renderSpreadsheetToHtml(
            workbookWithFloatingDrawings(
                [urlDrawing("img1", "api/attachments/cgN4jEBCA1Kn/image/image.png", { left: 0, top: 300, width: 10, height: 100 })],
                { sheetExtra: { defaultRowHeight: 0 } }
            )
        );
        expect((html.match(/<tr/g) ?? []).length).toBe(1);
    });

    it("counts hidden and explicitly sized columns when extending the grid sideways", () => {
        // The column axis has to read the same way as the row one: a hidden column takes none of
        // the image's reach, and a column with a width of its own is counted at it.
        const html = renderSpreadsheetToHtml(
            workbookWithFloatingDrawings(
                [urlDrawing("img1", "api/attachments/cgN4jEBCA1Kn/image/image.png", { left: 0, top: 0, width: 200, height: 10 })],
                { columnData: { "0": { hd: 1 }, "1": { w: 100 }, "2": { w: 100 } } }
            )
        );
        // Column 0 contributes nothing and columns 1-2 contribute 100px each, so the image ends on
        // column 2 and the grid grows to three, of which the hidden one is not emitted.
        expect(html).toContain(`<col span="2" style="width:100px">`);
    });

    it("counts hidden and explicitly sized tracks correctly when extending the grid", () => {
        // Hidden rows occupy no space, so they must not consume any of the image's reach, while
        // rows carrying an explicit height are counted at that height rather than the default.
        const html = renderSpreadsheetToHtml(
            workbookWithFloatingDrawings(
                [urlDrawing("img1", "api/attachments/cgN4jEBCA1Kn/image/image.png", { left: 0, top: 0, width: 10, height: 200 })],
                { rowData: { "0": { hd: 1 }, "1": { h: 100 }, "2": { h: 100 } } }
            )
        );
        // Row 0 contributes nothing, rows 1-2 contribute 100px each: the image ends on row 2, so
        // the grid grows to three rows — of which the hidden one is not emitted.
        expect((html.match(/<tr/g) ?? []).length).toBe(2);
    });

    it("does not add a floating wrapper to a sheet without drawings", () => {
        const html = renderSpreadsheetToHtml(singleCellWorkbook({ v: "x" }));
        expect(html).not.toContain("spreadsheet-sheet");
        expect(html).not.toContain("<img");
    });

    it("escapes a quote in an attachment-image source", () => {
        // A crafted source that passes the prefix check but carries an attribute-breaking quote.
        const html = renderSpreadsheetToHtml(
            workbookWithFloatingDrawings([
                urlDrawing("img1", 'api/attachments/AAAAAAAAAAAA/image/"onerror=alert(1).png', { left: 0, top: 0, width: 10, height: 10 })
            ])
        );
        expect(html).not.toContain('"onerror=alert(1)');
        expect(html).toContain("&quot;onerror");
    });

    // #endregion

    // Wraps a single value placed at an arbitrary (row, col) into a complete workbook payload.
    function cellAtWorkbook(row: number, col: number): string {
        return JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        rowCount: 1000,
                        columnCount: 20,
                        defaultColumnWidth: 88,
                        defaultRowHeight: 24,
                        mergeData: [],
                        cellData: { [row]: { [col]: { v: "x" } } },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });
    }

    it("renders leading empty rows so the grid starts at the sheet origin", () => {
        // Data only at row 2 -> rows 0 and 1 must still be emitted (empty) so the grid keeps the
        // editor's geometry and absolutely-positioned floating images line up.
        const html = renderSpreadsheetToHtml(cellAtWorkbook(2, 0));
        const rowCount = (html.match(/<tr/g) ?? []).length;
        expect(rowCount).toBe(3);
    });

    it("renders leading empty columns so the grid starts at the sheet origin", () => {
        // Data only at column 2 -> columns 0 and 1 must still be emitted.
        const html = renderSpreadsheetToHtml(cellAtWorkbook(0, 2));
        // Three columns of the same width, so one `col` spans them.
        expect(html).toContain(`<col span="3" style="width:88px">`);
    });

    it("extends bounds to cover a merge range that exceeds the cell data", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        rowCount: 10,
                        columnCount: 5,
                        // Data only at the origin (2,2); merge starts before and ends after it,
                        // so computeBounds must extend min/max in every direction.
                        mergeData: [{ startRow: 1, endRow: 4, startColumn: 1, endColumn: 4 }],
                        cellData: { "2": { "2": { v: "center" } } },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });
        const html = renderSpreadsheetToHtml(input);
        // The merge origin (1,1) spans a 4x4 area extending beyond the single data cell at (2,2).
        expect(html).toContain('rowspan="4"');
        expect(html).toContain('colspan="4"');
    });
});

describe("style deduplication", () => {
    const gridWorkbook = (cellData: Record<string, unknown>) => JSON.stringify({
        version: 1,
        workbook: {
            sheetOrder: ["s1"],
            styles: {},
            sheets: {
                s1: {
                    id: "s1", name: "Sheet1", hidden: 0, rowCount: 1000, columnCount: 20,
                    mergeData: [], cellData, rowData: {}, columnData: {}
                }
            }
        }
    });

    // One cell per row, so none has an occupied neighbour and none of them clips.
    const rows = (...cells: unknown[]) => Object.fromEntries(cells.map((cell, row) => [String(row), { "0": cell }]));
    const bold = { v: "x", t: 1, s: { bl: 1 } };
    const italic = { v: "y", t: 1, s: { it: 1 } };

    it("writes a style shared by many cells once, and puts the stylesheet in front", () => {
        const html = renderRaw(gridWorkbook(rows(bold, bold, bold, italic)));

        expect(html.startsWith("<style>")).toBe(true);
        // One rule for the three bold cells, not three copies of the declaration.
        expect(html.match(/font-weight:bold/g)).toHaveLength(1);

        // The minority style gets its own rule, used by the one cell that has it.
        const name = /\.spreadsheet-table(?::where\(\.[\w-]+\))? \.(sst-[\w-]+)\{font-style:italic/.exec(html)?.[1];
        expect(name).toBeTruthy();
        expect(html.match(new RegExp(`class="${name}"`, "g"))).toHaveLength(1);
    });

    it("scopes every rule under the table so a class cannot reach the rest of the page", () => {
        const stylesheet = /^<style>([\s\S]*?)<\/style>/.exec(renderRaw(gridWorkbook(rows(bold, italic))))?.[1] ?? "";

        expect(stylesheet).toBeTruthy();
        for (const rule of stylesheet.split("}").map((r) => r.trim()).filter(Boolean)) {
            // Cell rules, and the gridline rule whose context sits in :where(); neither can
            // match anything outside a rendered sheet.
            expect(rule).toMatch(/^(\.spreadsheet-table(:where\(\.[\w-]+\))? (\.sst-|td\{)|:where\(\.spreadsheet-table)/);
        }
    });

    it("emits the gridline rule only for a workbook that asks for gridlines", () => {
        const cells = { "0": { "0": { v: "x", t: 1 } } };
        const withGridlines = renderRaw(gridWorkbook(cells));
        expect(withGridlines).toContain(":where(.spreadsheet-table.show-gridlines) td:not(.has-fill)");

        const off = JSON.parse(gridWorkbook(cells));
        off.workbook.sheets.s1.showGridlines = 0;
        expect(renderRaw(JSON.stringify(off))).not.toContain("show-gridlines");
    });

    it("names a class after its declarations, so two documents share rather than collide", () => {
        // Bold dominates in both, so italic is the one left carrying a class.
        const nameIn = (html: string) =>
            /\.spreadsheet-table(?::where\(\.[\w-]+\))? \.(sst-[\w-]+)\{font-style:italic/.exec(html)?.[1];
        const one = renderRaw(gridWorkbook(rows(bold, bold, italic)));
        const other = renderRaw(gridWorkbook(rows(bold, bold, italic, bold)));

        expect(nameIn(one)).toBeTruthy();
        expect(nameIn(one)).toBe(nameIn(other));
        // A different declaration gets a different name.
        const underlined = renderRaw(gridWorkbook(rows(bold, bold, { v: "y", t: 1, s: { ul: { s: 1 } } })));
        expect(nameIn(one)).not.toBe(
            /\.spreadsheet-table(?::where\(\.[\w-]+\))? \.(sst-[\w-]+)\{text-decoration/.exec(underlined)?.[1]);
    });

    it("keeps has-fill alongside the generated class, and emits no stylesheet for an empty sheet", () => {
        const filled = { v: "x", t: 1, s: { bg: { rgb: "#FFE699" } } };
        expect(renderRaw(gridWorkbook(rows(bold, bold, filled)))).toMatch(/<td class="has-fill sst-[\w-]+"/);

        expect(renderRaw(JSON.stringify({ version: 1, workbook: { sheetOrder: [], styles: {}, sheets: {} } })))
            .not.toContain("<style>");
    });

    it("writes no stylesheet for a sheet that renders nothing to style", () => {
        // A visible sheet holding no cells never reaches its colgroup or its rows, so nothing
        // asks for a class; with gridlines off there is no rule to write either, and the
        // document is the empty-sheet notice on its own.
        const html = renderRaw(JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1", name: "Sheet1", hidden: 0, rowCount: 10, columnCount: 5,
                        showGridlines: 0, mergeData: [], cellData: {}, rowData: {}, columnData: {}
                    }
                }
            }
        }));

        expect(html).toBe("<p>Empty sheet.</p>");
    });
});

describe("dark mode", () => {
    const cellWorkbook = (cell: Record<string, unknown>) => JSON.stringify({
        version: 1,
        workbook: {
            sheetOrder: ["s1"], styles: {},
            sheets: {
                s1: {
                    id: "s1", name: "S", hidden: 0, rowCount: 5, columnCount: 5, showGridlines: 0,
                    mergeData: [], cellData: { "0": { "0": cell } }, rowData: {}, columnData: {}
                }
            }
        }
    });

    it("pairs a fill and its text with what a dark theme shows instead", () => {
        const html = renderRaw(cellWorkbook({ v: "x", t: 1, s: { bg: { rgb: "#FFE699" } } }));

        // Pale yellow darkens to brown rather than to the blue a plain 255-c would give, and the
        // automatic font colour it sits on flips the other way.
        expect(html).toContain("background-color:light-dark(#FFE699,#543b00)");
        expect(html).toContain("color:light-dark(#000,#ffffff)");
    });

    it("pairs a border colour too, as Univer inverts every colour it paints", () => {
        const html = renderRaw(cellWorkbook({
            v: "x", t: 1, s: { bd: { t: { s: 1, cl: { rgb: "#203864" } }, b: { s: 1 } } }
        }));

        expect(html).toContain("border-top:1px solid light-dark(#203864,#a2bae6)");
        // A border with no colour of its own defaults to black, which inverts to white.
        expect(html).toContain("border-bottom:1px solid light-dark(#000,#ffffff)");
    });

    it("inverts a named colour a number format asks for", () => {
        const html = renderRaw(cellWorkbook({
            v: -8800.2, t: 2, s: { n: { pattern: "#,##0.00;[Red]#,##0.00" } }
        }));

        expect(html).toContain("color:light-dark(red,#ff5555)");
    });

    it("leaves a colour it cannot read alone rather than dropping it", () => {
        // sanitizeCssColor passes rgb() through, and nothing in a workbook produces one, so it has
        // no dark half; emitting it unpaired is better than emitting nothing.
        const html = renderRaw(cellWorkbook({ v: "x", t: 1, s: { cl: { rgb: "rgb(1,2,3)" } } }));

        expect(html).toContain("color:rgb(1,2,3)");
        expect(html).not.toContain("light-dark(rgb");
    });

    it("inverts a grey to its exact complement", () => {
        const html = renderRaw(cellWorkbook({ v: "x", t: 1, s: { bg: { rgb: "#DBDBDB" } } }));
        expect(html).toContain("background-color:light-dark(#DBDBDB,#242424)");
    });
});
/**
 * The renderer builds a cell's declarations once per style and reuses them across the cells that
 * share it. These cover what the reuse has to keep apart: two cells sharing a style still differ
 * wherever the declarations depend on the cell rather than on the style alone.
 */
describe("reuse of a style across cells", () => {
    const workbook = (styles: Record<string, unknown>, cellData: Record<string, Record<string, unknown>>, mergeData: unknown[] = []) =>
        JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"], styles,
                sheets: {
                    s1: {
                        id: "s1", name: "S", hidden: 0, rowCount: 5, columnCount: 5, showGridlines: 0,
                        mergeData, cellData, rowData: {}, columnData: {}
                    }
                }
            }
        });

    /** The rendered cells in document order, with their sizing box and padding stripped. */
    function cells(input: string): string[] {
        return [...unboxed(renderSpreadsheetToHtml(input)).matchAll(/<td[^>]*>[\s\S]*?<\/td>/g)].map(([cell]) => cell);
    }

    it("keeps the alignment a value type implies, which the style does not carry", () => {
        // Univer aligns a number right and a string left when the style sets none, so two cells on
        // one style still align differently. The number comes first, so a reuse blind to the value
        // type would align the string right as well.
        const [number, string] = cells(workbook(
            { st1: { ff: "Arial" } },
            { "0": { "0": { v: 5, t: 2, s: "st1" }, "1": { v: "x", t: 1, s: "st1" } } }
        ));

        expect(number).toContain("text-align:right");
        expect(string).not.toContain("text-align:right");
    });

    it("colors each value by its own number-format section", () => {
        // `[Red]` applies to the negative section alone, so the color follows the value rather than
        // the style the two cells share.
        const [positive, negative] = cells(workbook(
            { st1: { n: { pattern: "#,##0;[Red]#,##0" } } },
            { "0": { "0": { v: 5, t: 2, s: "st1" }, "1": { v: -5, t: 2, s: "st1" } } }
        ));

        expect(positive).not.toContain("color:red");
        expect(negative).toContain("color:red");
    });

    it("keeps a merged range's composed border off the cells that share its style", () => {
        // A range takes its right border from the cell in its last column, so the anchor renders
        // declarations its style does not resolve to on its own.
        const [anchor, plain] = cells(workbook(
            { st1: { bl: 1 }, edge: { bd: { r: { s: BorderStyle.THIN, cl: { rgb: "#ff0000" } } } } },
            {
                "0": { "0": { v: "merged", t: 1, s: "st1" }, "1": { v: "", t: 1, s: "edge" } },
                "1": { "0": { v: "plain", t: 1, s: "st1" } }
            },
            [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 }]
        ));

        expect(anchor).toContain("border-right:1px solid #ff0000");
        expect(plain).not.toContain("border-right");
    });

    it("tells two inline styles apart, which carry no shared id to reuse by", () => {
        const [bold, italic] = cells(workbook(
            {},
            { "0": { "0": { v: "a", t: 1, s: { bl: 1 } }, "1": { v: "b", t: 1, s: { it: 1 } } } }
        ));

        expect(bold).toContain("font-weight:bold");
        expect(bold).not.toContain("font-style:italic");
        expect(italic).toContain("font-style:italic");
        expect(italic).not.toContain("font-weight:bold");
    });

    it("darkens each color to its own dark half", () => {
        // An inversion is reused per color within a render and between renders, so two fills must
        // not collapse onto whichever was asked for first.
        const input = workbook(
            { pale: { bg: { rgb: "#FFE699" } }, grey: { bg: { rgb: "#DBDBDB" } } },
            { "0": { "0": { v: "a", t: 1, s: "pale" }, "1": { v: "b", t: 1, s: "grey" } } }
        );
        const html = renderRaw(input);

        expect(html).toContain("background-color:light-dark(#FFE699,#543b00)");
        expect(html).toContain("background-color:light-dark(#DBDBDB,#242424)");
        expect(renderRaw(input)).toBe(html);
    });

    it("escapes every character that has to be escaped, each on its own", () => {
        // One character per cell: a cell holding all five would still be escaped by a check that
        // recognised only one of them.
        const raw = ["&", "<", ">", "\"", "'"];
        const rendered = cells(workbook({}, {
            "0": Object.fromEntries(raw.map((character, index) => [String(index), { v: character, t: 1 }]))
        }));

        expect(rendered.map((cell) => /<td[^>]*>([\s\S]*)<\/td>/.exec(cell)?.[1]))
            .toEqual(["&amp;", "&lt;", "&gt;", "&quot;", "&#39;"]);
    });
});

describe("trimmed rendering", () => {
    const bigWorkbook = () => {
        const cellData: Record<string, Record<string, unknown>> = {};
        for (let row = 0; row < 60; row++) {
            cellData[row] = {};
            for (let col = 0; col < 40; col++) cellData[row][col] = { v: `r${row}c${col}`, t: 1 };
        }
        return JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1", "s2"],
                styles: {},
                sheets: {
                    s1: {
                        id: "s1", name: "First", hidden: 0, rowCount: 100, columnCount: 50,
                        mergeData: [], cellData, rowData: {}, columnData: {}
                    },
                    s2: {
                        id: "s2", name: "Second", hidden: 0, rowCount: 10, columnCount: 5,
                        mergeData: [], cellData: { "0": { "0": { v: "elsewhere", t: 1 } } },
                        rowData: {}, columnData: {}
                    }
                }
            }
        });
    };

    it("keeps the corner of the first sheet and drops the rest", () => {
        const full = renderRaw(bigWorkbook());
        const trimmed = renderRaw(bigWorkbook(), { trim: true });

        // 60x40 plus the second sheet's one cell, down to the 20x15 corner a card has room for.
        expect((full.match(/<td/g) ?? []).length).toBe(60 * 40 + 1);
        expect((trimmed.match(/<td/g) ?? []).length).toBe(20 * 15);
        expect(trimmed).toContain("r0c0");
        expect(trimmed).toContain("r19c14");
        expect(trimmed).not.toContain("r20c0");
        expect(trimmed).not.toContain("r0c15");
        expect(trimmed.length).toBeLessThan(full.length / 5);
    });

    it("renders only the first visible sheet, without its heading", () => {
        const trimmed = renderRaw(bigWorkbook(), { trim: true });

        expect(trimmed).not.toContain("elsewhere");
        // One sheet needs no heading to tell it apart.
        expect(trimmed).not.toContain("<h3>");
        expect((trimmed.match(/<table/g) ?? []).length).toBe(1);
    });

    it("leaves a sheet smaller than the corner alone", () => {
        const small = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"], styles: {},
                sheets: {
                    s1: {
                        id: "s1", name: "S", hidden: 0, rowCount: 10, columnCount: 5,
                        mergeData: [], cellData: { "0": { "0": { v: "a", t: 1 }, "1": { v: "b", t: 1 } } },
                        rowData: {}, columnData: {}
                    }
                }
            }
        });

        expect(renderRaw(small, { trim: true })).toBe(renderRaw(small));
    });
});
