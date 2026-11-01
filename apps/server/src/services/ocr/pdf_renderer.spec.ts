import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRender = vi.fn();
const mockGetOriginalSize = vi.fn();
const mockDestroy = vi.fn();
const mockGetPage = vi.fn(() => ({ getOriginalSize: mockGetOriginalSize, render: mockRender }));
const mockLoadDocument = vi.fn(async () => ({ getPage: mockGetPage, destroy: mockDestroy }));
const mockInit = vi.fn(async () => ({ loadDocument: mockLoadDocument }));

vi.mock("@hyzyla/pdfium", () => ({
    PDFiumLibrary: { init: mockInit }
}));

// Avoid reading the real 4 MB wasm from disk.
vi.mock("fs", () => ({
    default: {
        existsSync: () => false,
        readFileSync: () => Buffer.from("wasm-bytes")
    }
}));

vi.mock("../resource_dir.js", () => ({
    RESOURCE_DIR: "/tmp/trilium-resources"
}));

const mockLog = { info: vi.fn(), error: vi.fn() };

vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    return { ...actual, getLog: () => mockLog };
});

// A fresh singleton per test, so the cached library never leaks between them.
let renderer: typeof import("./pdf_renderer.js").default;
let MAX_RENDER_PIXELS: number;

beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockGetOriginalSize.mockReturnValue({ originalWidth: 612, originalHeight: 792 });
    mockRender.mockResolvedValue({ data: new Uint8Array(16), width: 2, height: 2 });
    mockLoadDocument.mockImplementation(async () => ({ getPage: mockGetPage, destroy: mockDestroy }));
    ({ default: renderer, MAX_RENDER_PIXELS } = await import("./pdf_renderer.js"));
});

afterEach(() => {
    vi.restoreAllMocks();
});

const pdf = new Uint8Array([1, 2, 3]);

/** The scale the renderer asked PDFium for. */
function renderedScale() {
    return mockRender.mock.calls[0][0].scale;
}

describe("PdfRenderer", () => {
    it("renders the requested page in colour at the configured scale", async () => {
        const page = await renderer.renderPage(pdf, 3);

        expect(mockLoadDocument).toHaveBeenCalledWith(pdf);
        // PDFium numbers pages from zero, the OCR pipeline from one.
        expect(mockGetPage).toHaveBeenCalledWith(2);
        expect(mockRender.mock.calls[0][0]).toMatchObject({ scale: 2, render: "bitmap", colorSpace: "BGRA" });
        expect(page).toEqual({ data: new Uint8Array(16), width: 2, height: 2 });
        expect(mockDestroy).toHaveBeenCalledOnce();
    });

    it("loads the library once and reuses it across pages", async () => {
        await renderer.renderPage(pdf, 1);
        await renderer.renderPage(pdf, 2);

        expect(mockInit).toHaveBeenCalledOnce();
    });

    it("does not cache a failed load, so a later page can try again", async () => {
        mockInit.mockRejectedValueOnce(new Error("no wasm"));

        await expect(renderer.renderPage(pdf, 1)).rejects.toThrow("no wasm");
        await expect(renderer.renderPage(pdf, 1)).resolves.toBeDefined();
        expect(mockInit).toHaveBeenCalledTimes(2);
    });

    it("closes the document even when the render throws", async () => {
        mockRender.mockRejectedValue(new Error("broken page"));

        await expect(renderer.renderPage(pdf, 1)).rejects.toThrow("broken page");
        expect(mockDestroy).toHaveBeenCalledOnce();
    });

    it("serializes renders so two pages never share the heap", async () => {
        let releaseFirst: (value: unknown) => void = () => {};
        mockRender
            .mockReturnValueOnce(new Promise((resolve) => { releaseFirst = resolve; }))
            .mockResolvedValue({ data: new Uint8Array(4), width: 1, height: 1 });

        const first = renderer.renderPage(pdf, 1);
        const second = renderer.renderPage(pdf, 2);
        await new Promise((resolve) => setTimeout(resolve, 0));

        // The second page must not have started while the first is still rendering.
        expect(mockRender).toHaveBeenCalledOnce();

        releaseFirst({ data: new Uint8Array(8), width: 2, height: 1 });
        await Promise.all([first, second]);
        expect(mockRender).toHaveBeenCalledTimes(2);
    });

    describe("pixel budget", () => {
        it("leaves an ordinary page at the configured scale", async () => {
            // A1, the largest ISO size that fits the budget at full scale.
            mockGetOriginalSize.mockReturnValue({ originalWidth: 1684, originalHeight: 2384 });

            await renderer.renderPage(pdf, 1);

            expect(renderedScale()).toBe(2);
            expect(mockLog.info).not.toHaveBeenCalledWith(expect.stringContaining("pixel budget"));
        });

        it("scales an outsized page down to the budget and says so", async () => {
            // The largest page the PDF format allows: 200 inches square. At full scale that is
            // 28800x28800 pixels, which would size the bitmap in gigabytes.
            mockGetOriginalSize.mockReturnValue({ originalWidth: 14400, originalHeight: 14400 });

            await renderer.renderPage(pdf, 1);

            const scale = renderedScale();
            expect(scale).toBeLessThan(2);
            // Whatever the scale works out to, the page must land inside the budget.
            expect((14400 * scale) * (14400 * scale)).toBeLessThanOrEqual(MAX_RENDER_PIXELS);
            expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining("pixel budget"));
        });

        it("falls back to the configured scale when the page reports no size", async () => {
            mockGetOriginalSize.mockReturnValue({ originalWidth: 0, originalHeight: 0 });

            await renderer.renderPage(pdf, 1);

            expect(renderedScale()).toBe(2);
        });
    });
});
