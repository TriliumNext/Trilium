import { describe, expect, it } from "vitest";
import { renderSpreadsheetToHtml } from "./render_to_html.js";

describe("renderSpreadsheetToHtml", () => {
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

        const html = renderSpreadsheetToHtml(input);
        expect(html).not.toContain("<script>");
        expect(html).not.toContain("</style>");
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
        expect(html).toContain("<td>noStyle</td>");
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
        expect(html).toContain("<td>x</td>");
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
        expect(html).not.toContain("vertical-align");
        expect(html).toContain("<td>x</td>");
    });

    it("renders borders on all four sides with widths and styles", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({
                v: "bordered",
                s: {
                    bd: {
                        t: { s: 1, cl: { rgb: "#111111" } }, // THIN -> 1px solid
                        r: { s: 6, cl: { rgb: "#222222" } }, // MEDIUM -> 2px solid
                        b: { s: 9, cl: { rgb: "#333333" } }, // THICK -> 3px solid
                        l: { s: 3, cl: { rgb: "#444444" } } // DASHED -> 1px dashed
                    }
                }
            })
        );
        expect(html).toContain("border-top:1px solid #111111");
        expect(html).toContain("border-right:2px solid #222222");
        expect(html).toContain("border-bottom:3px solid #333333");
        expect(html).toContain("border-left:1px dashed #444444");
    });

    it("renders dotted border style and defaults missing border color to #000", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({
                v: "dotted",
                s: {
                    bd: {
                        t: { s: 4 } // DOTTED, no color -> default #000
                    }
                }
            })
        );
        expect(html).toContain("border-top:1px dotted #000");
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
        // null style id and empty style object -> plain <td>.
        expect(html).toContain("<td>nulled</td>");
        expect(html).toContain("<td>emptyStyle</td>");
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
        expect(html).toContain('<tr style="height:50px">');
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
        expect(html).toContain('<tr style="height:24px">');
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
        expect(html).toContain("<td>A</td>");
        expect(html).toContain("<td></td>");
        expect(html).toContain("<td>C</td>");
    });

    it("renders numeric cell values", () => {
        const html = renderSpreadsheetToHtml(singleCellWorkbook({ v: 42, t: 2 }));
        expect(html).toContain("<td>42</td>");
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
