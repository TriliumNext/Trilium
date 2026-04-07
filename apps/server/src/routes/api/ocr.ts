import type { OCRProcessResponse, TextRepresentationResponse } from "@triliumnext/commons";
import type { Request } from "express";

import becca from "../../becca/becca.js";
import ocrService from "../../services/ocr/ocr_service.js";
import options from "../../services/options.js";
import sql from "../../services/sql.js";

function getMinConfidenceThreshold(): number {
    const minConfidence = options.getOption('ocrMinConfidence') ?? 0;
    return parseFloat(minConfidence);
}

/**
 * @swagger
 * /api/ocr/process-note/{noteId}:
 *   post:
 *     summary: Process OCR for a specific note
 *     operationId: ocr-process-note
 *     parameters:
 *       - name: noteId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the note to process
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               language:
 *                 type: string
 *                 description: >
 *                   Tesseract language code to use (e.g. 'eng', 'fra', 'deu', 'eng+fra').
 *                   If omitted, the language is resolved automatically from the note's language label,
 *                   the enabled content languages, or the UI locale.
 *               forceReprocess:
 *                 type: boolean
 *                 description: Force reprocessing even if OCR already exists
 *                 default: false
 *     responses:
 *       '200':
 *         description: OCR processing completed successfully
 *       '400':
 *         description: Bad request - unsupported file type
 *       '404':
 *         description: Note not found
 *       '500':
 *         description: Internal server error
 *     security:
 *       - session: []
 *     tags: ["ocr"]
 */
async function processNoteOCR(req: Request<{ noteId: string }>): Promise<OCRProcessResponse | [number, OCRProcessResponse]> {
    const { noteId } = req.params;
    const { language, forceReprocess = false } = req.body || {};

    const note = becca.getNote(noteId);
    if (!note) {
        return [404, { success: false, message: 'Note not found' }];
    }

    const result = await ocrService.processNoteOCR(noteId, { language, forceReprocess });
    if (!result) {
        return [400, { success: false, message: 'Note is not an image or has unsupported format' }];
    }

    return {
        success: true,
        result,
        minConfidence: getMinConfidenceThreshold()
    };
}

/**
 * @swagger
 * /api/ocr/process-attachment/{attachmentId}:
 *   post:
 *     summary: Process OCR for a specific attachment
 *     operationId: ocr-process-attachment
 *     parameters:
 *       - name: attachmentId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the attachment to process
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               language:
 *                 type: string
 *                 description: >
 *                   Tesseract language code to use (e.g. 'eng', 'fra', 'deu', 'eng+fra').
 *                   If omitted, the language is resolved automatically from the owner note's language label,
 *                   the enabled content languages, or the UI locale.
 *               forceReprocess:
 *                 type: boolean
 *                 description: Force reprocessing even if OCR already exists
 *                 default: false
 *     responses:
 *       '200':
 *         description: OCR processing completed successfully
 *       '400':
 *         description: Bad request - unsupported file type
 *       '404':
 *         description: Attachment not found
 *       '500':
 *         description: Internal server error
 *     security:
 *       - session: []
 *     tags: ["ocr"]
 */
async function processAttachmentOCR(req: Request<{ attachmentId: string }>): Promise<OCRProcessResponse | [number, OCRProcessResponse]> {
    const { attachmentId } = req.params;
    const { language, forceReprocess = false } = req.body || {};

    const attachment = becca.getAttachment(attachmentId);
    if (!attachment) {
        return [404, { success: false, message: 'Attachment not found' }];
    }

    const result = await ocrService.processAttachmentOCR(attachmentId, { language, forceReprocess });
    if (!result) {
        return [400, { success: false, message: 'Attachment is not an image or has unsupported format' }];
    }

    return {
        success: true,
        result,
        minConfidence: getMinConfidenceThreshold()
    };
}

/**
 * @swagger
 * /api/ocr/batch-process:
 *   post:
 *     summary: Process OCR for all images without existing OCR results
 *     operationId: ocr-batch-process
 *     responses:
 *       '200':
 *         description: Batch processing initiated successfully
 *       '400':
 *         description: Bad request - OCR disabled or already processing
 *       '500':
 *         description: Internal server error
 *     security:
 *       - session: []
 *     tags: ["ocr"]
 */
async function batchProcessOCR() {
    const result = await ocrService.startBatchProcessing();
    if (!result.success) {
        return [400, result];
    }
    return result;
}

/**
 * @swagger
 * /api/ocr/batch-progress:
 *   get:
 *     summary: Get batch OCR processing progress
 *     operationId: ocr-batch-progress
 *     responses:
 *       '200':
 *         description: Batch processing progress information
 *       '500':
 *         description: Internal server error
 *     security:
 *       - session: []
 *     tags: ["ocr"]
 */
async function getBatchProgress() {
    return ocrService.getBatchProgress();
}

/**
 * @swagger
 * /api/ocr/notes/{noteId}/text:
 *   get:
 *     summary: Get OCR text for a specific note
 *     operationId: ocr-get-note-text
 *     parameters:
 *       - name: noteId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Note ID to get OCR text for
 *     responses:
 *       200:
 *         description: OCR text retrieved successfully
 *       404:
 *         description: Note not found
 *     tags: ["ocr"]
 */
function getTextRepresentation(blobId: string | undefined): TextRepresentationResponse {
    let ocrText: string | null = null;

    if (blobId) {
        const result = sql.getRow<{
            textRepresentation: string | null;
        }>(`
            SELECT textRepresentation
            FROM blobs
            WHERE blobId = ?
        `, [blobId]);

        if (result) {
            ocrText = result.textRepresentation;
        }
    }

    return {
        success: true,
        text: ocrText || '',
        hasOcr: !!ocrText
    };
}

async function getNoteOCRText(req: Request<{ noteId: string }>) {
    const note = becca.getNote(req.params.noteId);
    if (!note) {
        return [404, { success: false, message: 'Note not found' }];
    }

    return getTextRepresentation(note.blobId);
}

async function getAttachmentOCRText(req: Request<{ attachmentId: string }>) {
    const attachment = becca.getAttachment(req.params.attachmentId);
    if (!attachment) {
        return [404, { success: false, message: 'Attachment not found' }];
    }

    return getTextRepresentation(attachment.blobId);
}

export default {
    processNoteOCR,
    processAttachmentOCR,
    batchProcessOCR,
    getBatchProgress,
    getNoteOCRText,
    getAttachmentOCRText
};
