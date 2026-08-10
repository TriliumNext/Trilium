import { describe, expect, it } from "vitest";

import {
    getDataValidations,
    getFloatingDrawings,
    type IWorkbookData,
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
