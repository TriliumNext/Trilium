import { OFFICE_FILE_TYPE_HINTS, OFFICE_MIME_TYPES } from "@triliumnext/commons";
import { getLog } from "@triliumnext/core";
import { type OfficeParserConfig } from 'officeparser';

import { OCRProcessingOptions, OCRResult } from '../ocr_service.js';
import { FileProcessor } from './file_processor.js';

const PARSER_CONFIG: OfficeParserConfig = {
    outputErrorToConsole: false,
    newlineDelimiter: '\n',
    ignoreNotes: false
};

/**
 * Office document processor for extracting text from DOCX/XLSX/PPTX, ODT/ODS/ODP,
 * RTF and EPUB files. Uses officeparser's main API, which auto-detects the format
 * from the buffer's magic bytes (with an explicit fileType hint for RTF and EPUB).
 */
export class OfficeProcessor extends FileProcessor {

    canProcess(mimeType: string): boolean {
        return OFFICE_MIME_TYPES.has(mimeType);
    }

    getSupportedMimeTypes(): string[] {
        return [...OFFICE_MIME_TYPES];
    }

    async extractText(buffer: Buffer, options: OCRProcessingOptions = {}): Promise<OCRResult> {
        const mimeType = options.mimeType;
        if (!mimeType || !OFFICE_MIME_TYPES.has(mimeType)) {
            throw new Error(`Unsupported MIME type for Office processor: ${mimeType}`);
        }

        getLog().info(`Starting Office document text extraction for ${mimeType}...`);

        const fileType = OFFICE_FILE_TYPE_HINTS[mimeType];
        const config = fileType ? { ...PARSER_CONFIG, fileType } : PARSER_CONFIG;
        // Dynamically imported so officeparser only loads when an Office file is actually processed.
        const { OfficeParser } = await import('officeparser');
        const ast = await OfficeParser.parseOffice(buffer, config);
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
