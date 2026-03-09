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
});
