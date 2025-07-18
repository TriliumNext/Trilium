import Tesseract from 'tesseract.js';
import { FileProcessor } from './file_processor.js';
import { OCRResult, OCRProcessingOptions } from '../ocr_service.js';
import log from '../../log.js';

/**
 * Image processor for extracting text from image files using Tesseract
 */
export class ImageProcessor extends FileProcessor {
    private worker: Tesseract.Worker | null = null;
    private isInitialized = false;

    canProcess(mimeType: string): boolean {
        const supportedTypes = [
            'image/jpeg',
            'image/jpg', 
            'image/png',
            'image/gif',
            'image/bmp',
            'image/tiff',
            'image/webp'
        ];
        return supportedTypes.includes(mimeType.toLowerCase());
    }

    async extractText(buffer: Buffer, options: OCRProcessingOptions = {}): Promise<OCRResult> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        if (!this.worker) {
            throw new Error('Image processor worker not initialized');
        }

        try {
            log.info('Starting image OCR text extraction...');

            // Set language if specified and different from current
            // Support multi-language format like 'ron+eng'
            const language = options.language || this.getDefaultOCRLanguage();
            
            // Validate language format
            if (!this.isValidLanguageFormat(language)) {
                throw new Error(`Invalid OCR language format: ${language}. Use format like 'eng' or 'ron+eng'`);
            }
            
            if (language !== 'eng') {
                // For different languages, create a new worker
                await this.worker.terminate();
                log.info(`Initializing Tesseract worker for language(s): ${language}`);
                this.worker = await Tesseract.createWorker(language, 1, {
                    logger: (m: { status: string; progress: number }) => {
                        if (m.status === 'recognizing text') {
                            log.info(`Image OCR progress (${language}): ${Math.round(m.progress * 100)}%`);
                        }
                    }
                });
            }

            const result = await this.worker.recognize(buffer);
            
            const ocrResult: OCRResult = {
                text: result.data.text.trim(),
                confidence: result.data.confidence / 100,  // Convert percentage to decimal
                extractedAt: new Date().toISOString(),
                language: options.language || this.getDefaultOCRLanguage(),
                pageCount: 1
            };

            log.info(`Image OCR extraction completed. Confidence: ${ocrResult.confidence}%, Text length: ${ocrResult.text.length}`);
            return ocrResult;

        } catch (error) {
            log.error(`Image OCR text extraction failed: ${error}`);
            throw error;
        }
    }

    getProcessingType(): string {
        return 'image';
    }

    private async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        try {
            log.info('Initializing image OCR processor with Tesseract.js...');
            
            // Configure proper paths for Node.js environment
            const tesseractDir = require.resolve('tesseract.js').replace('/src/index.js', '');
            const workerPath = require.resolve('tesseract.js/src/worker-script/node/index.js');
            const corePath = require.resolve('tesseract.js-core/tesseract-core.wasm.js');
            
            log.info(`Using worker path: ${workerPath}`);
            log.info(`Using core path: ${corePath}`);
            
            this.worker = await Tesseract.createWorker(this.getDefaultOCRLanguage(), 1, {
                workerPath,
                corePath,
                logger: (m: { status: string; progress: number }) => {
                    if (m.status === 'recognizing text') {
                        log.info(`Image OCR progress: ${Math.round(m.progress * 100)}%`);
                    }
                }
            });
            this.isInitialized = true;
            log.info('Image OCR processor initialized successfully');
        } catch (error) {
            log.error(`Failed to initialize image OCR processor: ${error}`);
            throw error;
        }
    }

    async cleanup(): Promise<void> {
        if (this.worker) {
            await this.worker.terminate();
            this.worker = null;
        }
        this.isInitialized = false;
        log.info('Image OCR processor cleaned up');
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