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
        expect(html).not.toContain("vertical-align");
        expect(html).toContain("<td>x</td>");
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

    it("formats a numeric cell using its number-format pattern", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({ v: 1234.5, t: 2, s: { n: { pattern: "#,##0.00" } } })
        );
        expect(html).toContain("<td>1,234.50</td>");
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
        expect(html).toContain("<td>n/a</td>");
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
        expect(html).toContain("<td>1234.5</td>");
    });

    it("marks the table with show-gridlines when the sheet has gridlines enabled", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({ v: "x" }, { showGridlines: 1 })
        );
        expect(html).toContain('<table class="spreadsheet-table show-gridlines" style="width:88px">');
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
        expect(html).toContain("spreadsheet-table show-gridlines");
    });

    it("omits show-gridlines when the sheet hides gridlines", () => {
        const html = renderSpreadsheetToHtml(
            singleCellWorkbook({ v: "x" }, { showGridlines: 0 })
        );
        expect(html).toContain('<table class="spreadsheet-table" style="width:88px">');
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
        // Default 88px columns: the image right edge at 200px reaches column 2, so 3 columns emit.
        const colCount = (html.match(/<col /g) ?? []).length;
        expect(colCount).toBe(3);
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
        const colCount = (html.match(/<col /g) ?? []).length;
        expect(colCount).toBe(3);
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
