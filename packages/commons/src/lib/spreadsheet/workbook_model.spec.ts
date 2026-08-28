import { describe, expect, it } from "vitest";

import {
    getCellDocumentSegments,
    getCellDocumentText,
    getDataValidations,
    getFloatingDrawings,
    type IWorkbookData,
    normalizeDataStream,
    SHEET_DATA_VALIDATION_RESOURCE,
    SHEET_DRAWING_RESOURCE
} from "./workbook_model.js";

/** Minimal workbook carrying a single plugin resource, which is the only input these readers use. */
function workbookWithResource(name: string, data: string): IWorkbookData {
    return { sheetOrder: ["sheet1"], sheets: {}, resources: [{ name, data }] };
}

describe("getFloatingDrawings", () => {
    it("returns the sheet's drawings in their stored z-order", () => {
        const workbook = workbookWithResource(SHEET_DRAWING_RESOURCE, JSON.stringify({
            sheet1: {
                data: { d1: { drawingId: "d1" }, d2: { drawingId: "d2" } },
                order: ["d2", "d1"]
            }
        }));

        expect(getFloatingDrawings(workbook, "sheet1").map((d) => d.drawingId)).toEqual(["d2", "d1"]);
    });

    it("falls back to insertion order when `order` is missing or not an array", () => {
        // Univer omits `order` for workbooks that never reordered their drawings, and a
        // hand-edited or older payload can carry a non-array there; neither should lose images.
        const payload = { data: { d1: { drawingId: "d1" }, d2: { drawingId: "d2" } } };

        for (const order of [undefined, null, "d1,d2", {}]) {
            const workbook = workbookWithResource(SHEET_DRAWING_RESOURCE, JSON.stringify({
                sheet1: { ...payload, order }
            }));
            expect(getFloatingDrawings(workbook, "sheet1").map((d) => d.drawingId)).toEqual(["d1", "d2"]);
        }
    });

    it("drops ids in `order` that have no matching drawing", () => {
        const workbook = workbookWithResource(SHEET_DRAWING_RESOURCE, JSON.stringify({
            sheet1: { data: { d1: { drawingId: "d1" } }, order: ["missing", "d1"] }
        }));

        expect(getFloatingDrawings(workbook, "sheet1").map((d) => d.drawingId)).toEqual(["d1"]);
    });

    it("returns nothing when the resource is absent, empty, unparseable or has no data for the sheet", () => {
        const emptyWorkbook: IWorkbookData = { sheetOrder: ["sheet1"], sheets: {} };
        expect(getFloatingDrawings(emptyWorkbook, "sheet1")).toEqual([]);

        // A different plugin's resource, and a resource whose payload never got written.
        expect(getFloatingDrawings(workbookWithResource("SOME_OTHER_PLUGIN", "{}"), "sheet1")).toEqual([]);
        expect(getFloatingDrawings(workbookWithResource(SHEET_DRAWING_RESOURCE, ""), "sheet1")).toEqual([]);

        // Truncated/corrupt JSON must degrade to "no images" rather than break the whole render.
        expect(getFloatingDrawings(workbookWithResource(SHEET_DRAWING_RESOURCE, "{ not json"), "sheet1")).toEqual([]);

        // Valid JSON, but nothing for this sheet: absent entry, null root, and an entry with no `data`.
        expect(getFloatingDrawings(workbookWithResource(SHEET_DRAWING_RESOURCE, "{}"), "sheet1")).toEqual([]);
        expect(getFloatingDrawings(workbookWithResource(SHEET_DRAWING_RESOURCE, "null"), "sheet1")).toEqual([]);
        expect(getFloatingDrawings(
            workbookWithResource(SHEET_DRAWING_RESOURCE, JSON.stringify({ sheet1: { order: ["d1"] } })),
            "sheet1"
        )).toEqual([]);
    });
});

describe("getDataValidations", () => {
    it("returns the sheet's rules", () => {
        const rule = { uid: "v1", type: "list", formula1: '["a","b"]', ranges: [] };
        const workbook = workbookWithResource(SHEET_DATA_VALIDATION_RESOURCE, JSON.stringify({ sheet1: [rule] }));

        expect(getDataValidations(workbook, "sheet1")).toEqual([rule]);
    });

    it("drops empty entries within the rule list", () => {
        const rule = { uid: "v1", type: "whole", operator: "greaterThan", formula1: "0", ranges: [] };
        const workbook = workbookWithResource(
            SHEET_DATA_VALIDATION_RESOURCE,
            JSON.stringify({ sheet1: [null, rule, undefined] })
        );

        expect(getDataValidations(workbook, "sheet1")).toEqual([rule]);
    });

    it("returns nothing when the resource is absent, empty, unparseable or holds no rule list", () => {
        const emptyWorkbook: IWorkbookData = { sheetOrder: ["sheet1"], sheets: {} };
        expect(getDataValidations(emptyWorkbook, "sheet1")).toEqual([]);

        expect(getDataValidations(workbookWithResource("SOME_OTHER_PLUGIN", "{}"), "sheet1")).toEqual([]);
        expect(getDataValidations(workbookWithResource(SHEET_DATA_VALIDATION_RESOURCE, ""), "sheet1")).toEqual([]);
        expect(getDataValidations(workbookWithResource(SHEET_DATA_VALIDATION_RESOURCE, "{ not json"), "sheet1")).toEqual([]);

        // Valid JSON, but this sheet has no entry, the root is null, or the entry is not a list.
        expect(getDataValidations(workbookWithResource(SHEET_DATA_VALIDATION_RESOURCE, "{}"), "sheet1")).toEqual([]);
        expect(getDataValidations(workbookWithResource(SHEET_DATA_VALIDATION_RESOURCE, "null"), "sheet1")).toEqual([]);
        expect(getDataValidations(
            workbookWithResource(SHEET_DATA_VALIDATION_RESOURCE, JSON.stringify({ sheet1: { uid: "v1" } })),
            "sheet1"
        )).toEqual([]);
    });
});

describe("getCellDocumentText", () => {
    it("reads the rich-text document, dropping the terminator and structural characters", () => {
        expect(getCellDocumentText({ p: { body: { dataStream: "Pen\r\n" } } })).toBe("Pen");
        expect(getCellDocumentText({ p: { body: { dataStream: "first\rsecond\r\n" } } })).toBe("first\nsecond");
        expect(getCellDocumentText({ p: { body: { dataStream: "logo\b\r\n" } } })).toBe("logo");
    });

    it("returns an empty string when the cell carries no document text", () => {
        expect(getCellDocumentText(undefined)).toBe("");
        expect(getCellDocumentText({ v: "plain" })).toBe("");
        expect(getCellDocumentText({ p: { drawings: {} } })).toBe("");
        expect(getCellDocumentText({ p: { body: { dataStream: "\r\n" } } })).toBe("");
        expect(normalizeDataStream(42)).toBe("");
    });
});

describe("getCellDocumentSegments", () => {
    it("cuts the document into plain and linked runs", () => {
        const segments = getCellDocumentSegments({
            p: {
                body: {
                    dataStream: "see supplier now\r\n",
                    customRanges: [{ startIndex: 4, endIndex: 11, properties: { url: "https://example.com" } }]
                }
            }
        });

        expect(segments).toEqual([
            { text: "see " },
            { text: "supplier", url: "https://example.com" },
            { text: " now" }
        ]);
    });

    it("ignores a range whose offsets describe no span", () => {
        const segmentsFor = (startIndex: number, endIndex: number) => getCellDocumentSegments({
            p: {
                body: {
                    dataStream: "Pen\r\n",
                    customRanges: [{ startIndex, endIndex, properties: { url: "https://example.com" } }]
                }
            }
        });

        // Reversed offsets, then a range starting past the end of the stream.
        expect(segmentsFor(2, 0)).toEqual([{ text: "Pen" }]);
        expect(segmentsFor(9, 12)).toEqual([{ text: "Pen" }]);
    });

    it("keeps the trailing terminator out of a run that ends the document", () => {
        expect(getCellDocumentSegments({
            p: {
                body: {
                    dataStream: "Pen\r\n",
                    customRanges: [{ startIndex: 0, endIndex: 4, properties: { url: "https://example.com" } }]
                }
            }
        })).toEqual([{ text: "Pen", url: "https://example.com" }]);
    });
});
