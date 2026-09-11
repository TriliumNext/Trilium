import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetDocumentProxy = vi.fn();
const mockExtractText = vi.fn();

vi.mock("unpdf", () => ({
    getDocumentProxy: mockGetDocumentProxy,
    extractText: mockExtractText
}));

const mockGetBuffer = vi.fn().mockResolvedValue(Buffer.from("png-bytes"));
const mockFromBitmap = vi.fn(() => ({ getBuffer: mockGetBuffer }));

vi.mock("jimp", () => ({
    Jimp: { fromBitmap: mockFromBitmap }
}));

const mockRenderPage = vi.fn();

vi.mock("../pdf_renderer.js", () => ({
    default: { renderPage: mockRenderPage }
}));

const mockRecognize = vi.fn();

vi.mock("../tesseract_recognizer.js", () => ({
    default: { recognize: mockRecognize }
}));

const mockLog = { info: vi.fn(), error: vi.fn() };

vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    return {
        ...actual,
        getLog: () => mockLog
    };
});

// US Letter at 72 dpi, the geometry pdf.js reports for a typical page. At the configured density
// this puts the line between a text page and a scan at about 242 characters.
const LETTER_VIEWPORT = { width: 612, height: 792 };
const mockGetViewport = vi.fn(() => LETTER_VIEWPORT);
const mockGetPage = vi.fn(async () => ({ getViewport: mockGetViewport }));
const pdfProxy = { proxy: true, getPage: mockGetPage };

let PDFProcessor: typeof import("./pdf_processor.js").PDFProcessor;

beforeEach(async () => {
    vi.clearAllMocks();
    mockGetViewport.mockReturnValue(LETTER_VIEWPORT);
    mockGetPage.mockImplementation(async () => ({ getViewport: mockGetViewport }));
    mockGetDocumentProxy.mockResolvedValue(pdfProxy);
    mockGetBuffer.mockResolvedValue(Buffer.from("png-bytes"));
    mockRenderPage.mockImplementation(async () => renderedPage());
    ({ PDFProcessor } = await import("./pdf_processor.js"));
});

afterEach(() => {
    vi.restoreAllMocks();
});

const buffer = Buffer.from("%PDF-1.4 fake");

/**
 * A page as the renderer returns it: four BGRA bytes per pixel, in a buffer of its own. Built fresh
 * per call because the processor converts the page in place.
 */
function renderedPage() {
    return { data: new Uint8Array(100 * 60 * 4), width: 100, height: 60 };
}

/** Embedded text dense enough for a Letter page to read as a real text layer rather than a scan. */
function densePage(marker: string): string {
    return `${marker} `.padEnd(300, "lorem ipsum dolor sit amet ");
}

describe("PDFProcessor", () => {
    it("reports the MIME types it can process", () => {
        const processor = new PDFProcessor();

        expect(processor.canProcess("application/PDF")).toBe(true);
        expect(processor.canProcess("image/png")).toBe(false);
        expect(processor.getSupportedMimeTypes()).toEqual(["application/pdf"]);
        expect(processor.getProcessingType()).toBe("pdf");
    });

    it("uses the embedded text layer and never rasterizes when pages have text", async () => {
        const processor = new PDFProcessor();
        mockExtractText.mockResolvedValue({
            totalPages: 2,
            text: [`  ${densePage("first")}  `, densePage("second")]
        });

        const result = await processor.extractText(buffer, { language: "fra" });

        expect(result.text).toBe(`${densePage("first").trim()}\n\n${densePage("second").trim()}`);
        expect(result.confidence).toBe(0.99);
        expect(result.pageCount).toBe(2);
        expect(result.language).toBe("fra");
        expect(mockExtractText).toHaveBeenCalledWith(pdfProxy, { mergePages: false });
        // No scanned page → nothing rendered and no OCR.
        expect(mockRenderPage).not.toHaveBeenCalled();
        expect(mockRecognize).not.toHaveBeenCalled();
        // buffer is wrapped into a Uint8Array carrying the SAME bytes before being passed to unpdf
        const [docArg] = mockGetDocumentProxy.mock.calls[0];
        expect(docArg).toBeInstanceOf(Uint8Array);
        expect(Buffer.from(docArg as Uint8Array).toString()).toBe("%PDF-1.4 fake");
    });

    it("OCRs a scanned (text-less) page by rendering it", async () => {
        const processor = new PDFProcessor();
        mockExtractText.mockResolvedValue({ totalPages: 1, text: ["   "] });
        mockRecognize.mockResolvedValue({ text: "recognized text", confidence: 0.9 });

        const result = await processor.extractText(buffer, { language: "eng" });

        expect(mockRenderPage).toHaveBeenCalledWith(expect.any(Uint8Array), 1);
        expect(mockRecognize).toHaveBeenCalledWith(Buffer.from("png-bytes"), "eng");
        expect(result.text).toBe("recognized text");
        expect(result.confidence).toBeCloseTo(0.9);
        expect(result.pageCount).toBe(1);
    });

    it("turns the rendered BGRA page into the RGBA bitmap Jimp encodes", async () => {
        const processor = new PDFProcessor();
        mockExtractText.mockResolvedValue({ totalPages: 1, text: [""] });
        mockRenderPage.mockResolvedValue({
            // Two pixels, BGRA: an orange and a teal. The second is transparent, to prove alpha is
            // forced opaque rather than carried through.
            data: Uint8Array.from([16, 128, 240, 255, 200, 160, 32, 0]),
            width: 2,
            height: 1
        });
        mockRecognize.mockResolvedValue({ text: "x", confidence: 0.5 });

        await processor.extractText(buffer, { language: "eng" });

        const [bitmap] = mockFromBitmap.mock.calls[0] as unknown as [{ data: Buffer; width: number; height: number }];
        expect(bitmap.width).toBe(2);
        expect(bitmap.height).toBe(1);
        expect([...bitmap.data]).toEqual([
            240, 128, 16, 255,
            32, 160, 200, 255
        ]);
    });

    it("hands the renderer bytes of its own, since pdf.js takes ownership of what it is given", async () => {
        const processor = new PDFProcessor();
        mockExtractText.mockResolvedValue({ totalPages: 1, text: [""] });
        mockRecognize.mockResolvedValue({ text: "ocr", confidence: 0.9 });

        await processor.extractText(buffer, { language: "eng" });

        const [unpdfBytes] = mockGetDocumentProxy.mock.calls[0];
        const [renderBytes] = mockRenderPage.mock.calls[0];
        expect(renderBytes).not.toBe(unpdfBytes);
        expect(Buffer.from(renderBytes as Uint8Array).toString()).toBe("%PDF-1.4 fake");
    });

    it("handles a mixed PDF, combining embedded text and OCR per page", async () => {
        const processor = new PDFProcessor();
        mockExtractText.mockResolvedValue({
            totalPages: 2,
            text: [densePage("a real text page"), ""]
        });
        mockRecognize.mockResolvedValue({ text: "scanned page text", confidence: 0.8 });

        const result = await processor.extractText(buffer, { language: "eng" });

        expect(result.text).toBe(`${densePage("a real text page").trim()}\n\nscanned page text`);
        // Only the second (scanned) page is rendered.
        expect(mockRenderPage).toHaveBeenCalledTimes(1);
        expect(mockRenderPage).toHaveBeenCalledWith(expect.any(Uint8Array), 2);
        // Average of the embedded-page (0.99) and OCR-page (0.8) confidences.
        expect(result.confidence).toBeCloseTo((0.99 + 0.8) / 2);
    });

    it("OCRs a scan whose only embedded text is a header", async () => {
        const processor = new PDFProcessor();
        // A scanner stamps this much text on a page whose body is pure raster. Any flat character
        // bound low enough to be safe is cleared by it, and the page would never be recognized.
        mockExtractText.mockResolvedValue({ totalPages: 1, text: ["ACME Corp — Invoice 2024-11-03"] });
        mockRecognize.mockResolvedValue({ text: "the body of the invoice", confidence: 0.9 });

        const result = await processor.extractText(buffer, { language: "eng" });

        expect(mockRenderPage).toHaveBeenCalledWith(expect.any(Uint8Array), 1);
        expect(result.text).toBe("the body of the invoice");
    });

    it("scales the text-layer threshold with page area rather than counting characters", async () => {
        const processor = new PDFProcessor();
        // Four times the area of Letter, so the same text is four times as sparse on it.
        mockGetViewport.mockReturnValue({ width: 1224, height: 1584 });
        mockExtractText.mockResolvedValue({ totalPages: 1, text: [densePage("sparse on a large page")] });
        mockRecognize.mockResolvedValue({ text: "recognized", confidence: 0.9 });

        const result = await processor.extractText(buffer, { language: "eng" });

        // The very same text is kept as-is on a Letter page (see the mixed-PDF case above).
        expect(mockRenderPage).toHaveBeenCalledOnce();
        expect(result.text).toBe("recognized");
    });

    it("falls back to a Letter-sized page when the geometry cannot be read", async () => {
        const processor = new PDFProcessor();
        mockGetPage.mockRejectedValue(new Error("no such page"));
        mockExtractText.mockResolvedValue({ totalPages: 1, text: [densePage("still a text page")] });

        const result = await processor.extractText(buffer, { language: "eng" });

        expect(mockRenderPage).not.toHaveBeenCalled();
        expect(result.text).toBe(densePage("still a text page").trim());
        expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining("Could not measure PDF page 1"));
    });

    it("reports zero confidence and empty text when the page holds nothing recognizable", async () => {
        const processor = new PDFProcessor();
        mockExtractText.mockResolvedValue({ totalPages: 1, text: [""] });
        mockRecognize.mockResolvedValue({ text: "", confidence: 0 });

        const result = await processor.extractText(buffer, { language: "eng" });

        expect(result.text).toBe("");
        expect(result.confidence).toBe(0);
    });

    it("tolerates a render failure on a page without aborting the document", async () => {
        const processor = new PDFProcessor();
        mockExtractText.mockResolvedValue({ totalPages: 1, text: [""] });
        mockRenderPage.mockRejectedValue(new Error("broken page"));

        const result = await processor.extractText(buffer, { language: "eng" });

        expect(result.text).toBe("");
        expect(result.confidence).toBe(0);
        expect(mockRecognize).not.toHaveBeenCalled();
        expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining("PDF OCR failed for page 1"));
    });

    it("caps the number of OCR pages and logs the pages it skipped", async () => {
        const processor = new PDFProcessor();
        const totalPages = 55;
        mockExtractText.mockResolvedValue({ totalPages, text: Array(totalPages).fill("") });
        mockRecognize.mockResolvedValue({ text: "p", confidence: 0.9 });

        const result = await processor.extractText(buffer, { language: "eng" });

        // MAX_OCR_PAGES = 50; the remaining 5 scanned pages are skipped, not rendered.
        expect(mockRenderPage).toHaveBeenCalledTimes(50);
        expect(result.text.split("\n\n")).toHaveLength(50);
        expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining("page cap reached"));
    });
});
