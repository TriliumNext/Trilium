import type { OCRProcessResponse } from "@triliumnext/commons";
import { options } from "@triliumnext/core";
import type { Request } from "express";

import { becca } from "@triliumnext/core";
import ocrService from "../../services/ocr/ocr_service.js";

function getMinConfidenceThreshold(): number {
    return parseFloat(options.getOption('ocrMinConfidence'));
}

async function processNoteOCR(req: Request<{ noteId: string }>): Promise<OCRProcessResponse | [number, OCRProcessResponse]> {
    const { noteId } = req.params;
    const { language, forceReprocess = false } = req.body || {};

    const note = becca.getNote(noteId);
    if (!note) {
        return [404, { success: false, message: 'Note not found' }];
    }

    if (!note.isContentAvailable()) {
        return [400, { success: false, message: 'Note is protected and the protected session is not available' }];
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

async function processAttachmentOCR(req: Request<{ attachmentId: string }>): Promise<OCRProcessResponse | [number, OCRProcessResponse]> {
    const { attachmentId } = req.params;
    const { language, forceReprocess = false } = req.body || {};

    const attachment = becca.getAttachment(attachmentId);
    if (!attachment) {
        return [404, { success: false, message: 'Attachment not found' }];
    }

    if (!attachment.isContentAvailable()) {
        return [400, { success: false, message: 'Attachment is protected and the protected session is not available' }];
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

async function batchProcessOCR() {
    const result = await ocrService.startBatchProcessing();
    if (!result.success) {
        return [400, result];
    }
    return result;
}

async function getBatchProgress() {
    return ocrService.getBatchProgress();
}

export default {
    processNoteOCR,
    processAttachmentOCR,
    batchProcessOCR,
    getBatchProgress,
};
