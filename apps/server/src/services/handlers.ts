import { events, getLog, handlers, options as optionService } from "@triliumnext/core";

import ocrService from "./ocr/ocr_service";
export default handlers;

export function registerOcrHandlers() {
    events.subscribe(events.ENTITY_CREATED, ({ entityName, entity }) => {
        switch (entityName) {
            case "notes": {
                // Note: OCR processing for images is now handled in image.ts during image processing
                // OCR processing for files remains here since they don't go through image processing
                if (entity.type === 'file' && optionService.getOptionBool("ocrAutoProcessImages")) {
                    autoProcessOCR(entity.mime, () => ocrService.processNoteOCR(entity.noteId), `file note ${entity.noteId}`);
                }
                break;
            }
            case "attachments": {
                // Image attachments are handled in image.ts after async image processing sets the real MIME type.
                // Only handle non-image (file) attachments here.
                if (entity.role === "file" && optionService.getOptionBool("ocrAutoProcessImages")) {
                    autoProcessOCR(entity.mime, () => ocrService.processAttachmentOCR(entity.attachmentId), `attachment ${entity.attachmentId}`);
                }
                break;
            }
        }
    });
}

function autoProcessOCR(mime: string, process: () => Promise<unknown>, entityDescription: string) {
    const supportedMimeTypes = ocrService.getAllSupportedMimeTypes();

    const log = getLog();
    if (mime && supportedMimeTypes.includes(mime)) {
        process().then(result => {
            if (result) {
                log.info(`Automatically processed OCR for ${entityDescription} with MIME type ${mime}`);
            }
        }).catch(error => {
            log.error(`Failed to automatically process OCR for ${entityDescription}: ${error}`);
        });
    }
}
