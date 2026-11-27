import { type Bounds, type PageLayout, type Sheet, type SheetSize } from "./ink_document";
import { darkenPicture, type Picture } from "./ink_images";

/** The longest side of the picture of a page, in pixels, however far the view is zoomed in. */
export const MAX_PAGE_PIXELS = 2400;
/**
 * How many pixels the pictures of the pages hold together, besides that of the first page: four
 * A4 pages at `MAX_PAGE_PIXELS`, or every page on screen when the view is zoomed far out.
 */
const MAX_CACHED_PIXELS = 20_000_000;
/** A picture is drawn again once the view asks for one this many times larger. */
const SHARPEN_FACTOR = 1.3;
/** World units, which are pixels at 96 DPI, per PDF point. */
const UNITS_PER_POINT = 96 / 72;

/** The picture of a page of a PDF, and the size of the page in PDF points. */
export interface RenderedPage {
    picture: Picture;
    width: number;
    height: number;
}

/** An open PDF document, as `openPdf()` returns it. */
export interface PdfPages {
    pageCount: number;
    /** The size of each page, in world units. */
    sizes: SheetSize[];
    /** Returns the picture of page `index`, counted from zero, `pixels` long on its longer side. */
    render(index: number, pixels: number): Promise<RenderedPage>;
    destroy(): void;
}

export interface PdfLayerHost {
    /** Opens the PDF at `url`, or returns `undefined` when it cannot be read. */
    openPdf(url: string): Promise<PdfPages | undefined>;
    /** The sheets of the note, which the pages lie on. */
    getLayout(): PageLayout;
    redrawBounds(bounds: Bounds): void;
    /** Device pixels per world unit. */
    getScale(): number;
    /** Whether a stroke or another gesture is in progress, during which no page is drawn. */
    isBusy(): boolean;
    /** Called once the PDF is open, before its first page is drawn. */
    onOpen(pages: PdfPages): void;
}

/** Where a page lies, in world units. */
export interface PageRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface CachedPage extends RenderedPage {
    /** The length in pixels the picture was asked for. */
    pixels: number;
    /** The copy that a dark theme shows, made when first drawn. */
    dark?: Picture;
}

/**
 * The PDF that a handwriting note has as its paper. Page `n` of the PDF lies on sheet `n` of the
 * note, as `fitPage()` places it, under the images and the ink. Pdf.js draws a page on the main
 * thread, so a page is drawn only between gestures, one at a time, and its picture is kept.
 */
export default class PdfLayer {

    private currentUrl: string | undefined;
    private pages: PdfPages | undefined;
    private cache = new Map<number, CachedPage>();
    private queue: number[] = [];
    private rendering = false;
    /** Resolves once the PDF is open and its first page is drawn, or either failed. */
    private ready: Promise<void> = Promise.resolve();

    constructor(private host: PdfLayerHost) {}

    destroy() {
        this.set(undefined);
    }

    get url() {
        return this.currentUrl;
    }

    /** The number of pages, or zero until the PDF is open. */
    get pageCount() {
        return this.pages?.pageCount ?? 0;
    }

    /** Shows the PDF at `url`, or none. */
    set(url: string | undefined) {
        if (url === this.currentUrl) return;
        this.pages?.destroy();
        this.pages = undefined;
        this.cache.clear();
        this.queue = [];
        this.currentUrl = url;
        this.ready = url ? this.open(url) : Promise.resolve();
    }

    whenReady() {
        return this.ready;
    }

    /** The picture of the first page and where it lies, for the thumbnail of the note. */
    getFirstPage() {
        const page = this.cache.get(0);
        return page && { picture: page.picture, rect: this.getRect(page, 0) };
    }

    /**
     * Draws the pages that intersect `bounds` on `ctx`, which is in world units, and asks for the
     * pictures of those that have none.
     */
    draw(ctx: CanvasRenderingContext2D, bounds: Bounds, dark: boolean) {
        if (!this.pages) return;
        const layout = this.host.getLayout();
        const first = layout.indexAt(bounds.minY);
        const last = Math.min(this.pages.pageCount - 1, layout.indexAt(bounds.maxY));
        for (let index = first; index <= last; index++) {
            const page = this.cache.get(index);
            if (!page || page.pixels * SHARPEN_FACTOR < this.getPixels(index)) this.request(index);
            if (!page) continue;
            const rect = this.getRect(page, index);
            if (dark) page.dark ??= darkenPicture(page.picture);
            const picture = dark && page.dark ? page.dark : page.picture;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(picture, rect.x, rect.y, rect.width, rect.height);
        }
    }

    /** Draws the pages asked for while a gesture was in progress. */
    resume() {
        void this.renderNext();
    }

    private async open(url: string) {
        const pages = await this.host.openPdf(url).catch(() => undefined);
        if (this.currentUrl !== url) {
            pages?.destroy();
            return;
        }
        this.pages = pages;
        if (!pages) return;
        this.host.onOpen(pages);
        await this.render(0);
    }

    private getRect(page: RenderedPage, index: number) {
        return fitPage(page.width, page.height, this.host.getLayout().getSheet(index));
    }

    /** How long the picture of page `index` has to be for the current view, in pixels. */
    private getPixels(index: number) {
        const { width, height } = this.host.getLayout().getSheet(index);
        return Math.min(MAX_PAGE_PIXELS, Math.ceil(Math.max(width, height) * this.host.getScale()));
    }

    private request(index: number) {
        if (!this.queue.includes(index)) this.queue.push(index);
        void this.renderNext();
    }

    private async renderNext() {
        if (this.rendering || this.host.isBusy()) return;
        // The page asked for last is the one on screen now.
        const index = this.queue.pop();
        if (index === undefined) return;
        this.rendering = true;
        await this.render(index);
        this.rendering = false;
        void this.renderNext();
    }

    private async render(index: number) {
        const { pages, currentUrl: url } = this;
        if (!pages) return;
        const pixels = this.getPixels(index);
        const rendered = await pages.render(index, pixels).catch(() => undefined);
        if (!rendered || this.currentUrl !== url) return;
        this.cache.set(index, { ...rendered, pixels });
        this.evict(index);
        const { x, y, width, height } = this.getRect(rendered, index);
        this.host.redrawBounds({ minX: x, minY: y, maxX: x + width, maxY: y + height });
    }

    /**
     * Drops the pictures of the pages farthest from page `index` until the rest hold no more than
     * `MAX_CACHED_PIXELS`, but never the first page's.
     */
    private evict(index: number) {
        const others = [ ...this.cache.keys() ].filter((key) => key !== 0);
        others.sort((a, b) => Math.abs(a - index) - Math.abs(b - index));
        let pixels = 0;
        for (const key of others) {
            const picture = this.cache.get(key)?.picture;
            pixels += (picture?.width ?? 0) * (picture?.height ?? 0);
            if (pixels > MAX_CACHED_PIXELS) this.cache.delete(key);
        }
    }

}

/**
 * Returns where a page of `width` by `height`, in any unit, lies on `sheet`: as large as fits the
 * sheet, at its top and centered across it. A page fills a sheet of its own size.
 */
export function fitPage(width: number, height: number, sheet: Sheet): PageRect {
    const scale = Math.min(sheet.width / width, sheet.height / height);
    return {
        x: sheet.x + (sheet.width - width * scale) / 2,
        y: sheet.y,
        width: width * scale,
        height: height * scale
    };
}

/** The parts of pdf.js that `openPdf()` uses. */
interface PdfJs {
    GlobalWorkerOptions: { workerSrc: string };
    /** Returns the task that loads a document, which is also what closes it. */
    getDocument(source: object): { promise: Promise<PdfJsDocument>, destroy(): Promise<void> };
}

interface PdfJsDocument {
    numPages: number;
    getPage(pageNumber: number): Promise<PdfJsPage>;
}

interface PdfJsPage {
    getViewport(options: { scale: number }): { width: number, height: number };
    render(options: { canvas: HTMLCanvasElement, viewport: object }): { promise: Promise<void> };
    cleanup(): void;
}

/**
 * Where every app serves the build of `packages/pdfjs-viewer`, which holds pdf.js, its worker and
 * the fonts and decoders it loads. The client loads pdf.js from there when a note first shows a
 * PDF, and bundles no copy of its own.
 */
const PDFJS_BASE = "pdfjs/";
let pdfJs: Promise<PdfJs> | undefined;

function loadPdfJs() {
    pdfJs ??= (async () => {
        const base = new URL(PDFJS_BASE, document.baseURI).href;
        const library: PdfJs = await import(/* @vite-ignore */ `${base}build/pdf.mjs`);
        library.GlobalWorkerOptions.workerSrc = `${base}build/pdf.worker.mjs`;
        return library;
    })();
    pdfJs.catch(() => {
        pdfJs = undefined;
    });
    return pdfJs;
}

/** Opens the PDF at `url` with pdf.js, or returns `undefined` when it cannot be read. */
export async function openPdf(url: string): Promise<PdfPages | undefined> {
    try {
        const [ library, response ] = await Promise.all([ loadPdfJs(), fetch(url) ]);
        if (!response.ok) return undefined;
        const base = new URL(PDFJS_BASE, document.baseURI).href;
        const task = library.getDocument({
            data: await response.arrayBuffer(),
            cMapUrl: `${base}web/cmaps/`,
            iccUrl: `${base}web/iccs/`,
            standardFontDataUrl: `${base}web/standard_fonts/`,
            wasmUrl: `${base}web/wasm/`
        });
        const document_ = await task.promise;
        const sizes: SheetSize[] = [];
        for (let pageNumber = 1; pageNumber <= document_.numPages; pageNumber++) {
            const page = await document_.getPage(pageNumber);
            sizes.push(toSheetSize(page.getViewport({ scale: 1 })));
        }
        return {
            pageCount: document_.numPages,
            sizes,
            async render(index, pixels) {
                const page = await document_.getPage(index + 1);
                const { width, height } = page.getViewport({ scale: 1 });
                const viewport = page.getViewport({ scale: pixels / Math.max(width, height) });
                const canvas = document.createElement("canvas");
                canvas.width = Math.ceil(viewport.width);
                canvas.height = Math.ceil(viewport.height);
                await page.render({ canvas, viewport }).promise;
                page.cleanup();
                return { picture: canvas, width, height };
            },
            destroy: () => void task.destroy()
        };
    } catch (e) {
        console.error(`Could not open the PDF at '${url}'`, e);
        return undefined;
    }
}

/**
 * Returns the size of the sheet for a page of `width` by `height` PDF points: the size of the
 * page as printed, to a tenth of a world unit, as a saved document holds it.
 */
export function toSheetSize({ width, height }: { width: number, height: number }): SheetSize {
    return {
        width: Math.round(width * UNITS_PER_POINT * 10) / 10,
        height: Math.round(height * UNITS_PER_POINT * 10) / 10
    };
}
