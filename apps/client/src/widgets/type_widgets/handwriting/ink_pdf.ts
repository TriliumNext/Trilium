import { type Bounds, type PageLayout, type Sheet, type SheetSize, type SheetSource } from "./ink_document";
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
    /** The sheets of the note, each with the page of a PDF that lies on it, if any. */
    getLayout(): PageLayout;
    redrawBounds(bounds: Bounds): void;
    /** Device pixels per world unit. */
    getScale(): number;
    /** Whether a stroke or another gesture is in progress, during which no page is drawn. */
    isBusy(): boolean;
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
    /** The sheet the picture was last drawn for, counted from zero. */
    sheet: number;
    /** The copy that a dark theme shows, made when first drawn. */
    dark?: Picture;
}

interface OpenDocument {
    /** The document once open. */
    pages?: PdfPages;
    /** Resolves to the document, or to `undefined` when it cannot be read or was closed. */
    opening: Promise<PdfPages | undefined>;
}

/**
 * The pages of the PDFs that a handwriting note has as its paper. Each sheet of the note names
 * the page that lies on it, its `SheetSource`, and the layer draws that page as `fitPage()` places
 * it, under the images and the ink. A PDF is opened when one of its pages first comes into view.
 * Pdf.js draws a page on the main thread, so a page is drawn only between gestures, one at a time,
 * and its picture is kept.
 */
export default class PdfLayer {

    private documents = new Map<string, OpenDocument>();
    /** The picture of each page, by `getKey()`. */
    private cache = new Map<string, CachedPage>();
    /** The sheets whose pages wait to be drawn, the one asked for last at the end. */
    private queue: number[] = [];
    private rendering = false;

    constructor(private host: PdfLayerHost) {}

    destroy() {
        this.retain([]);
    }

    /** Opens the PDF at `url`, or returns it when it is open. */
    open(url: string) {
        let document = this.documents.get(url);
        if (!document) {
            const opened: OpenDocument = {
                opening: this.host.openPdf(url).catch(() => undefined).then((pages) => {
                    if (this.documents.get(url) !== opened) {
                        pages?.destroy();
                        return undefined;
                    }
                    opened.pages = pages;
                    return pages;
                })
            };
            document = opened;
            this.documents.set(url, document);
        }
        return document.opening;
    }

    /** Closes the PDF at `url` and drops the pictures of its pages. */
    close(url: string) {
        this.documents.get(url)?.pages?.destroy();
        this.documents.delete(url);
        for (const key of this.cache.keys()) {
            if (key.startsWith(`${url}#`)) this.cache.delete(key);
        }
    }

    /** Closes every PDF but those at `urls`, as for a note just loaded. */
    retain(urls: string[]) {
        this.queue = [];
        for (const url of [ ...this.documents.keys() ]) {
            if (!urls.includes(url)) this.close(url);
        }
    }

    /** Draws the page of the first sheet, for the thumbnail of the note. */
    async prepareFirstPage() {
        if (!this.getFirstPage()) await this.render(0);
    }

    /** The picture of the page of the first sheet, and where it lies. */
    getFirstPage() {
        const source = this.getSource(0);
        const page = source && this.cache.get(getKey(source));
        return page && { picture: page.picture, rect: this.getRect(page, 0) };
    }

    /**
     * Draws the pages that intersect `bounds` on `ctx`, which is in world units, and asks for the
     * pictures of those that have none.
     */
    draw(ctx: CanvasRenderingContext2D, bounds: Bounds, dark: boolean) {
        const layout = this.host.getLayout();
        const first = layout.indexAt(bounds.minY);
        const last = Math.min(layout.sizes.length - 1, layout.indexAt(bounds.maxY));
        for (let index = first; index <= last; index++) {
            const source = this.getSource(index);
            if (!source) continue;
            const page = this.cache.get(getKey(source));
            if (!page || page.pixels * SHARPEN_FACTOR < this.getPixels(index)) this.request(index);
            if (!page) continue;
            page.sheet = index;
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

    private getSource(index: number): SheetSource | undefined {
        return this.host.getLayout().sizes[index]?.source;
    }

    private getRect(page: RenderedPage, index: number) {
        return fitPage(page.width, page.height, this.host.getLayout().getSheet(index));
    }

    /** How long the picture of the page of sheet `index` has to be for the current view, in pixels. */
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
        // The sheet asked for last is the one on screen now.
        const index = this.queue.pop();
        if (index === undefined) return;
        this.rendering = true;
        await this.render(index);
        this.rendering = false;
        void this.renderNext();
    }

    /** Draws the picture of the page of sheet `index`, opening its PDF first if needed. */
    private async render(index: number) {
        const source = this.getSource(index);
        if (!source) return;
        const pages = await this.open(source.url);
        if (!pages || source.page >= pages.pageCount) return;
        const pixels = this.getPixels(index);
        const rendered = await pages.render(source.page, pixels).catch(() => undefined);
        if (!rendered || this.documents.get(source.url)?.pages !== pages) return;
        this.cache.set(getKey(source), { ...rendered, pixels, sheet: index });
        this.evict(index);
        // The sheets can have changed while the page was drawn.
        const current = this.getSource(index);
        if (!current || getKey(current) !== getKey(source)) return;
        const { x, y, width, height } = this.getRect(rendered, index);
        this.host.redrawBounds({ minX: x, minY: y, maxX: x + width, maxY: y + height });
    }

    /**
     * Drops the pictures of the pages farthest from sheet `index` until the rest hold no more than
     * `MAX_CACHED_PIXELS`, but never that of the first sheet.
     */
    private evict(index: number) {
        const first = this.getSource(0);
        const firstKey = first && getKey(first);
        const others = [ ...this.cache.entries() ].filter(([ key ]) => key !== firstKey);
        others.sort(([ , a ], [ , b ]) => Math.abs(a.sheet - index) - Math.abs(b.sheet - index));
        let pixels = 0;
        for (const [ key, { picture } ] of others) {
            pixels += picture.width * picture.height;
            if (pixels > MAX_CACHED_PIXELS) this.cache.delete(key);
        }
    }

}

function getKey({ url, page }: SheetSource) {
    return `${url}#${page}`;
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
