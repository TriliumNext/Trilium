import { getLog } from "@triliumnext/core";
import { Jimp } from "jimp";
import { extractImages, extractText, getDocumentProxy } from 'unpdf';

import { OCRProcessingOptions, OCRResult } from '../ocr_service.js';
import recognizer from '../tesseract_recognizer.js';
import { FileProcessor } from './file_processor.js';

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

/** A page whose embedded text is shorter than this (after trimming) is treated as scanned and sent to OCR. */
const MIN_EMBEDDED_PAGE_CHARS = 16;

/**
 * Upper bound on how many scanned pages a single PDF may OCR. Rasterizing and
 * recognizing a page costs seconds and non-trivial memory, so an unbounded scan
 * of a large document could stall the OCR queue. Pages beyond the cap keep
 * whatever embedded text they have (usually none) and are logged, never silently
 * dropped.
 */
const MAX_OCR_PAGES = 50;

/** An embedded-text page is exact, so it is reported at the same high confidence the previous text-only path used. */
const EMBEDDED_TEXT_CONFIDENCE = 0.99;

/**
 * Embedded images smaller than this on either side are skipped: scanned pages are
 * full-page raster, whereas tiny images are almost always icons, bullets or rules
 * that hold no recognizable text and would only waste an OCR pass.
 */
const MIN_OCR_IMAGE_DIM = 50;

/**
 * PDF processor. Prefers the PDF's embedded text layer (fast and exact) and
 * falls back to OCR for scanned, image-only pages by extracting each page's
 * embedded images and running them through the shared Tesseract recognizer.
 * Detection is per page, so mixed PDFs (some real-text pages, some scans) are
 * handled correctly.
 */
export class PDFProcessor extends FileProcessor {

    canProcess(mimeType: string): boolean {
        return mimeType.toLowerCase() === 'application/pdf';
    }

    getSupportedMimeTypes(): string[] {
        return ['application/pdf'];
    }

    async extractText(buffer: Buffer, options: OCRProcessingOptions = {}): Promise<OCRResult> {
        getLog().info('Starting PDF text extraction...');

        const language = options.language || "eng";
        const pdf = await getDocumentProxy(new Uint8Array(buffer));
        const { totalPages, text: pageTexts } = await extractText(pdf, { mergePages: false });

        const pageResults: string[] = [];
        const pageConfidences: number[] = [];
        let ocrPagesProcessed = 0;
        let ocrPagesSkipped = 0;

        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            const embedded = (pageTexts[pageNum - 1] ?? "").trim();

            if (embedded.length >= MIN_EMBEDDED_PAGE_CHARS) {
                pageResults.push(embedded);
                pageConfidences.push(EMBEDDED_TEXT_CONFIDENCE);
                continue;
            }

            if (ocrPagesProcessed >= MAX_OCR_PAGES) {
                ocrPagesSkipped++;
                if (embedded.length > 0) {
                    pageResults.push(embedded);
                    pageConfidences.push(EMBEDDED_TEXT_CONFIDENCE);
                }
                continue;
            }

            ocrPagesProcessed++;
            const ocr = await this.ocrPage(pdf, pageNum, language);
            if (ocr.text.length > 0) {
                pageResults.push(ocr.text);
                pageConfidences.push(ocr.confidence);
            } else if (embedded.length > 0) {
                // Nothing OCR-able on the page; keep whatever little embedded text it had.
                pageResults.push(embedded);
                pageConfidences.push(EMBEDDED_TEXT_CONFIDENCE);
            }
        }

        if (ocrPagesSkipped > 0) {
            getLog().info(`PDF OCR page cap reached: OCR'd ${MAX_OCR_PAGES} page(s), skipped ${ocrPagesSkipped} further scanned page(s).`);
        }

        const text = pageResults.join("\n\n").trim();
        const confidence = text.length === 0 || pageConfidences.length === 0
            ? 0
            : pageConfidences.reduce((sum, c) => sum + c, 0) / pageConfidences.length;

        return {
            text,
            confidence,
            extractedAt: new Date().toISOString(),
            language,
            pageCount: totalPages
        };
    }

    getProcessingType(): string {
        return 'pdf';
    }

    /**
     * OCR a single scanned page by recognizing each embedded image it paints and
     * concatenating the results. Failures on an individual page are logged and
     * treated as "no text" so one bad page never aborts the whole document.
     */
    private async ocrPage(pdf: PdfDocument, pageNum: number, language: string): Promise<{ text: string; confidence: number }> {
        try {
            const images = await extractImages(pdf, pageNum);
            if (images.length === 0) {
                return { text: "", confidence: 0 };
            }

            const parts: string[] = [];
            const confidences: number[] = [];

            for (const image of images) {
                if (image.width < MIN_OCR_IMAGE_DIM || image.height < MIN_OCR_IMAGE_DIM) {
                    continue;
                }
                const png = await toPngBuffer(image);
                const { text, confidence } = await recognizer.recognize(png, language);
                if (text.length > 0) {
                    parts.push(text);
                    confidences.push(confidence);
                }
            }

            return {
                text: parts.join("\n"),
                confidence: confidences.length > 0
                    ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
                    : 0
            };
        } catch (error) {
            getLog().error(`PDF OCR failed for page ${pageNum}: ${error}`);
            return { text: "", confidence: 0 };
        }
    }
}

interface ExtractedImage {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    // Typed as a plain number rather than `1 | 3 | 4`: the value is whatever unpdf
    // hands us at runtime, so it is validated below rather than trusted here.
    channels: number;
}

/**
 * Encode a raw image extracted from a PDF into a PNG buffer that Tesseract can
 * decode. unpdf returns 1- (grayscale), 3- (RGB) or 4-channel (RGBA) pixel data;
 * Jimp bitmaps are always RGBA, so narrower formats are expanded here. An
 * unexpected channel count throws rather than silently producing garbled pixels.
 */
async function toPngBuffer(image: ExtractedImage): Promise<Buffer> {
    const { data, width, height, channels } = image;
    const pixelCount = width * height;

    let rgba: Buffer;
    if (channels === 4) {
        // Already RGBA — reuse the underlying bytes instead of copying pixel by pixel.
        rgba = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    } else if (channels === 3 || channels === 1) {
        rgba = Buffer.alloc(pixelCount * 4);
        for (let i = 0; i < pixelCount; i++) {
            const out = i * 4;
            if (channels === 1) {
                const value = data[i];
                rgba[out] = value;
                rgba[out + 1] = value;
                rgba[out + 2] = value;
            } else {
                const src = i * 3;
                rgba[out] = data[src];
                rgba[out + 1] = data[src + 1];
                rgba[out + 2] = data[src + 2];
            }
            rgba[out + 3] = 255;
        }
    } else {
        throw new Error(`Unsupported image channel count: ${channels}`);
    }

    const jimpImage = Jimp.fromBitmap({ data: rgba, width, height });
    return jimpImage.getBuffer("image/png");
}
