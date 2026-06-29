import { IWorkbookData, LocaleType } from "@univerjs/presets";
import { describe, expect, it } from "vitest";

import { collectBase64DrawingSources, slimWorkbookData, uploadNewDrawingImages } from "./persistence";

function makeWorkbook(workbook: Partial<IWorkbookData>): IWorkbookData {
    return workbook as IWorkbookData;
}

/** Builds a SHEET_DRAWING_PLUGIN resource holding the given drawing nodes on a single sheet. */
function drawingResource(images: Record<string, { imageSourceType: string; source: string }>) {
    return {
        name: "SHEET_DRAWING_PLUGIN",
        data: JSON.stringify({ "sheet-1": { data: images, order: Object.keys(images) } })
    };
}

function readDrawing(workbook: IWorkbookData) {
    return JSON.parse(workbook.resources?.[0]?.data ?? "{}")["sheet-1"].data;
}

/**
 * Builds a workbook holding the given drawing nodes inside a single cell's rich-text document
 * (`sheets["sheet-1"].cellData[2][1].p.drawings`), as Univer stores cell-embedded (in-cell) images.
 */
function cellDrawingWorkbook(drawings: Record<string, { imageSourceType: string; source: string }>) {
    return makeWorkbook({
        sheets: {
            "sheet-1": {
                cellData: {
                    2: { 1: { p: { drawings } } }
                }
            }
        } as unknown as IWorkbookData["sheets"]
    });
}

function readCellDrawings(workbook: IWorkbookData) {
    const sheet = workbook.sheets?.["sheet-1"] as { cellData?: Record<string, Record<string, { p?: { drawings?: Record<string, { imageSourceType: string; source: string }> } }>> } | undefined;
    return sheet?.cellData?.["2"]?.["1"]?.p?.drawings ?? {};
}

describe("slimWorkbookData", () => {
    it("drops the top-level workbook id and locale (both reassigned on load)", () => {
        const result = slimWorkbookData(makeWorkbook({ id: "abc123", locale: LocaleType.ZH_CN, name: "Sheet" }));

        expect(result.id).toBeUndefined();
        expect(result.locale).toBeUndefined();
        expect(result.name).toBe("Sheet");
    });

    it("removes resources whose data is empty (\"\" or \"{}\") and keeps the rest", () => {
        const result = slimWorkbookData(makeWorkbook({
            resources: [
                { name: "SHEET_RANGE_PROTECTION_PLUGIN", data: "" },
                { name: "SHEET_NOTE_PLUGIN", data: "{}" },
                { name: "SHEET_FILTER_PLUGIN", data: "{\"col\":1}" },
                // "[]" is not one of the stripped sentinels, so it is preserved.
                { name: "SHEET_DEFINED_NAME_PLUGIN", data: "[]" }
            ]
        }));

        expect(result.resources).toEqual([
            { name: "SHEET_FILTER_PLUGIN", data: "{\"col\":1}" },
            { name: "SHEET_DEFINED_NAME_PLUGIN", data: "[]" }
        ]);
    });

    it("keeps the drawing resource carrying an inline base64 image, but drops it when empty", () => {
        // Images are stored as base64 inside the SHEET_DRAWING_PLUGIN resource, so slimming must
        // preserve a populated drawing resource (otherwise inserted images would vanish on save)
        // while still discarding the empty "{}" the plugin emits for a sheet with no drawings.
        const drawingData = "{\"sheet1\":{\"data\":{\"img1\":{\"source\":\"data:image/png;base64,iVBORw0KGgo=\"}}}}";
        const result = slimWorkbookData(makeWorkbook({
            resources: [
                { name: "SHEET_DRAWING_PLUGIN", data: drawingData },
                { name: "SHEET_NOTE_PLUGIN", data: "{}" }
            ]
        }));

        expect(result.resources).toEqual([
            { name: "SHEET_DRAWING_PLUGIN", data: drawingData }
        ]);
    });

    it("leaves an all-empty resource list as an empty array and tolerates absent resources", () => {
        expect(slimWorkbookData(makeWorkbook({
            resources: [
                { name: "A", data: "" },
                { name: "B", data: "{}" }
            ]
        })).resources).toEqual([]);

        expect(slimWorkbookData(makeWorkbook({})).resources).toBeUndefined();
    });
});

describe("uploadNewDrawingImages", () => {
    const upload = (url: string) => async () => url;

    it("uploads a newly inserted base64 image and rewrites its source to the returned URL", async () => {
        const workbook = makeWorkbook({
            resources: [drawingResource({
                img1: { imageSourceType: "BASE64", source: "data:image/png;base64,AAAA" },
                // An already-URL image (e.g. saved on an earlier session) must be left alone.
                img2: { imageSourceType: "URL", source: "api/attachments/existing1/image/existing1.png" }
            })]
        });

        const uploaded: string[] = [];
        await uploadNewDrawingImages(workbook, new Set(), new Map(), async (source) => {
            uploaded.push(source);
            return "api/attachments/new1/image/image.png";
        });

        expect(uploaded).toEqual([ "data:image/png;base64,AAAA" ]);
        const drawing = readDrawing(workbook);
        expect(drawing.img1).toEqual({ imageSourceType: "URL", source: "api/attachments/new1/image/image.png" });
        expect(drawing.img2.source).toBe("api/attachments/existing1/image/existing1.png");
    });

    it("leaves images that were already present at load (preexisting) as base64, uploading nothing", async () => {
        const source = "data:image/png;base64,BBBB";
        const workbook = makeWorkbook({ resources: [drawingResource({ old: { imageSourceType: "BASE64", source } })] });

        await uploadNewDrawingImages(workbook, new Set([ source ]), new Map(), async () => {
            throw new Error("should not upload a preexisting image");
        });

        expect(readDrawing(workbook).old).toEqual({ imageSourceType: "BASE64", source });
    });

    it("uploads each distinct image once across repeated saves (caches the URL by source)", async () => {
        const source = "data:image/jpeg;base64,CCCC";
        const cache = new Map<string, string>();
        let count = 0;
        const countingUpload = async () => {
            count++;
            return "api/attachments/cached/image/image.jpeg";
        };

        // `workbook.save()` hands back a fresh snapshot each save, but the live base64 source is
        // unchanged, so the shared cache must map it to the same URL without re-uploading.
        await uploadNewDrawingImages(
            makeWorkbook({ resources: [drawingResource({ a: { imageSourceType: "BASE64", source } })] }), new Set(), cache, countingUpload);
        const second = makeWorkbook({ resources: [drawingResource({ a: { imageSourceType: "BASE64", source } })] });
        await uploadNewDrawingImages(second, new Set(), cache, countingUpload);

        expect(count).toBe(1);
        expect(readDrawing(second).a.source).toBe("api/attachments/cached/image/image.jpeg");
    });

    it("leaves an image as base64 when its upload fails (returns null)", async () => {
        const source = "data:image/png;base64,DDDD";
        const workbook = makeWorkbook({ resources: [drawingResource({ a: { imageSourceType: "BASE64", source } })] });

        await uploadNewDrawingImages(workbook, new Set(), new Map(), async () => null);

        expect(readDrawing(workbook).a).toEqual({ imageSourceType: "BASE64", source });
    });

    it("does nothing when there is no drawing resource", async () => {
        const workbook = makeWorkbook({});
        await uploadNewDrawingImages(workbook, new Set(), new Map(), upload("api/attachments/x/image/x.png"));
        expect(workbook.resources).toBeUndefined();
    });

    it("uploads a base64 image embedded in a cell and rewrites it in place", async () => {
        const workbook = cellDrawingWorkbook({
            d1: { imageSourceType: "BASE64", source: "data:image/png;base64,EEEE" },
            // An already-URL cell image must be left alone.
            d2: { imageSourceType: "URL", source: "api/attachments/existing/image/existing.png" }
        });

        const uploaded: string[] = [];
        await uploadNewDrawingImages(workbook, new Set(), new Map(), async (source) => {
            uploaded.push(source);
            return "api/attachments/cell1/image/image.png";
        });

        expect(uploaded).toEqual([ "data:image/png;base64,EEEE" ]);
        const drawings = readCellDrawings(workbook);
        expect(drawings.d1).toEqual({ imageSourceType: "URL", source: "api/attachments/cell1/image/image.png" });
        expect(drawings.d2.source).toBe("api/attachments/existing/image/existing.png");
    });

    it("uploads cell images even when there is no floating-image drawing resource", async () => {
        // Cell drawings live directly in the workbook (not in a SHEET_DRAWING_PLUGIN resource), so a
        // workbook with only cell images and no resource must still trigger uploads.
        const workbook = cellDrawingWorkbook({ d1: { imageSourceType: "BASE64", source: "data:image/png;base64,FFFF" } });

        await uploadNewDrawingImages(workbook, new Set(), new Map(), upload("api/attachments/cell2/image/image.png"));

        expect(readCellDrawings(workbook).d1).toEqual({ imageSourceType: "URL", source: "api/attachments/cell2/image/image.png" });
    });

    it("leaves a preexisting cell image as base64, uploading nothing", async () => {
        const source = "data:image/png;base64,GGGG";
        const workbook = cellDrawingWorkbook({ d1: { imageSourceType: "BASE64", source } });

        await uploadNewDrawingImages(workbook, new Set([ source ]), new Map(), async () => {
            throw new Error("should not upload a preexisting image");
        });

        expect(readCellDrawings(workbook).d1).toEqual({ imageSourceType: "BASE64", source });
    });
});

describe("collectBase64DrawingSources", () => {
    it("returns base64 sources, ignoring URL sources and absent drawing resources", () => {
        const workbook = makeWorkbook({
            resources: [drawingResource({
                x: { imageSourceType: "BASE64", source: "data:image/png;base64,DDDD" },
                y: { imageSourceType: "URL", source: "api/attachments/z/image/z.png" }
            })]
        });

        expect(collectBase64DrawingSources(workbook)).toEqual(new Set([ "data:image/png;base64,DDDD" ]));
        expect(collectBase64DrawingSources(makeWorkbook({}))).toEqual(new Set());
    });

    it("includes base64 sources from cell-embedded drawings", () => {
        const workbook = cellDrawingWorkbook({
            x: { imageSourceType: "BASE64", source: "data:image/png;base64,HHHH" },
            y: { imageSourceType: "URL", source: "api/attachments/z/image/z.png" }
        });

        expect(collectBase64DrawingSources(workbook)).toEqual(new Set([ "data:image/png;base64,HHHH" ]));
    });
});
