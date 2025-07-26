import Tesseract from 'tesseract.js';
import { FileProcessor } from './file_processor.js';
import { OCRResult, OCRProcessingOptions } from '../ocr_service.js';
import log from '../../log.js';
import options from '../../options.js';

/**
 * Image processor for extracting text from image files using Tesseract
 */
export class ImageProcessor extends FileProcessor {
    private worker: Tesseract.Worker | null = null;
    private isInitialized = false;
    private readonly supportedTypes = [
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'image/bmp',
        'image/tiff',
        'image/webp'
    ];

    canProcess(mimeType: string): boolean {
        return this.supportedTypes.includes(mimeType.toLowerCase());
    }

    getSupportedMimeTypes(): string[] {
        return [...this.supportedTypes];
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

            // Filter text based on minimum confidence threshold
            const { filteredText, overallConfidence } = this.filterTextByConfidence(result.data, options);

            const ocrResult: OCRResult = {
                text: filteredText,
                confidence: overallConfidence,
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
     * Filter text based on minimum confidence threshold
     */
    private filterTextByConfidence(data: any, options: OCRProcessingOptions): { filteredText: string; overallConfidence: number } {
        const minConfidence = this.getMinConfidenceThreshold();

        // If no minimum confidence set, return original text
        if (minConfidence <= 0) {
            return {
                filteredText: data.text.trim(),
                overallConfidence: data.confidence / 100
            };
        }

        let filteredWords: string[] = [];
        let validConfidences: number[] = [];

        // Tesseract provides word-level data
        if (data.words && Array.isArray(data.words)) {
            for (const word of data.words) {
                const wordConfidence = word.confidence / 100; // Convert to decimal

                if (wordConfidence >= minConfidence) {
                    filteredWords.push(word.text);
                    validConfidences.push(wordConfidence);
                }
            }
        } else {
            // Fallback: if word-level data not available, use overall confidence
            const overallConfidence = data.confidence / 100;
            if (overallConfidence >= minConfidence) {
                return {
                    filteredText: data.text.trim(),
                    overallConfidence
                };
            } else {
                log.info(`Entire text filtered out due to low confidence ${overallConfidence} (below threshold ${minConfidence})`);
                return {
                    filteredText: '',
                    overallConfidence
                };
            }
        }

        // Calculate average confidence of accepted words
        const averageConfidence = validConfidences.length > 0
            ? validConfidences.reduce((sum, conf) => sum + conf, 0) / validConfidences.length
            : 0;

        const filteredText = filteredWords.join(' ').trim();

        log.info(`Filtered OCR text: ${filteredWords.length} words kept out of ${data.words?.length || 0} total words (min confidence: ${minConfidence})`);

        return {
            filteredText,
            overallConfidence: averageConfidence
        };
    }

    /**
     * Get minimum confidence threshold from options
     */
    private getMinConfidenceThreshold(): number {
        const minConfidence = options.getOption('ocrMinConfidence') ?? 0;
        return parseFloat(minConfidence);
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
