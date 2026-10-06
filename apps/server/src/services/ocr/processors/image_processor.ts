import { getLog } from "@triliumnext/core";

import { OCRProcessingOptions, OCRResult } from '../ocr_service.js';
import recognizer from '../tesseract_recognizer.js';
import { FileProcessor } from './file_processor.js';

/**
 * Image processor for extracting text from image files using Tesseract
 */
export class ImageProcessor extends FileProcessor {
    // Formats that tesseract.js can actually decode (see its docs/image-format.md);
    // TIFF is deliberately absent — Leptonica in tesseract.js-core is built without libtiff,
    // so TIFF buffers always fail with "Error attempting to read image".
    private readonly supportedTypes = [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'image/bmp',
        'image/webp'
    ];

    canProcess(mimeType: string): boolean {
        return this.supportedTypes.includes(mimeType.toLowerCase());
    }

    getSupportedMimeTypes(): string[] {
        return [...this.supportedTypes];
    }

    async extractText(buffer: Buffer, options: OCRProcessingOptions = {}): Promise<OCRResult> {
        const language = options.language || "eng";

        try {
            getLog().info(`Starting image OCR text extraction (language: ${language})...`);

            const { text, confidence } = await recognizer.recognize(buffer, language);

            return {
                text,
                confidence,
                extractedAt: new Date().toISOString(),
                language,
                pageCount: 1
            };
        } catch (error) {
            getLog().error(`Image OCR text extraction failed: ${error}`);
            throw error;
        }
    }

    getProcessingType(): string {
        return 'image';
    }
}
