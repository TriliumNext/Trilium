import { getLog, options } from "@triliumnext/core";
import fs from "fs";
import Tesseract from "tesseract.js";

import dataDirs from "../data_dir.js";

export interface RecognitionResult {
    /** Recognized text after per-word confidence filtering. */
    text: string;
    /** Overall confidence in the range [0, 1] of the kept text. */
    confidence: number;
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
    // Serializes recognition jobs. A language change terminates the shared worker and builds a new
    // one, so a second call arriving mid-recognition could otherwise destroy the worker the first
    // is using. Chaining also bounds OCR to one CPU-heavy job at a time.
    private queue: Promise<unknown> = Promise.resolve();

    /**
     * Recognize text in an encoded image buffer (PNG/JPEG/etc.) for the given
     * Tesseract language code(s), applying the configured confidence filtering.
     * Calls are queued so only one recognition runs at a time.
     */
    recognize(image: Buffer, language: string): Promise<RecognitionResult> {
        const result = this.queue.then(async () => {
            const worker = await this.ensureWorker(language);
            // The per-word breakdown the confidence filter runs on is an opt-in output format:
            // by default `recognize` answers with the plain text and nothing else, leaving the
            // filter with only the whole image's mean confidence to judge by.
            const { data } = await worker.recognize(image, {}, { blocks: true });
            return this.filterTextByConfidence(data);
        });
        // Keep the chain going regardless of this job's outcome, without swallowing
        // the result/error the caller receives.
        this.queue = result.catch(() => {});
        return result;
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
                if (m.status === "recognizing text") {
                    getLog().info(`OCR progress (${language}): ${Math.round(m.progress * 100)}%`);
                }
            }
        });
        this.worker = worker;
        this.currentLanguage = language;
        return worker;
    }

    /**
     * Filter text based on minimum confidence threshold.
     *
     * Word by word, because the words Tesseract is least sure of are usually not words at all —
     * a border read as punctuation, a speck read as a comma — and it is those that drag the mean
     * for the image down. Judging the image by that mean throws away every well-read word on it
     * along with them, so what is kept is decided per word and reassembled line by line, leaving
     * the text laid out as it is on the picture.
     */
    private filterTextByConfidence(data: Tesseract.Page): RecognitionResult {
        const minConfidence = this.getMinConfidenceThreshold();

        // If no minimum confidence set, return original text
        if (minConfidence <= 0) {
            return {
                text: data.text.trim(),
                confidence: data.confidence / 100
            };
        }

        const lines = getRecognizedLines(data);

        // Nothing was broken down into words — an image nothing could be read from. There is only
        // the one score to go by, so the text stands or falls as a whole.
        if (lines.length === 0) {
            const overallConfidence = data.confidence / 100;
            if (overallConfidence >= minConfidence) {
                return {
                    text: data.text.trim(),
                    confidence: overallConfidence
                };
            }
            getLog().info(`Entire text filtered out due to low confidence ${overallConfidence} (below threshold ${minConfidence})`);
            return {
                text: "",
                confidence: overallConfidence
            };
        }

        const keptLines: string[] = [];
        const keptConfidences: number[] = [];
        let totalWords = 0;

        for (const line of lines) {
            const keptWords: string[] = [];

            for (const word of line.words ?? []) {
                totalWords++;
                const wordConfidence = word.confidence / 100; // Convert to decimal

                if (wordConfidence >= minConfidence) {
                    keptWords.push(word.text);
                    keptConfidences.push(wordConfidence);
                }
            }

            // A line every word of which was dropped leaves no blank behind: the gap would read as
            // spacing on the picture that isn't there.
            if (keptWords.length > 0) {
                keptLines.push(keptWords.join(" "));
            }
        }

        // Calculate average confidence of accepted words
        const averageConfidence = keptConfidences.length > 0
            ? keptConfidences.reduce((sum, conf) => sum + conf, 0) / keptConfidences.length
            : 0;

        getLog().info(`Filtered OCR text: ${keptConfidences.length} words kept out of ${totalWords} total words (min confidence: ${minConfidence})`);

        return {
            text: keptLines.join("\n").trim(),
            confidence: averageConfidence
        };
    }

    /**
     * Get minimum confidence threshold from options
     */
    private getMinConfidenceThreshold(): number {
        const minConfidence = options.getOption("ocrMinConfidence") ?? 0;
        return parseFloat(minConfidence);
    }
}

export default new TesseractRecognizer();

/**
 * The words Tesseract read, in the lines it read them on.
 *
 * They sit three levels down the page it describes, and that description is only present when the
 * `blocks` output format was asked for — see {@link TesseractRecognizer.recognize}. Without it, and
 * for an image nothing was read from, this is empty.
 */
function getRecognizedLines(data: Tesseract.Page): Tesseract.Line[] {
    return (data.blocks ?? []).flatMap(
        block => (block.paragraphs ?? []).flatMap(paragraph => paragraph.lines ?? [])
    );
}
