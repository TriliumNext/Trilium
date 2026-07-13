import { getLog, options } from '@triliumnext/core';
import fs from 'fs';
import Tesseract from 'tesseract.js';

import dataDirs from '../data_dir.js';

export interface RecognitionResult {
    /** Recognized text after per-word confidence filtering. */
    text: string;
    /** Overall confidence in the range [0, 1] of the kept text. */
    confidence: number;
}

/** The subset of Tesseract's page result this recognizer relies on. */
interface RecognizedData {
    text: string;
    /** Overall page confidence, 0–100. */
    confidence: number;
    /** Per-word data; absent in some Tesseract output configurations. */
    words?: Array<{ text: string; confidence: number }>;
}

/**
 * Owns a single long-lived Tesseract.js worker and the confidence filtering
 * shared by every OCR path that recognizes raster images — standalone image
 * notes/attachments and, page by page, scanned PDFs. Keeping one worker (rather
 * than one per processor) avoids paying the model-load cost repeatedly and lets
 * an image and a PDF page reuse the same loaded language data.
 */
class TesseractRecognizer {
    private worker: Tesseract.Worker | null = null;
    private currentLanguage: string | null = null;

    /**
     * Recognize text in an encoded image buffer (PNG/JPEG/etc.) for the given
     * Tesseract language code(s), applying the configured confidence filtering.
     */
    async recognize(image: Buffer, language: string): Promise<RecognitionResult> {
        const worker = await this.ensureWorker(language);
        const { data } = await worker.recognize(image);
        return this.filterTextByConfidence(data);
    }

    /**
     * Ensures a Tesseract worker is ready for the given language.
     * Creates a new worker if none exists or if the language has changed.
     */
    private async ensureWorker(language: string): Promise<Tesseract.Worker> {
        if (this.worker && this.currentLanguage === language) {
            return this.worker;
        }

        if (this.worker) {
            await this.worker.terminate();
            this.worker = null;
        }

        fs.mkdirSync(dataDirs.OCR_CACHE_DIR, { recursive: true });

        getLog().info(`Initializing Tesseract worker for language(s): ${language}`);
        const worker = await Tesseract.createWorker(language, 1, {
            cachePath: dataDirs.OCR_CACHE_DIR,
            // Without an errorHandler, tesseract.js rethrows job failures (e.g. undecodable
            // images) from its worker message handler as uncaught exceptions — in the desktop
            // app that surfaces as Electron's blocking "JavaScript error" dialog (#9754).
            // The job promise still rejects, so callers handle the failure normally.
            errorHandler: (error: unknown) => {
                getLog().error(`Tesseract worker error: ${error}`);
            },
            logger: (m: { status: string; progress: number }) => {
                if (m.status === 'recognizing text') {
                    getLog().info(`OCR progress (${language}): ${Math.round(m.progress * 100)}%`);
                }
            }
        });
        this.worker = worker;
        this.currentLanguage = language;
        return worker;
    }

    /**
     * Filter text based on minimum confidence threshold
     */
    private filterTextByConfidence(data: RecognizedData): RecognitionResult {
        const minConfidence = this.getMinConfidenceThreshold();

        // If no minimum confidence set, return original text
        if (minConfidence <= 0) {
            return {
                text: data.text.trim(),
                confidence: data.confidence / 100
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
                    text: data.text.trim(),
                    confidence: overallConfidence
                };
            }
            getLog().info(`Entire text filtered out due to low confidence ${overallConfidence} (below threshold ${minConfidence})`);
            return {
                text: '',
                confidence: overallConfidence
            };
        }

        // Calculate average confidence of accepted words
        const averageConfidence = validConfidences.length > 0
            ? validConfidences.reduce((sum, conf) => sum + conf, 0) / validConfidences.length
            : 0;

        const filteredText = filteredWords.join(' ').trim();

        getLog().info(`Filtered OCR text: ${filteredWords.length} words kept out of ${data.words?.length || 0} total words (min confidence: ${minConfidence})`);

        return {
            text: filteredText,
            confidence: averageConfidence
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

export default new TesseractRecognizer();
