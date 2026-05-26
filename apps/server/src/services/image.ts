/**
 * Server-side image service.
 * Re-exports core image service and adds OCR scheduling.
 */

import { imageService } from "@triliumnext/core";
import log from "./log.js";
import ocrService from "./ocr/ocr_service.js";
import optionService from "./options.js";

function scheduleOcrForNote(noteId: string) {
    if (optionService.getOptionBool("ocrAutoProcessImages")) {
        setImmediate(async () => {
            try {
                await ocrService.processNoteOCR(noteId);
            } catch (error) {
                log.error(`Failed to process OCR for note ${noteId}: ${error}`);
            }
        });
    }
}

function scheduleOcrForAttachment(attachmentId: string | undefined) {
    if (attachmentId && optionService.getOptionBool("ocrAutoProcessImages")) {
        setImmediate(async () => {
            try {
                await ocrService.processAttachmentOCR(attachmentId);
            } catch (error) {
                log.error(`Failed to process OCR for attachment ${attachmentId}: ${error}`);
            }
        });
    }
}

// Re-export core functions with OCR scheduling wrappers
function saveImage(
    parentNoteId: string,
    uploadBuffer: Uint8Array,
    originalName: string,
    shrinkImageSwitch: boolean,
    trimFilename = false
) {
    const result = imageService.saveImage(parentNoteId, uploadBuffer, originalName, shrinkImageSwitch, trimFilename);
    scheduleOcrForNote(result.noteId);
    return result;
}

function saveImageToAttachment(
    noteId: string,
    uploadBuffer: Uint8Array,
    originalName: string,
    shrinkImageSwitch?: boolean,
    trimFilename = false
) {
    const result = imageService.saveImageToAttachment(noteId, uploadBuffer, originalName, shrinkImageSwitch, trimFilename);
    scheduleOcrForAttachment(result.attachmentId);
    return result;
}

function updateImage(noteId: string, uploadBuffer: Uint8Array, originalName: string) {
    imageService.updateImage(noteId, uploadBuffer, originalName);
    scheduleOcrForNote(noteId);
}

export default {
    saveImage,
    saveImageToAttachment,
    updateImage
};
