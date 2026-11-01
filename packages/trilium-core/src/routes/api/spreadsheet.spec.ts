import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";

import { decodeBase64 } from "../../services/utils/binary";
import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared spreadsheet export route through {@link CoreApiTester} (no Express), so this
 * spec runs under both the node and standalone (WASM) suites.
 */
let api: CoreApiTester;

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** A 1x1 transparent PNG, small enough to be written out in full. */
const PIXEL_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAA"
    + "C0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("Spreadsheet API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    it("renders the note's stored workbook to a readable xlsx", async () => {
        const cellData = { "0": { "0": { v: "Hello", t: 1 }, "1": { v: 42, t: 2 } } };
        const ws = (await renderWorkbook(workbookJson(cellData))).getWorksheet("Ledger");

        expect(ws?.getCell("A1").value).toBe("Hello");
        expect(ws?.getCell("B1").value).toBe(42);
    });

    it("names the download after the note and refuses a note that is not a spreadsheet", async () => {
        const noteId = await createSpreadsheetNote("Quarterly Ledger", workbookJson({}));
        const res = await api.get(`/api/spreadsheet/${noteId}/xlsx`);

        expect(res.status).toBe(200);
        expect(res.headers["Content-Disposition"]).toContain("Quarterly%20Ledger.xlsx");
        expect(res.headers["Content-Type"]).toBe(XLSX_MIME);

        const { noteId: textNoteId } = await createTextNote(api, { title: "Not a spreadsheet" });
        expect((await api.get(`/api/spreadsheet/${textNoteId}/xlsx`)).status).toBe(404);
        expect((await api.get("/api/spreadsheet/nosuchnote/xlsx")).status).toBe(404);
    });

    it("embeds an image stored as an attachment", async () => {
        const source = await uploadPixelPng("Attachment image export");
        const wb = await renderWorkbook(workbookJson(cellWithDrawing(source)));

        expect(wb.worksheets[0].getImages().length).toBe(1);
        expect(wb.model.media[0]?.extension).toBe("png");
    });

    it("embeds an inline data URL", async () => {
        const source = `data:image/png;base64,${PIXEL_PNG_BASE64}`;
        const wb = await renderWorkbook(workbookJson(cellWithDrawing(source)));

        expect(wb.worksheets[0].getImages().length).toBe(1);
        expect(wb.model.media[0]?.extension).toBe("png");
    });

    it("skips a drawing it can't turn into embeddable bytes", async () => {
        // A vanished attachment, a format exceljs can't embed, and a source that is neither an
        // attachment URL nor a data URL.
        const sources = [
            "api/attachments/nosuchattachment/image/x.png",
            "data:image/svg+xml;base64,PHN2Zy8+",
            "https://example.com/photo.png"
        ];

        for (const source of sources) {
            const wb = await renderWorkbook(workbookJson(cellWithDrawing(source)));
            expect(wb.worksheets[0].getImages().length).toBe(0);
        }
    });
});

/** Stores the workbook JSON on a spreadsheet note, downloads it, and reads it back as a workbook. */
async function renderWorkbook(json: string): Promise<ExcelJS.Workbook> {
    const noteId = await createSpreadsheetNote("Ledger note", json);
    const res = await api.get<Uint8Array>(`/api/spreadsheet/${noteId}/xlsx`);
    expect(res.status).toBe(200);

    // The response body can be a view into a larger pooled buffer, so copy the bytes into an
    // ArrayBuffer of their own before exceljs unzips it.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(new Uint8Array(res.body).buffer);
    return wb;
}

/** Creates a spreadsheet note holding `content`, returning its id. */
async function createSpreadsheetNote(title: string, content: string): Promise<string> {
    const res = await api.post<{ note: { noteId: string } }>("/api/notes/root/children?target=into", {
        body: { title, type: "spreadsheet", mime: "application/json", content }
    });
    expect(res.status).toBe(200);
    return res.body.note.noteId;
}

/** Wraps cell data into a complete single-sheet workbook payload. */
function workbookJson(cellData: Record<string, Record<string, unknown>>): string {
    return JSON.stringify({
        version: 1,
        workbook: {
            sheetOrder: ["s1"],
            styles: {},
            sheets: {
                s1: {
                    id: "s1",
                    name: "Ledger",
                    hidden: 0,
                    mergeData: [],
                    cellData,
                    rowData: {},
                    columnData: {}
                }
            }
        }
    });
}

/** Cell data holding one cell image pointing at `source`. */
function cellWithDrawing(source: string) {
    const drawing = { drawingId: "d1", source, transform: { width: 10, height: 10 } };

    return {
        "0": {
            "0": {
                p: { drawings: { d1: drawing }, drawingsOrder: ["d1"] }
            }
        }
    };
}

/** Uploads the pixel PNG and returns the `api/attachments/...` URL it is served from. */
async function uploadPixelPng(title: string): Promise<string> {
    const { noteId } = await createTextNote(api, { title });

    const res = await api.post<{ uploaded: boolean; url: string }>(
        `/api/notes/${noteId}/attachments/upload`,
        {
            file: {
                originalname: "pixel.png",
                mimetype: "image/png",
                buffer: decodeBase64(PIXEL_PNG_BASE64)
            }
        }
    );
    expect(res.body.uploaded).toBe(true);

    return res.body.url;
}
