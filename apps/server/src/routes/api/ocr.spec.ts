import { becca, cls, getSql, note_service as noteService } from "@triliumnext/core";
import type { Request } from "express";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Only the OCR engine is mocked — becca/sql run against the real in-memory DB.
const ocrState = vi.hoisted(() => ({
    noteResult: null as unknown,
    attachmentResult: null as unknown,
    batchResult: { success: true } as { success: boolean; message?: string }
}));

vi.mock("../../services/ocr/ocr_service.js", () => ({
    default: {
        processNoteOCR: vi.fn(async () => ocrState.noteResult),
        processAttachmentOCR: vi.fn(async () => ocrState.attachmentResult),
        startBatchProcessing: vi.fn(async () => ocrState.batchResult),
        getBatchProgress: vi.fn(() => ({ inProgress: false, total: 0, processed: 0 }))
    }
}));

import ocrRoutes from "./ocr.js";

let noteId: string;
let attachmentId: string;

describe("OCR API", () => {
    beforeAll(() => {
        cls.init(() => {
            const { note } = noteService.createNewNote({ parentNoteId: "root", title: "OCR note", type: "text", content: "hi" });
            noteId = note.noteId;
            attachmentId = note.saveAttachment({ role: "image", mime: "image/png", title: "img", content: "x" }).attachmentId;
        });
    });

    describe("processNoteOCR", () => {
        it("returns 404 for a missing note", async () => {
            const result = await ocrRoutes.processNoteOCR({ params: { noteId: "missing" }, body: {} } as unknown as Request<{ noteId: string }>);
            expect(result).toEqual([404, { success: false, message: "Note not found" }]);
        });

        it("returns 400 when the note is not a supported image", async () => {
            ocrState.noteResult = null;
            const result = await ocrRoutes.processNoteOCR({ params: { noteId }, body: {} } as unknown as Request<{ noteId: string }>);
            expect(result).toEqual([400, { success: false, message: "Note is not an image or has unsupported format" }]);
        });

        it("returns the OCR result on success", async () => {
            ocrState.noteResult = { text: "hello" };
            const result = await ocrRoutes.processNoteOCR({ params: { noteId }, body: { language: "eng" } } as unknown as Request<{ noteId: string }>);
            expect(result).toMatchObject({ success: true, result: { text: "hello" } });
        });
    });

    describe("processAttachmentOCR", () => {
        it("returns 404 for a missing attachment", async () => {
            const result = await ocrRoutes.processAttachmentOCR({ params: { attachmentId: "missing" }, body: {} } as unknown as Request<{ attachmentId: string }>);
            expect(result).toEqual([404, { success: false, message: "Attachment not found" }]);
        });

        it("returns 400 then success depending on the engine result", async () => {
            ocrState.attachmentResult = null;
            expect(await ocrRoutes.processAttachmentOCR({ params: { attachmentId }, body: {} } as unknown as Request<{ attachmentId: string }>))
                .toEqual([400, { success: false, message: "Attachment is not an image or has unsupported format" }]);

            ocrState.attachmentResult = { text: "ocr" };
            expect(await ocrRoutes.processAttachmentOCR({ params: { attachmentId }, body: {} } as unknown as Request<{ attachmentId: string }>))
                .toMatchObject({ success: true });
        });
    });

    describe("batch processing", () => {
        it("returns the result on success", async () => {
            ocrState.batchResult = { success: true };
            expect(await ocrRoutes.batchProcessOCR()).toEqual({ success: true });
        });

        it("returns 400 when batch processing fails", async () => {
            ocrState.batchResult = { success: false, message: "No images found that need OCR processing" };
            expect(await ocrRoutes.batchProcessOCR()).toEqual([400, { success: false, message: "No images found that need OCR processing" }]);
        });

        it("returns batch progress", async () => {
            expect(await ocrRoutes.getBatchProgress()).toEqual({ inProgress: false, total: 0, processed: 0 });
        });
    });

    describe("OCR text retrieval", () => {
        it("returns 404 for a missing note / attachment", async () => {
            expect(await ocrRoutes.getNoteOCRText({ params: { noteId: "missing" } } as unknown as Request<{ noteId: string }>))
                .toEqual([404, { success: false, message: "Note not found" }]);
            expect(await ocrRoutes.getAttachmentOCRText({ params: { attachmentId: "missing" } } as unknown as Request<{ attachmentId: string }>))
                .toEqual([404, { success: false, message: "Attachment not found" }]);
        });

        it("reports no OCR text when none is stored", async () => {
            const result = await ocrRoutes.getNoteOCRText({ params: { noteId } } as unknown as Request<{ noteId: string }>);
            expect(result).toEqual({ success: true, text: "", hasOcr: false });
        });

        it("returns stored OCR text from the blob", async () => {
            const blobId = becca.getNoteOrThrow(noteId).blobId;
            cls.init(() => getSql().execute("UPDATE blobs SET textRepresentation = ? WHERE blobId = ?", ["scanned text", blobId]));
            const result = await ocrRoutes.getNoteOCRText({ params: { noteId } } as unknown as Request<{ noteId: string }>);
            expect(result).toEqual({ success: true, text: "scanned text", hasOcr: true });
        });
    });
});
