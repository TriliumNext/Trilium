import { extractText, getDocumentProxy } from 'unpdf';

import log from '../../log.js';
import { OCRProcessingOptions, OCRResult } from '../ocr_service.js';
import { FileProcessor } from './file_processor.js';

/**
 * PDF processor for extracting embedded text from PDF files using unpdf.
 */
export class PDFProcessor extends FileProcessor {

    canProcess(mimeType: string): boolean {
        return mimeType.toLowerCase() === 'application/pdf';
    }

    getSupportedMimeTypes(): string[] {
        return ['application/pdf'];
    }

    async extractText(buffer: Buffer, options: OCRProcessingOptions = {}): Promise<OCRResult> {
        log.info('Starting PDF text extraction...');

        const pdf = await getDocumentProxy(new Uint8Array(buffer));
        const { totalPages, text } = await extractText(pdf, { mergePages: true });
        const trimmed = text.trim();

        return {
            text: trimmed,
            confidence: trimmed.length > 0 ? 0.99 : 0,
            extractedAt: new Date().toISOString(),
            language: options.language || "eng",
            pageCount: totalPages
        };
    }

    getProcessingType(): string {
        return 'pdf';
    }

}
