import { OfficeParser, type OfficeParserConfig } from 'officeparser';

import log from '../../log.js';
import { OCRProcessingOptions, OCRResult } from '../ocr_service.js';
import { FileProcessor } from './file_processor.js';

const SUPPORTED_MIME_TYPES = new Set([
    // Office Open XML
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // OpenDocument
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation'
]);

const PARSER_CONFIG: OfficeParserConfig = {
    outputErrorToConsole: false,
    newlineDelimiter: '\n',
    ignoreNotes: false,
    putNotesAtLast: false
};

/**
 * Office document processor for extracting text from DOCX/XLSX/PPTX and ODT/ODS/ODP files.
 * Uses officeparser's main API, which auto-detects the format from the buffer's magic bytes.
 */
export class OfficeProcessor extends FileProcessor {

    canProcess(mimeType: string): boolean {
        return SUPPORTED_MIME_TYPES.has(mimeType);
    }

    getSupportedMimeTypes(): string[] {
        return [...SUPPORTED_MIME_TYPES];
    }

    async extractText(buffer: Buffer, options: OCRProcessingOptions = {}): Promise<OCRResult> {
        const mimeType = options.mimeType;
        if (!mimeType || !SUPPORTED_MIME_TYPES.has(mimeType)) {
            throw new Error(`Unsupported MIME type for Office processor: ${mimeType}`);
        }

        log.info(`Starting Office document text extraction for ${mimeType}...`);

        const ast = await OfficeParser.parseOffice(buffer, PARSER_CONFIG);
        const trimmed = ast.toText().trim();

        return {
            text: trimmed,
            confidence: trimmed.length > 0 ? 0.99 : 0,
            extractedAt: new Date().toISOString(),
            language: options.language || "eng",
            pageCount: 1
        };
    }

    getProcessingType(): string {
        return 'office';
    }

}
