import { parseExcel } from 'officeparser/dist/parsers/ExcelParser.js';
import { parseOpenOffice } from 'officeparser/dist/parsers/OpenOfficeParser.js';
import { parsePowerPoint } from 'officeparser/dist/parsers/PowerPointParser.js';
import { parseWord } from 'officeparser/dist/parsers/WordParser.js';
import type { OfficeParserConfig } from 'officeparser/dist/types.js';

import log from '../../log.js';
import { OCRProcessingOptions, OCRResult } from '../ocr_service.js';
import { FileProcessor } from './file_processor.js';

type Parser = (buffer: Buffer, config: OfficeParserConfig) => Promise<{ toText(): string }>;

const PARSER_BY_MIME: Record<string, Parser> = {
    // Office Open XML
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': parseWord,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': parseExcel,
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': parsePowerPoint,
    // OpenDocument
    'application/vnd.oasis.opendocument.text': parseOpenOffice,
    'application/vnd.oasis.opendocument.spreadsheet': parseOpenOffice,
    'application/vnd.oasis.opendocument.presentation': parseOpenOffice
};

const PARSER_CONFIG: OfficeParserConfig = {
    outputErrorToConsole: false,
    newlineDelimiter: '\n',
    ignoreNotes: false,
    putNotesAtLast: false
};

/**
 * Office document processor for extracting text from DOCX/XLSX/PPTX and ODT/ODS/ODP files.
 * Uses individual parsers from officeparser v6 to avoid pulling in pdfjs-dist.
 */
export class OfficeProcessor extends FileProcessor {

    canProcess(mimeType: string): boolean {
        return mimeType in PARSER_BY_MIME;
    }

    getSupportedMimeTypes(): string[] {
        return Object.keys(PARSER_BY_MIME);
    }

    async extractText(buffer: Buffer, options: OCRProcessingOptions = {}): Promise<OCRResult> {
        const mimeType = options.mimeType;
        if (!mimeType || !(mimeType in PARSER_BY_MIME)) {
            throw new Error(`Unsupported MIME type for Office processor: ${mimeType}`);
        }

        log.info(`Starting Office document text extraction for ${mimeType}...`);

        const parse = PARSER_BY_MIME[mimeType];
        const ast = await parse(buffer, PARSER_CONFIG);
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
