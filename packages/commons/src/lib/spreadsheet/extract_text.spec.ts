import { describe, expect, it } from "vitest";
import { extractSpreadsheetText } from "./extract_text.js";

describe("extractSpreadsheetText", () => {
    it("extracts cell values from a basic spreadsheet", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        cellData: {
                            "1": { "1": { v: "The", t: 1 } },
                            "2": { "2": { v: "quick", t: 1 } },
                            "3": { "3": { v: "brown", t: 1 } },
                            "4": { "1": { v: "fox", t: 1 } }
                        },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });

        const text = extractSpreadsheetText(input);
        expect(text).toBe("The quick brown fox");
    });

    it("skips hidden sheets", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1", "s2"],
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Visible",
                        hidden: 0,
                        cellData: { "0": { "0": { v: "shown" } } },
                        rowData: {},
                        columnData: {}
                    },
                    s2: {
                        id: "s2",
                        name: "Hidden",
                        hidden: 1,
                        cellData: { "0": { "0": { v: "secret" } } },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });

        const text = extractSpreadsheetText(input);
        expect(text).toContain("shown");
        expect(text).not.toContain("secret");
    });

    it("skips hidden rows", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        cellData: {
                            "0": { "0": { v: "visible row" } },
                            "1": { "0": { v: "hidden row" } }
                        },
                        rowData: { "1": { hd: 1 } },
                        columnData: {}
                    }
                }
            }
        });

        const text = extractSpreadsheetText(input);
        expect(text).toContain("visible row");
        expect(text).not.toContain("hidden row");
    });

    it("skips hidden columns", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        cellData: {
                            "0": {
                                "0": { v: "visible col" },
                                "1": { v: "hidden col" }
                            }
                        },
                        rowData: {},
                        columnData: { "1": { hd: 1 } }
                    }
                }
            }
        });

        const text = extractSpreadsheetText(input);
        expect(text).toContain("visible col");
        expect(text).not.toContain("hidden col");
    });

    it("extracts text from multiple visible sheets", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1", "s2"],
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Data",
                        hidden: 0,
                        cellData: { "0": { "0": { v: "alpha" } } },
                        rowData: {},
                        columnData: {}
                    },
                    s2: {
                        id: "s2",
                        name: "Summary",
                        hidden: 0,
                        cellData: { "0": { "0": { v: "beta" } } },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });

        const text = extractSpreadsheetText(input);
        expect(text).toContain("alpha");
        expect(text).toContain("beta");
    });

    it("handles boolean values", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
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

        const text = extractSpreadsheetText(input);
        expect(text).toContain("TRUE");
        expect(text).toContain("FALSE");
    });

    it("handles numeric values", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        cellData: {
                            "0": { "0": { v: 42 }, "1": { v: 3.14 } }
                        },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });

        const text = extractSpreadsheetText(input);
        expect(text).toContain("42");
        expect(text).toContain("3.14");
    });

    it("skips cells with null or undefined values", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        cellData: {
                            "0": {
                                "0": { v: "data" },
                                "1": { v: null },
                                "2": {},
                                "3": { s: "someStyle" }
                            }
                        },
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });

        const text = extractSpreadsheetText(input);
        expect(text).toBe("data");
    });

    it("returns empty string for invalid JSON", () => {
        expect(extractSpreadsheetText("not json")).toBe("");
    });

    it("returns empty string for empty workbook", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0,
                        cellData: {},
                        rowData: {},
                        columnData: {}
                    }
                }
            }
        });

        expect(extractSpreadsheetText(input)).toBe("");
    });

    it("returns empty string for missing workbook", () => {
        expect(extractSpreadsheetText(JSON.stringify({ version: 1 }))).toBe("");
    });

    it("handles sheet with missing cellData", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                sheets: {
                    s1: {
                        id: "s1",
                        name: "Sheet1",
                        hidden: 0
                    }
                }
            }
        });

        expect(extractSpreadsheetText(input)).toBe("");
    });

    it("handles lowercased JSON from normalize()", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                sheetOrder: ["s1"],
                sheets: {
                    s1: {
                        id: "s1",
                        name: "sheet1",
                        hidden: 0,
                        cellData: {
                            "0": { "0": { v: "hello" } }
                        },
                        rowData: { "1": { hd: 1 } },
                        columnData: { "2": { hd: 1 } }
                    }
                }
            }
        }).toLowerCase();

        expect(extractSpreadsheetText(input)).toBe("hello");
    });

    it("extracts text from the sample spreadsheet", () => {
        const input = JSON.stringify({
            version: 1,
            workbook: {
                id: "vlyRSv",
                sheetOrder: ["YdJwCRPZnEn4twLYtcdrE"],
                name: "",
                appVersion: "0.20.1",
                locale: "zhCN",
                styles: {
                    yIwJoC: { bl: 1 },
                    bTNHmx: { it: 1 },
                    "6ZCsr1": { ff: "Arial" }
                },
                sheets: {
                    YdJwCRPZnEn4twLYtcdrE: {
                        id: "YdJwCRPZnEn4twLYtcdrE",
                        name: "Sheet1",
                        hidden: 0,
                        rowCount: 1000,
                        columnCount: 20,
                        defaultColumnWidth: 88,
                        defaultRowHeight: 24,
                        mergeData: [],
                        cellData: {
                            "1": { "1": { v: "The", t: 1 } },
                            "2": { "2": { v: "quick", t: 1 } },
                            "3": { "3": { s: "yIwJoC", v: "brown", t: 1 } },
                            "4": { "1": { s: "bTNHmx", v: "fox", t: 1 } },
                            "8": {
                                "0": { s: "6ZCsr1" },
                                "3": { v: "This text is available only in the spreadsheet", t: 1 }
                            }
                        },
                        rowData: {},
                        columnData: {},
                        showGridlines: 1
                    }
                }
            }
        });

        const text = extractSpreadsheetText(input);
        expect(text).toContain("The");
        expect(text).toContain("quick");
        expect(text).toContain("brown");
        expect(text).toContain("fox");
        expect(text).toContain("This text is available only in the spreadsheet");
    });
});
