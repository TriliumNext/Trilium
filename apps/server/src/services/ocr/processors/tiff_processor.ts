import sharp from 'sharp';
import { FileProcessor } from './file_processor.js';
import { OCRResult, OCRProcessingOptions } from '../ocr_service.js';
import { ImageProcessor } from './image_processor.js';
import log from '../../log.js';

/**
 * TIFF processor for extracting text from multi-page TIFF files
 */
export class TIFFProcessor extends FileProcessor {
    private imageProcessor: ImageProcessor;
    private readonly supportedTypes = ['image/tiff', 'image/tif'];

    constructor() {
        super();
        this.imageProcessor = new ImageProcessor();
    }

    canProcess(mimeType: string): boolean {
        return mimeType.toLowerCase() === 'image/tiff' || mimeType.toLowerCase() === 'image/tif';
    }

    getSupportedMimeTypes(): string[] {
        return [...this.supportedTypes];
    }

    async extractText(buffer: Buffer, options: OCRProcessingOptions = {}): Promise<OCRResult> {
        try {
            log.info('Starting TIFF text extraction...');

            // Validate language format
            const language = options.language || this.getDefaultOCRLanguage();
            if (!this.isValidLanguageFormat(language)) {
                throw new Error(`Invalid OCR language format: ${language}. Use format like 'eng' or 'ron+eng'`);
            }

            // Check if this is a multi-page TIFF
            const metadata = await sharp(buffer).metadata();
            const pageCount = metadata.pages || 1;

            let combinedText = '';
            let totalConfidence = 0;

            // Process each page
            for (let page = 0; page < pageCount; page++) {
                try {
                    log.info(`Processing TIFF page ${page + 1}/${pageCount}...`);
                    
                    // Extract page as PNG buffer
                    const pageBuffer = await sharp(buffer, { page })
                        .png()
                        .toBuffer();

                    // OCR the page
                    const pageResult = await this.imageProcessor.extractText(pageBuffer, options);
                    
                    if (pageResult.text.trim().length > 0) {
                        if (combinedText.length > 0) {
                            combinedText += '\n\n--- Page ' + (page + 1) + ' ---\n';
                        }
                        combinedText += pageResult.text;
                        totalConfidence += pageResult.confidence;
                    }
                } catch (error) {
                    log.error(`Failed to process TIFF page ${page + 1}: ${error}`);
                    // Continue with other pages
                }
            }

            const averageConfidence = pageCount > 0 ? totalConfidence / pageCount : 0;

            const result: OCRResult = {
                text: combinedText.trim(),
                confidence: averageConfidence,
                extractedAt: new Date().toISOString(),
                language: options.language || this.getDefaultOCRLanguage(),
                pageCount: pageCount
            };

            log.info(`TIFF text extraction completed. Pages: ${pageCount}, Confidence: ${averageConfidence}%, Text length: ${result.text.length}`);
            return result;

        } catch (error) {
            log.error(`TIFF text extraction failed: ${error}`);
            throw error;
        }
    }

    getProcessingType(): string {
        return 'tiff';
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