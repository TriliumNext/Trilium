import fs from 'fs';
import Tesseract from 'tesseract.js';

import dataDirs from '../../data_dir.js';
import log from '../../log.js';
import options from '../../options.js';
import { OCRProcessingOptions,OCRResult } from '../ocr_service.js';
import { FileProcessor } from './file_processor.js';

/**
 * Image processor for extracting text from image files using Tesseract
 */
export class ImageProcessor extends FileProcessor {
    private worker: Tesseract.Worker | null = null;
    private currentLanguage: string | null = null;
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
        const language = options.language || "eng";
        await this.ensureWorker(language);

        try {
            log.info(`Starting image OCR text extraction (language: ${language})...`);

            const result = await this.worker!.recognize(buffer);

            // Filter text based on minimum confidence threshold
            const { filteredText, overallConfidence } = this.filterTextByConfidence(result.data);

            const ocrResult: OCRResult = {
                text: filteredText,
                confidence: overallConfidence,
                extractedAt: new Date().toISOString(),
                language,
                pageCount: 1
            };

            return ocrResult;

        } catch (error) {
            log.error(`Image OCR text extraction failed: ${error}`);
            throw error;
        }
    }

    getProcessingType(): string {
        return 'image';
    }

    /**
     * Ensures a Tesseract worker is ready for the given language.
     * Creates a new worker if none exists or if the language has changed.
     */
    private async ensureWorker(language: string): Promise<void> {
        if (this.worker && this.currentLanguage === language) {
            return;
        }

        if (this.worker) {
            await this.worker.terminate();
        }

        fs.mkdirSync(dataDirs.OCR_CACHE_DIR, { recursive: true });

        log.info(`Initializing Tesseract worker for language(s): ${language}`);
        this.worker = await Tesseract.createWorker(language, 1, {
            cachePath: dataDirs.OCR_CACHE_DIR,
            logger: (m: { status: string; progress: number }) => {
                if (m.status === 'recognizing text') {
                    log.info(`Image OCR progress (${language}): ${Math.round(m.progress * 100)}%`);
                }
            }
        });
        this.currentLanguage = language;
    }


    /**
     * Filter text based on minimum confidence threshold
     */
    private filterTextByConfidence(data: any): { filteredText: string; overallConfidence: number } {
        const minConfidence = this.getMinConfidenceThreshold();

        // If no minimum confidence set, return original text
        if (minConfidence <= 0) {
            return {
                filteredText: data.text.trim(),
                overallConfidence: data.confidence / 100
            };
        }

        const filteredWords: string[] = [];
        const validConfidences: number[] = [];

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
            }
            log.info(`Entire text filtered out due to low confidence ${overallConfidence} (below threshold ${minConfidence})`);
            return {
                filteredText: '',
                overallConfidence
            };
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

}
