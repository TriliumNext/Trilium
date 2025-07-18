import * as officeParser from 'officeparser';
import { FileProcessor } from './file_processor.js';
import { OCRResult, OCRProcessingOptions } from '../ocr_service.js';
import { ImageProcessor } from './image_processor.js';
import log from '../../log.js';

/**
 * Office document processor for extracting text and images from DOCX/XLSX/PPTX files
 */
export class OfficeProcessor extends FileProcessor {
    private imageProcessor: ImageProcessor;

    constructor() {
        super();
        this.imageProcessor = new ImageProcessor();
    }

    canProcess(mimeType: string): boolean {
        const supportedTypes = [
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // DOCX
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // XLSX
            'application/vnd.openxmlformats-officedocument.presentationml.presentation', // PPTX
            'application/msword', // DOC
            'application/vnd.ms-excel', // XLS
            'application/vnd.ms-powerpoint', // PPT
            'application/rtf' // RTF
        ];
        return supportedTypes.includes(mimeType.toLowerCase());
    }

    async extractText(buffer: Buffer, options: OCRProcessingOptions = {}): Promise<OCRResult> {
        try {
            log.info('Starting Office document text extraction...');

            // Validate language format
            const language = options.language || this.getDefaultOCRLanguage();
            if (!this.isValidLanguageFormat(language)) {
                throw new Error(`Invalid OCR language format: ${language}. Use format like 'eng' or 'ron+eng'`);
            }

            // Extract text from Office document
            const data = await this.parseOfficeDocument(buffer);
            
            // Extract text from Office document
            const combinedText = data.data && data.data.trim().length > 0 ? data.data.trim() : '';
            const confidence = combinedText.length > 0 ? 0.99 : 0; // High confidence for direct text extraction

            const result: OCRResult = {
                text: combinedText,
                confidence: confidence,
                extractedAt: new Date().toISOString(),
                language: language,
                pageCount: 1 // Office documents are treated as single logical document
            };

            log.info(`Office document text extraction completed. Confidence: ${confidence}%, Text length: ${result.text.length}`);
            return result;

        } catch (error) {
            log.error(`Office document text extraction failed: ${error}`);
            throw error;
        }
    }

    private async parseOfficeDocument(buffer: Buffer): Promise<{ data: string }> {
        try {
            // Use promise-based API directly
            const data = await officeParser.parseOfficeAsync(buffer, {
                outputErrorToConsole: false,
                newlineDelimiter: '\n',
                ignoreNotes: false,
                putNotesAtLast: false
            });
            
            return {
                data: data || ''
            };
        } catch (error) {
            throw new Error(`Office document parsing failed: ${error}`);
        }
    }

    getProcessingType(): string {
        return 'office';
    }

    async cleanup(): Promise<void> {
        await this.imageProcessor.cleanup();
    }

    /**
     * Get default OCR language from options
     */
    private getDefaultOCRLanguage(): string {
        try {
            const options = require('../../options.js').default;
            const ocrLanguage = options.getOption('ocrLanguage');
            if (!ocrLanguage) {
                throw new Error('OCR language not configured in user settings');
            }
            return ocrLanguage;
        } catch (error) {
            log.error(`Failed to get default OCR language: ${error}`);
            throw new Error('OCR language must be configured in settings before processing');
        }
    }

    /**
     * Validate OCR language format
     * Supports single language (eng) or multi-language (ron+eng)
     */
    private isValidLanguageFormat(language: string): boolean {
        if (!language || typeof language !== 'string') {
            return false;
        }
        
        // Split by '+' for multi-language format
        const languages = language.split('+');
        
        // Check each language code (should be 2-7 characters, alphanumeric with underscores)
        const validLanguagePattern = /^[a-zA-Z]{2,3}(_[a-zA-Z]{2,3})?$/;
        
        return languages.every(lang => {
            const trimmed = lang.trim();
            return trimmed.length > 0 && validLanguagePattern.test(trimmed);
        });
    }
}