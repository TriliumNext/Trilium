import { getLog } from "@triliumnext/core";

import { OCRProcessingOptions, OCRResult } from "../ocr_service.js";
import renderer, { RenderedPage } from "../pdf_renderer.js";
import recognizer from "../tesseract_recognizer.js";
import { FileProcessor } from "./file_processor.js";

type PdfDocument = Awaited<ReturnType<typeof import("unpdf").getDocumentProxy>>;

/**
 * Embedded characters per square point of page area below which a page counts as scanned and goes
 * to OCR. Scaling by area rather than counting characters is what separates a genuine text layer
 * from the header or watermark a scan carries. Works out to roughly 240 characters on Letter and A4.
 */
const MIN_EMBEDDED_TEXT_DENSITY = 0.0005;

/** Page area in square points assumed when a page cannot be measured; US Letter at 72 dpi. */
const FALLBACK_PAGE_AREA = 612 * 792;

/**
 * Upper bound on how many scanned pages a single PDF may OCR. Rasterizing and recognizing a page
 * costs seconds and non-trivial memory, so a large scan would otherwise stall the OCR queue. Pages
 * beyond the cap keep whatever embedded text they have and are logged, never silently dropped.
 */
const MAX_OCR_PAGES = 50;

/** Embedded text is exact, so a page taken from the text layer reports this confidence. */
const EMBEDDED_TEXT_CONFIDENCE = 0.99;

/**
 * PDF processor. Prefers the PDF's embedded text layer (fast and exact) and falls back to OCR for
 * pages carrying too little text for their size, rasterizing those through {@link renderer} and
 * reading them with the shared Tesseract recognizer. Detection is per page, so a mixed PDF of real
 * text pages and scans is handled correctly.
 */
export class PDFProcessor extends FileProcessor {

    canProcess(mimeType: string): boolean {
        return mimeType.toLowerCase() === "application/pdf";
    }

    getSupportedMimeTypes(): string[] {
        return ["application/pdf"];
    }

    async extractText(buffer: Buffer, options: OCRProcessingOptions = {}): Promise<OCRResult> {
        getLog().info("Starting PDF text extraction...");

        const language = options.language || "eng";
        // Dynamically imported so unpdf only loads when a PDF is actually processed.
        const { extractText, getDocumentProxy } = await import("unpdf");
        const pdf = await getDocumentProxy(new Uint8Array(buffer));
        const { totalPages, text: pageTexts } = await extractText(pdf, { mergePages: false });

        const pageResults: string[] = [];
        const pageConfidences: number[] = [];
        // pdf.js takes ownership of the bytes it is handed, so the renderer gets a copy of its own.
        // Made on the first page that needs it, since a PDF with a full text layer never renders.
        let renderBytes: Uint8Array | null = null;
        let ocrPagesProcessed = 0;
        let ocrPagesSkipped = 0;

        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            const embedded = (pageTexts[pageNum - 1] ?? "").trim();
            const pageArea = await getPageArea(pdf, pageNum);

            if (embedded.length >= pageArea * MIN_EMBEDDED_TEXT_DENSITY) {
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
            renderBytes ??= new Uint8Array(buffer);
            const ocr = await this.ocrPage(renderBytes, pageNum, language);
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
        return "pdf";
    }

    /**
     * OCR a single page by rasterizing it and recognizing the result. Failures on an individual page
     * are logged and treated as "no text" so one bad page never aborts the whole document.
     */
    private async ocrPage(pdf: Uint8Array, pageNum: number, language: string): Promise<{ text: string; confidence: number }> {
        try {
            const page = await renderer.renderPage(pdf, pageNum);
            return await recognizer.recognize(await toPngBuffer(page), language);
        } catch (error) {
            getLog().error(`PDF OCR failed for page ${pageNum}: ${error}`);
            return { text: "", confidence: 0 };
        }
    }
}

/**
 * The area of a page in square points. Falls back to {@link FALLBACK_PAGE_AREA} when the page
 * cannot be measured, so a document that will not report its geometry is still classified.
 */
async function getPageArea(pdf: PdfDocument, pageNum: number): Promise<number> {
    try {
        const { width, height } = (await pdf.getPage(pageNum)).getViewport({ scale: 1 });
        return width > 0 && height > 0 ? width * height : FALLBACK_PAGE_AREA;
    } catch (error) {
        getLog().error(`Could not measure PDF page ${pageNum}: ${error}`);
        return FALLBACK_PAGE_AREA;
    }
}

/**
 * Encode a rendered page into a PNG buffer that Tesseract can decode. The renderer produces BGRA
 * and Jimp bitmaps are RGBA, so blue and red swap places within the page's own buffer, which
 * belongs to this call. Alpha is forced opaque, or a transparent page background reaches Tesseract
 * as black.
 */
async function toPngBuffer({ data, width, height }: RenderedPage): Promise<Buffer> {
    const bitmap = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    for (let i = 0; i < bitmap.length; i += 4) {
        const blue = bitmap[i];
        bitmap[i] = bitmap[i + 2];
        bitmap[i + 2] = blue;
        bitmap[i + 3] = 255;
    }

    // Dynamically imported so jimp only loads when a page is actually rasterized.
    const { Jimp } = await import("jimp");
    return Jimp.fromBitmap({ data: bitmap, width, height }).getBuffer("image/png");
}
