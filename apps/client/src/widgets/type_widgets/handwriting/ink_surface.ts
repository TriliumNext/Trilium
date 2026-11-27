import { adaptInkColor } from "@triliumnext/commons/src/lib/handwriting.js";

import { isIOS } from "../../../services/utils";
import {
    AUTO_COLOR, type Bounds, createImage, createStroke, DEFAULT_PRESSURE_SENSITIVITY, getStrokePath,
    HIGHLIGHTER_ALPHA, type InkDocument, type InkImage, type InkLayout, type InkTextBox, type InkTool,
    type InkView, type OpaqueObject, PAGE_GAP,
    getPdfUrls, PAGE_HEIGHT, PAGE_WIDTH, PageLayout, type PaperStyle, type SheetSpec, serializeInkDocument, serializeStroke, splitStroke, type Stroke,
    strokeHitsSegment, StrokeIndex
} from "./ink_document";
import ImageLayer, { type Picture, placeImage } from "./ink_images";
import PdfLayer, { type PdfPages } from "./ink_pdf";
import LiveStroke, { createCanvas, getContext } from "./ink_live_stroke";
import type { MeasuredTextBox } from "./ink_text";
import { drawPaper, type PaperScene } from "./ink_paper";
import InkThumbnail from "./ink_thumbnail";

export type SurfaceTool = InkTool | "eraser" | "select" | "pan";

/** Whether the eraser removes each stroke it touches whole, or only the parts of strokes it covers. */
export const ERASER_MODES = [ "stroke", "partial" ] as const;
export type EraserMode = (typeof ERASER_MODES)[number];

export interface InkSurfaceState {
    zoom: number;
    paper: PaperStyle;
    layout: InkLayout;
    canUndo: boolean;
    canRedo: boolean;
    /** Whether a button of the pen makes it erase, whatever the tool. */
    penErasing: boolean;
    /** The index of the page that fills most of the view, counted from zero. */
    page: number;
    pageCount: number;
    /** Whether an image is selected. */
    hasSelection: boolean;
    /** Whether the note has a PDF as its paper. */
    pdfs: string[];
}

interface InkSurfaceOptions {
    /** Called after the strokes, the images or the paper change through the surface, not after `load()`. */
    onChange(): void;
    /**
     * Called when a stroke or an erase starts, before it changes anything, and then every
     * `GESTURE_INTERVAL` ms until it ends, the pointer moving or not.
     */
    onGesture(): void;
    onStateChange(state: InkSurfaceState): void;
    /** Loads the picture of an image of the note. Without it, images show as empty rectangles. */
    loadImage?(url: string): Promise<Picture | undefined>;
    /** Called after a pan, a zoom or a resize moves the paper in the container. */
    onViewChange?(): void;
    /** Opens a PDF of the note. Without it, the sheets stay empty. */
    openPdf?(url: string): Promise<PdfPages | undefined>;
    /** Returns the text of `boxes` as it is laid out, for the thumbnail. Without it, the thumbnail shows none. */
    measureTexts?(boxes: InkTextBox[]): MeasuredTextBox[];
}

interface HistoryEntry {
    added: Stroke[];
    removed: Stroke[];
    addedImages?: InkImage[];
    removedImages?: InkImage[];
}

type Mode = "idle" | "draw" | "erase" | "image" | "pan" | "pinch";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const ERASER_RADIUS = 8;
/** How much wider than the pen at the same thickness the highlighter draws. */
export const HIGHLIGHTER_WIDTH_FACTOR = 5;
/** The bit of `PointerEvent.buttons` that a pen sets while its eraser end touches the screen. */
const PEN_ERASER_BUTTON = 32;
/** The bit of `PointerEvent.buttons` of the barrel button of a pen, which erases while held. */
const PEN_BARREL_BUTTON = 2;
/** The bit of `PointerEvent.buttons` of a pen's button mapped to the middle button, which pans. */
const PEN_MIDDLE_BUTTON = 4;
/** How long two fingers can rest on the screen, and how far they can move, for a tap that undoes. */
const TWO_FINGER_TAP_TIME = 300;
const TWO_FINGER_TAP_SLOP = 10;
/** How often a stroke or an erase in progress calls `onGesture()`, in ms. */
const GESTURE_INTERVAL = 250;
/** How many loaded strokes `warmSerialization()` encodes per task. */
const WARM_BATCH = 2000;
/** How long after the last zoom step the strokes are drawn again at the new scale, in ms. */
const ZOOM_SETTLE_DELAY = 150;
/** The room left around the content when the view fits it, in CSS pixels. */
const FIT_MARGIN = 32;
/** The largest zoom at which the view fits the width of the content. */
const MAX_FIT_WIDTH_ZOOM = 2;

/**
 * A canvas for handwriting. Finished strokes live on one canvas and the stroke being drawn on the
 * canvases of a `LiveStroke` above it. Panning moves the pixels of the first canvas and draws only
 * the strips that scroll into view.
 */
export default class InkSurface {

    color = AUTO_COLOR;
    size = 3;
    /** The pressure sensitivity of the pen strokes drawn from now on, from 0 to 100. */
    sensitivity = DEFAULT_PRESSURE_SENSITIVITY;
    eraserMode: EraserMode = "stroke";
    /** Whether one finger draws. Otherwise fingers only pan and zoom, and only a pen or a mouse draws. */
    fingerDrawing = false;
    /** Whether a pen or a mouse pans instead of drawing, as while the space bar is held. */
    spacePanning = false;

    private baseCanvas: HTMLCanvasElement;
    private base: CanvasRenderingContext2D;
    private liveStroke: LiveStroke;
    /**
     * The outline of the eraser while a pen or a finger erases. Windows hides the cursor of a pen
     * that touches the screen, and a finger has none.
     */
    private eraserRing: HTMLElement;
    private resizeObserver: ResizeObserver;
    private abort = new AbortController();

    private currentTool: SurfaceTool = "pen";
    private isReadOnly = false;
    private strokes = new Set<Stroke>();
    private index = new StrokeIndex();
    private images: ImageLayer;
    private pdf: PdfLayer;
    private thumbnail: InkThumbnail;
    /** The `order` of the next object, over every object of the note. */
    private nextOrder = 0;
    /** The text boxes, which `TextBoxLayer` shows and changes. The surface only saves them. */
    private texts: InkTextBox[] = [];
    /** What the loaded document holds that this build does not read, for `serialize()` to write back. */
    private opaque: OpaqueObject[] = [];
    private extra: Record<string, unknown> | undefined;
    private penErasing = false;
    private paper: PaperStyle = "ruled";
    private layout: InkLayout = "pages";
    private pages = new PageLayout();
    /** The PDF of a note saved before sheets had sizes, until the note has sheets for its pages. */
    private legacyPdf: string | undefined;
    /** Counts the documents loaded, to tell when a PDF opens for a note no longer shown. */
    private generation = 0;
    private pageCount = 1;
    /** The page last passed to `onStateChange()`, so that a pan reports only a new one. */
    private reportedPage = 0;
    private undoStack: HistoryEntry[] = [];
    private redoStack: HistoryEntry[] = [];

    private dpr = 1;
    /** Whether the canvases have been sized to the container, which the first `resize()` does. */
    private sized = false;
    private zoom = 1;
    /** The position of the world origin on the canvas, in whole device pixels. */
    private tx = 0;
    private ty = 0;
    /** The view that `showView()` was asked for while the container had no size. */
    private pendingView: InkView | "content" | undefined;
    /** Whether `showView()` has placed the view since the note was loaded. */
    private viewShown = false;
    /**
     * The base canvas as it was when a zoom started, and the view it was drawn at. Until the zoom
     * settles, each frame scales this picture instead of drawing every visible stroke again.
     */
    private zoomPreview: { snapshot: HTMLCanvasElement, zoom: number, tx: number, ty: number } | undefined;
    private snapshotCanvas: HTMLCanvasElement | undefined;
    private previewFrame: number | undefined;
    private settleTimer: ReturnType<typeof setTimeout> | undefined;
    private autoColor = "#000";
    private backgroundColor = "#fff";
    /** Whether the theme's background is dark, in which images are shown dark too. */
    private isDark = false;
    /** The color that each ink color is drawn in, in the theme of `isDark`. */
    private inkColors = new Map<string, string>();
    /** The theme's `--note-list-view-content-background` around the pages, if it has one. */
    private deskColor: string | undefined;

    private mode: Mode = "idle";
    private activePointerId: number | undefined;
    private activePointerType: string | undefined;
    private touches = new Map<number, { x: number, y: number, downAt: number, downX: number, downY: number }>();
    /** When a two-finger contact started, while it can still be a tap that undoes. */
    private twoFingerTapStart: number | undefined;
    /** Touches that were down when a pen took over, or came while it drew, until they are lifted. */
    private ignoredTouches = new Set<number>();
    private warmTimer: ReturnType<typeof setTimeout> | undefined;
    private gestureTimer: ReturnType<typeof setInterval> | undefined;
    /** The strokes that the erase in progress removed, and the pieces of them it left. */
    private erased: Stroke[] = [];
    private erasePieces = new Set<Stroke>();
    private lastX = 0;
    private lastY = 0;
    private panRemainderX = 0;
    private panRemainderY = 0;
    /** The pan, in CSS pixels, that the next animation frame applies. */
    private pendingPanX = 0;
    private pendingPanY = 0;
    private panFrame: number | undefined;
    private pinchDistance = 0;

    constructor(private container: HTMLElement, private options: InkSurfaceOptions) {
        this.baseCanvas = createCanvas(container);
        this.base = getContext(this.baseCanvas, { alpha: false });
        this.liveStroke = new LiveStroke(container, {
            toWorld: (clientX, clientY) => this.toWorld(clientX, clientY),
            getZoom: () => this.zoom,
            applyWorldTransform: (ctx) => this.applyWorldTransform(ctx),
            getWorldTransform: () => ({ scale: this.zoom * this.dpr, x: this.tx, y: this.ty }),
            getInkColor: (color) => this.getInkColor(color)
        });
        this.eraserRing = document.createElement("div");
        this.eraserRing.className = "handwriting-eraser-ring";
        this.eraserRing.hidden = true;
        container.append(this.eraserRing);
        this.images = new ImageLayer(container, {
            loadImage: async (url) => this.options.loadImage?.(url),
            toWorld: (clientX, clientY) => this.toWorld(clientX, clientY),
            getView: () => this.getView(),
            redrawBounds: (bounds) => this.redrawBounds(bounds),
            onChange: (before, after) => {
                this.thumbnail.markChanged(before);
                this.thumbnail.markChanged(after);
                this.pushHistory({ added: [], removed: [], addedImages: [ after ], removedImages: [ before ] });
                this.updatePageCount();
                this.options.onChange();
            },
            onSelectionChange: () => this.reportState(),
            onDelete: () => this.deleteSelection()
        });
        this.pdf = new PdfLayer({
            openPdf: async (url) => this.options.openPdf?.(url),
            getLayout: () => this.pages,
            redrawBounds: (bounds) => this.redrawBounds(bounds),
            getScale: () => this.zoom * this.dpr,
            isBusy: () => this.mode !== "idle"
        });
        this.thumbnail = new InkThumbnail({
            getAll: () => this.strokes,
            query: (bounds) => this.index.query(bounds),
            getFirstSheet: () => {
                const { x, y, width, height } = this.pages.getSheet(0);
                return { minX: x, minY: y, maxX: x + width, maxY: y + height };
            },
            getImages: () => this.images.getAll(),
            getPicture: (image) => this.images.getPicture(image),
            whenImagesLoaded: async () => {
                await Promise.all([ this.images.whenLoaded(), this.pdf.prepareFirstPage() ]);
            },
            getBackground: () => this.pdf.getFirstPage(),
            // The height of a box is not known before it is measured, so one above `within` counts.
            getTexts: (within) => this.options.measureTexts?.(within
                ? this.texts.filter(({ x, y, width }) => y <= within.maxY && x <= within.maxX && x + width >= within.minX)
                : this.texts) ?? []
        });

        const listener = { signal: this.abort.signal };
        container.addEventListener("pointerdown", (e) => this.onPointerDown(e), listener);
        container.addEventListener("pointermove", (e) => this.onPointerMove(e), listener);
        container.addEventListener("pointerup", (e) => this.onPointerEnd(e), listener);
        container.addEventListener("pointercancel", (e) => this.onPointerEnd(e), listener);
        container.addEventListener("pointerleave", () => this.setPenErasing(false), listener);
        container.addEventListener("wheel", (e) => this.onWheel(e), { ...listener, passive: false });
        // The barrel button of a pen also opens the context menu.
        container.addEventListener("contextmenu", (e) => e.preventDefault(), listener);
        // iPadOS gives short Apple Pencil strokes to Scribble unless the touch is canceled.
        container.addEventListener("touchstart", (e) => {
            if (isIOS()) e.preventDefault();
        }, { ...listener, passive: false });

        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(container);
        this.resize();
    }

    destroy() {
        this.abort.abort();
        this.resizeObserver.disconnect();
        this.cancelZoomPreview();
        this.liveStroke.destroy();
        if (this.panFrame !== undefined) cancelAnimationFrame(this.panFrame);
        clearTimeout(this.warmTimer);
        clearInterval(this.gestureTimer);
        this.baseCanvas.remove();
        this.eraserRing.remove();
        this.images.destroy();
        this.pdf.destroy();
    }

    get tool() {
        return this.currentTool;
    }

    /** Picks the tool. Only the select tool keeps an image selected. */
    set tool(tool: SurfaceTool) {
        this.currentTool = tool;
        if (tool !== "select") this.images.select(undefined);
    }

    get readOnly() {
        return this.isReadOnly;
    }

    set readOnly(readOnly: boolean) {
        this.isReadOnly = readOnly;
        if (readOnly) this.images.select(undefined);
    }

    load(doc: InkDocument) {
        this.cancelGesture();
        this.strokes = new Set(doc.strokes);
        this.index.clear();
        for (const stroke of doc.strokes) {
            this.index.add(stroke);
        }
        this.texts = doc.texts ?? [];
        const images = doc.images ?? [];
        this.images.load(images);
        this.opaque = doc.opaque ?? [];
        this.extra = doc.extra;
        this.nextOrder = 0;
        for (const { order } of [ ...doc.strokes, ...images, ...this.texts, ...this.opaque ]) {
            this.nextOrder = Math.max(this.nextOrder, Math.floor(order) + 1);
        }
        this.generation++;
        this.pages = new PageLayout(doc.sheets);
        this.legacyPdf = doc.legacyPdf;
        this.pdf.retain(this.getPdfs());
        if (doc.legacyPdf) void this.adoptLegacyPdf(doc.legacyPdf);
        this.paper = doc.paper;
        this.layout = doc.layout;
        this.thumbnail.reset(doc.layout);
        this.pageCount = this.countPages();
        this.viewShown = false;
        this.undoStack = [];
        this.redoStack = [];
        this.cancelZoomPreview();
        this.redrawAll();
        this.reportState();
        this.warmSerialization(doc.strokes);
    }

    /**
     * Encodes the JSON of loaded strokes in short tasks, so that the first save after loading a
     * large note does not encode them all at once.
     */
    private warmSerialization(strokes: Stroke[]) {
        clearTimeout(this.warmTimer);
        let next = 0;
        const step = () => {
            const end = Math.min(strokes.length, next + WARM_BATCH);
            for (; next < end; next++) {
                serializeStroke(strokes[next]);
            }
            this.warmTimer = next < strokes.length ? setTimeout(step, 0) : undefined;
        };
        this.warmTimer = setTimeout(step, 0);
    }

    serialize() {
        return serializeInkDocument({
            paper: this.paper,
            layout: this.layout,
            view: this.getCenterView(),
            strokes: this.strokes,
            images: this.images.getAll(),
            texts: this.texts,
            opaque: this.opaque,
            sheets: this.pages.sizes,
            legacyPdf: this.legacyPdf,
            extra: this.extra
        });
    }

    /** Returns the `order` of a new object, over every object of the note. */
    takeOrder() {
        return this.nextOrder++;
    }

    /**
     * Returns the `order` of a new image: under the strokes and the text boxes, as the surface
     * draws it, and over the images that are under them all.
     */
    private takeImageOrder() {
        let above = Infinity;
        for (const { order } of [ ...this.strokes, ...this.texts ]) {
            above = Math.min(above, order);
        }
        if (above === Infinity) return this.takeOrder();
        let below = above - 1;
        for (const { order } of [ ...this.images.getAll(), ...this.opaque ]) {
            if (order < above) below = Math.max(below, order);
        }
        return (below + above) / 2;
    }

    /** The URLs of the PDFs whose pages lie on the sheets of the note. */
    getPdfs() {
        const urls = getPdfUrls(this.pages.sizes);
        return this.legacyPdf && !urls.includes(this.legacyPdf) ? [ ...urls, this.legacyPdf ] : urls;
    }

    /**
     * Adds a sheet for each page of the PDF at `url`, of the size of the page, after the last
     * sheet in use, and shows the first of them. The note is then laid out in pages. Returns
     * `false` for a PDF that cannot be read, which adds nothing.
     */
    async addPdf(url: string) {
        const { generation } = this;
        const pdf = await this.pdf.open(url);
        if (generation !== this.generation || this.abort.signal.aborted) return false;
        if (!pdf) {
            this.pdf.close(url);
            return false;
        }

        const sheets = [ ...this.pages.sizes ];
        const first = Math.max(sheets.length, this.pages.getPageCount(this.getItems()) - 1);
        while (sheets.length < first) {
            sheets.push({ width: PAGE_WIDTH, height: PAGE_HEIGHT });
        }
        this.setSheets([ ...sheets, ...pdf.sizes.map((size, page) => ({ ...size, source: { url, page } })) ]);
        this.goToPage(first);
        this.options.onChange();
        return true;
    }

    /**
     * Takes the pages of the PDF at `url` off their sheets, which stay as they are, with the ink
     * and the images on them.
     */
    removePdf(url: string) {
        if (!this.getPdfs().includes(url)) return;
        if (this.legacyPdf === url) this.legacyPdf = undefined;
        this.pdf.close(url);
        this.setSheets(this.pages.sizes.map(({ width, height, source }) =>
            (source && source.url !== url ? { width, height, source } : { width, height })));
        this.options.onChange();
    }

    /** Lays the note out in pages with `sheets` as its first ones, and draws it again. */
    private setSheets(sheets: SheetSpec[]) {
        this.pages = new PageLayout(sheets);
        this.layout = "pages";
        this.thumbnail.setLayout(this.layout);
        this.pageCount = this.countPages();
        this.cancelZoomPreview();
        this.redrawAll();
        this.images.updateBox();
        this.reportState();
    }

    /**
     * Gives a note saved with the PDF at `url` and no sheets a sheet for each page of the PDF,
     * from the first, once the PDF is open.
     */
    private async adoptLegacyPdf(url: string) {
        const { generation } = this;
        const pdf = await this.pdf.open(url);
        if (!pdf || generation !== this.generation || this.legacyPdf !== url) return;
        this.legacyPdf = undefined;
        this.setSheets(pdf.sizes.map((size, page) => ({ ...size, source: { url, page } })));
        this.showView("content");
        if (!this.readOnly) this.options.onChange();
    }

    /**
     * Adds the image at `url`, whose picture is `naturalWidth` by `naturalHeight` pixels, in the
     * middle of the view, and selects it.
     */
    addImage(url: string, naturalWidth: number, naturalHeight: number) {
        const { x, y, zoom } = this.getCenterView();
        const visible = {
            x, y,
            width: this.baseCanvas.width / this.dpr / zoom,
            height: this.baseCanvas.height / this.dpr / zoom
        };
        const image = createImage({
            url,
            ...placeImage(naturalWidth, naturalHeight, visible, this.layout === "pages"
                ? this.pages.getSheet(this.pages.indexAt(y))
                : undefined),
            order: this.takeImageOrder(),
            at: Date.now()
        });
        this.pushHistory({ added: [], removed: [], addedImages: [ image ] });
        this.applyHistory([], [], [ image ]);
        this.images.select(image);
        this.options.onChange();
    }

    /** Removes the selected image from the note. */
    deleteSelection() {
        const image = this.images.selection;
        if (!image || this.images.isDragging) return;
        this.pushHistory({ added: [], removed: [], removedImages: [ image ] });
        this.applyHistory([], [], [], [ image ]);
        this.options.onChange();
    }

    clearSelection() {
        this.images.select(undefined);
    }

    /** Returns the picture that previews show, or `undefined` while the saved one is current. */
    exportThumbnail() {
        return this.thumbnail.export();
    }

    /** Records that the picture of `version`, from {@link exportThumbnail}, was saved. */
    markThumbnailSaved(version: number) {
        this.thumbnail.markSaved(version);
    }

    /** Has the next save send the picture, as for a note whose picture was never saved. */
    invalidateThumbnail() {
        this.thumbnail.invalidate();
    }

    /** The world point at the middle of the container, and the zoom. */
    getCenterView(): InkView {
        if (this.pendingView && this.pendingView !== "content") return this.pendingView;
        const scale = this.zoom * this.dpr;
        return {
            x: (this.baseCanvas.width / 2 - this.tx) / scale,
            y: (this.baseCanvas.height / 2 - this.ty) / scale,
            zoom: this.zoom
        };
    }

    /**
     * Shows `view` around the middle of the container, or with `"content"`, all the strokes at
     * 100% or less. An empty note shows its origin at the top left, at 100%.
     */
    showView(view: InkView | "content") {
        if (this.baseCanvas.width <= 1 || this.baseCanvas.height <= 1) {
            this.pendingView = view;
            return;
        }
        this.pendingView = undefined;
        const target = view === "content" ? this.getContentView() : view;
        this.viewShown = true;
        const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, target.zoom));
        const scale = zoom * this.dpr;
        if (this.panFrame !== undefined) cancelAnimationFrame(this.panFrame);
        this.panFrame = undefined;
        this.pendingPanX = 0;
        this.pendingPanY = 0;
        this.panRemainderX = 0;
        this.panRemainderY = 0;
        this.zoom = zoom;
        this.tx = Math.round(this.baseCanvas.width / 2 - target.x * scale);
        this.ty = Math.round(this.baseCanvas.height / 2 - target.y * scale);
        this.cancelZoomPreview();
        this.redrawAll();
        this.liveStroke.redraw();
        this.images.updateBox();
        this.options.onViewChange?.();
        this.reportState();
    }

    /**
     * The view that fits the width of the content: of the page in view on pages, and of all the
     * strokes, images and text boxes on a canvas without bounds. It starts at the top of the content for a note just opened, and
     * keeps the part of it on screen otherwise.
     */
    private getContentView(): InkView {
        const width = this.baseCanvas.width / this.dpr;
        const height = this.baseCanvas.height / this.dpr;
        const sheet = this.pages.getSheet(this.viewShown ? this.getVisiblePage() : 0);
        const bounds = this.layout === "pages"
            ? { minX: sheet.x, minY: 0, maxX: sheet.x + sheet.width }
            : { minX: Infinity, minY: Infinity, maxX: -Infinity };
        if (this.layout === "infinite") {
            if (!this.strokes.size && !this.images.size && !this.texts.length) {
                return { x: width / 2, y: height / 2, zoom: 1 };
            }
            for (const item of this.getItems()) {
                bounds.minX = Math.min(bounds.minX, item.bounds.minX);
                bounds.minY = Math.min(bounds.minY, item.bounds.minY);
                bounds.maxX = Math.max(bounds.maxX, item.bounds.maxX);
            }
            for (const text of this.texts) {
                bounds.minX = Math.min(bounds.minX, text.x);
                bounds.minY = Math.min(bounds.minY, text.y);
                bounds.maxX = Math.max(bounds.maxX, text.x + text.width);
            }
        }

        const fitWidth = Math.max(1, width - 2 * FIT_MARGIN) / (bounds.maxX - bounds.minX);
        const zoom = Math.max(MIN_ZOOM, Math.min(MAX_FIT_WIDTH_ZOOM, fitWidth));
        const firstTop = bounds.minY - FIT_MARGIN / zoom;
        const top = this.viewShown ? Math.max(firstTop, -this.ty / (this.zoom * this.dpr)) : firstTop;
        return { x: (bounds.minX + bounds.maxX) / 2, y: top + height / 2 / zoom, zoom };
    }

    /** The zoom, and the position of the world origin in the container, in CSS pixels. */
    getView() {
        return { zoom: this.zoom, x: this.tx / this.dpr, y: this.ty / this.dpr };
    }

    /** How many pages the note shows, which is one more than the last page holding ink. */
    getPageCount() {
        return this.pageCount;
    }

    /** Shows the top of page `index`, counted from zero, at the current zoom. */
    goToPage(index: number) {
        if (index < 0 || index >= this.pageCount) return;
        const height = this.baseCanvas.height / this.dpr;
        this.showView({
            x: this.getCenterView().x,
            y: this.pages.getPageTop(index) + (height / 2 - FIT_MARGIN) / this.zoom,
            zoom: this.zoom
        });
    }

    setLayout(layout: InkLayout) {
        if (layout === this.layout) return;
        this.layout = layout;
        this.thumbnail.setLayout(layout);
        this.cancelZoomPreview();
        this.redrawAll();
        this.reportState();
        this.options.onChange();
    }

    getPaper() {
        return this.paper;
    }

    /** Draws the paper, the strokes and the stroke being drawn again, in the current theme's colors. */
    refreshTheme() {
        this.cancelZoomPreview();
        this.redrawAll();
        this.liveStroke.redraw();
    }

    setPaper(paper: PaperStyle) {
        if (paper === this.paper) return;
        this.paper = paper;
        this.cancelZoomPreview();
        this.redrawAll();
        this.reportState();
        this.options.onChange();
    }

    undo() {
        const entry = this.undoStack.pop();
        if (!entry) return;
        this.applyHistory(entry.removed, entry.added, entry.removedImages, entry.addedImages);
        this.redoStack.push(entry);
        this.reportState();
        this.options.onChange();
    }

    redo() {
        const entry = this.redoStack.pop();
        if (!entry) return;
        this.applyHistory(entry.added, entry.removed, entry.addedImages, entry.removedImages);
        this.undoStack.push(entry);
        this.reportState();
        this.options.onChange();
    }

    /** Multiplies the zoom by `factor`, keeping the middle of the view in place. */
    zoomBy(factor: number) {
        this.zoomAround(this.baseCanvas.width / 2, this.baseCanvas.height / 2, factor);
    }

    resetZoom() {
        this.zoomBy(1 / this.zoom);
    }

    //#region Input

    private onPointerDown(e: PointerEvent) {
        this.trackPenButtons(e);
        if (e.pointerType === "touch") {
            if (this.activePointerType === "pen") {
                this.ignoredTouches.add(e.pointerId);
                return;
            }
            const now = performance.now();
            this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, downAt: now, downX: e.clientX, downY: e.clientY });
            this.container.setPointerCapture(e.pointerId);
            if (this.touches.size === 2) {
                const isTap = [ ...this.touches.values() ].every((touch) =>
                    now - touch.downAt < TWO_FINGER_TAP_TIME && isWithinSlop(touch));
                this.twoFingerTapStart = isTap ? now : undefined;
                this.cancelGesture();
                this.mode = "pinch";
                this.activePointerType = "touch";
                this.pinchDistance = this.getPinch().distance;
                const { x, y } = this.getPinch();
                this.lastX = x;
                this.lastY = y;
                return;
            }
            if (this.touches.size > 2 || this.mode !== "idle") return;
            if (this.selects()) this.begin(this.selectMode(e), e);
            else this.begin(this.fingerDrawing && !this.pans() ? this.inkMode(e) : "pan", e);
            return;
        }

        if (e.pointerType === "pen" && this.activePointerType === "touch") {
            this.yieldTouchesToPen();
        }
        if (this.mode !== "idle") return;
        if (e.pointerType === "pen") {
            if (this.pans() || (e.buttons & PEN_MIDDLE_BUTTON)) this.begin("pan", e);
            else this.begin(this.selects() ? this.selectMode(e) : this.inkMode(e), e);
        } else if (e.button === 1 || (e.button === 0 && this.pans())) {
            this.begin("pan", e);
        } else if (e.button === 0) {
            this.begin(this.selects() ? this.selectMode(e) : this.inkMode(e), e);
        }
    }

    /** Whether a pen or the main button of a mouse pans instead of drawing or erasing. */
    private pans() {
        return this.readOnly || this.spacePanning || this.tool === "pan";
    }

    /** Whether a pen, a mouse or a finger selects and drags images. */
    private selects() {
        return this.tool === "select" && !this.pans();
    }

    /** Starts dragging the image under the pointer of `e`. On no image, the pointer pans. */
    private selectMode(e: PointerEvent): Mode {
        return this.images.begin(e) ? "image" : "pan";
    }

    /** Ends the gesture of the fingers on the screen, such as a resting palm, for a pen to draw. */
    private yieldTouchesToPen() {
        this.cancelGesture();
        this.twoFingerTapStart = undefined;
        for (const pointerId of this.touches.keys()) {
            this.ignoredTouches.add(pointerId);
        }
        this.touches.clear();
    }

    /** Reports whether the buttons of a pen, hovering or on the screen, make it erase. */
    private trackPenButtons(e: PointerEvent) {
        if (e.pointerType === "pen") this.setPenErasing(isPenErasing(e));
    }

    private setPenErasing(erasing: boolean) {
        if (erasing === this.penErasing) return;
        this.penErasing = erasing;
        this.reportState();
    }

    private inkMode(e: PointerEvent): Mode {
        return this.tool === "eraser" || (e.pointerType === "pen" && isPenErasing(e)) ? "erase" : "draw";
    }

    private begin(mode: Mode, e: PointerEvent) {
        e.preventDefault();
        this.applyPendingPan();
        this.container.setPointerCapture(e.pointerId);
        this.mode = mode;
        this.activePointerId = e.pointerId;
        this.activePointerType = e.pointerType;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        this.panRemainderX = 0;
        this.panRemainderY = 0;
        if (mode === "draw" || mode === "erase" || mode === "image") {
            this.options.onGesture();
            clearInterval(this.gestureTimer);
            this.gestureTimer = setInterval(() => this.options.onGesture(), GESTURE_INTERVAL);
        }

        if (mode === "draw") {
            const tool = this.tool === "highlighter" ? "highlighter" : "pen";
            this.liveStroke.start(e, {
                tool,
                color: this.color,
                size: tool === "highlighter" ? this.size * HIGHLIGHTER_WIDTH_FACTOR : this.size,
                order: this.nextOrder,
                sensitivity: tool === "highlighter" ? undefined : this.sensitivity,
                at: Date.now()
            });
        } else if (mode === "erase") {
            this.erased = [];
            this.erasePieces.clear();
            this.eraserRing.hidden = e.pointerType === "mouse";
            this.moveEraserRing(e);
            this.eraseAlong(e.clientX, e.clientY, e.clientX, e.clientY);
        }
    }

    private onPointerMove(e: PointerEvent) {
        this.trackPenButtons(e);
        if (this.ignoredTouches.has(e.pointerId)) return;
        if (e.pointerType === "touch" && this.touches.has(e.pointerId)) {
            const touch = this.touches.get(e.pointerId);
            if (touch) {
                touch.x = e.clientX;
                touch.y = e.clientY;
                if (!isWithinSlop(touch)) this.twoFingerTapStart = undefined;
            }
        }

        if (this.mode === "pinch") {
            const { x, y, distance } = this.getPinch();
            if (this.pinchDistance > 0 && distance > 0) {
                const origin = this.toDevice(x, y);
                this.zoomAround(origin.x, origin.y, distance / this.pinchDistance);
            }
            this.panByClient(x - this.lastX, y - this.lastY);
            this.pinchDistance = distance;
            this.lastX = x;
            this.lastY = y;
            return;
        }

        if (e.pointerId !== this.activePointerId) return;

        if (this.mode === "draw") {
            this.liveStroke.move(e, this.lastX, this.lastY);
        } else if (this.mode === "erase") {
            this.moveEraserRing(e);
            this.eraseAlong(this.lastX, this.lastY, e.clientX, e.clientY);
        } else if (this.mode === "image") {
            this.images.move(e);
        } else if (this.mode === "pan") {
            this.panByClient(e.clientX - this.lastX, e.clientY - this.lastY);
        }
        this.lastX = e.clientX;
        this.lastY = e.clientY;
    }

    private onPointerEnd(e: PointerEvent) {
        this.trackPenButtons(e);
        if (this.ignoredTouches.delete(e.pointerId)) return;
        this.touches.delete(e.pointerId);
        if (this.twoFingerTapStart !== undefined && this.touches.size === 0) {
            const isTap = performance.now() - this.twoFingerTapStart < TWO_FINGER_TAP_TIME
                && e.type !== "pointercancel";
            this.twoFingerTapStart = undefined;
            if (isTap && !this.readOnly) this.undo();
        }

        if (this.mode === "pinch") {
            if (this.touches.size < 2) {
                this.mode = "idle";
                this.activePointerType = undefined;
            }
            return;
        }
        if (e.pointerId !== this.activePointerId) return;

        if (this.mode === "draw" && this.liveStroke.active) {
            if (e.type === "pointercancel") {
                this.cancelGesture();
                return;
            }
            this.commitLiveStroke();
        } else if (this.mode === "erase" && this.erased.length) {
            this.pushHistory({ added: [ ...this.erasePieces ], removed: this.erased });
            this.erased = [];
            this.erasePieces.clear();
            this.updatePageCount();
            this.options.onChange();
        } else if (this.mode === "image") {
            if (e.type === "pointercancel") this.images.cancel();
            else this.images.end();
        }
        this.endGesture();
    }

    private onWheel(e: WheelEvent) {
        e.preventDefault();

        const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
        if (e.ctrlKey || e.metaKey) {
            const origin = this.toDevice(e.clientX, e.clientY);
            this.zoomAround(origin.x, origin.y, Math.exp(-e.deltaY * unit * 0.002));
        } else if (e.shiftKey) {
            this.panByClient(-e.deltaY * unit, 0);
        } else {
            this.panByClient(-e.deltaX * unit, -e.deltaY * unit);
        }
    }

    private getPinch() {
        const [ a, b ] = [ ...this.touches.values() ];
        return {
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
            distance: Math.hypot(a.x - b.x, a.y - b.y)
        };
    }

    private cancelGesture() {
        this.liveStroke.cancel();
        this.images.cancel();
        if (this.erased.length) {
            this.applyHistory(this.erased, [ ...this.erasePieces ]);
            this.erased = [];
            this.erasePieces.clear();
        }
        this.endGesture();
    }

    private endGesture() {
        this.eraserRing.hidden = true;
        clearInterval(this.gestureTimer);
        this.gestureTimer = undefined;
        this.mode = "idle";
        this.activePointerId = undefined;
        this.activePointerType = undefined;
        this.pdf.resume();
    }

    //#endregion

    //#region Drawing and erasing

    private commitLiveStroke() {
        const finished = this.liveStroke.finish();
        if (!finished) return;
        const { stroke: live, drawn } = finished;

        // Undoing a stroke that a hold made a shape of first gives back the stroke as it was drawn.
        // The shape is another stroke, with an `id` of its own.
        const original = drawn && createStroke(drawn);
        if (original) {
            this.nextOrder++;
            this.pushHistory({ added: [ original ], removed: [] });
        }
        const id = original ? undefined : live.id;
        const stroke = createStroke({ ...live, id, order: this.takeOrder() });
        this.strokes.add(stroke);
        this.index.add(stroke);
        this.thumbnail.add(stroke);
        this.pushHistory({ added: [ stroke ], removed: original ? [ original ] : [] });

        if (!this.zoomPreview) {
            this.applyWorldTransform(this.base);
            this.fillStroke(this.base, stroke);
        }
        this.updatePageCount();
        this.options.onChange();
    }

    private moveEraserRing(e: PointerEvent) {
        if (this.eraserRing.hidden) return;
        const rect = this.container.getBoundingClientRect();
        this.eraserRing.style.transform = `translate(${e.clientX - rect.left}px, ${e.clientY - rect.top}px)`;
    }

    private eraseAlong(fromX: number, fromY: number, toX: number, toY: number) {
        const from = this.toWorld(fromX, fromY);
        const to = this.toWorld(toX, toY);
        const radius = ERASER_RADIUS / this.zoom;
        const candidates = this.index.query({
            minX: Math.min(from.x, to.x) - radius,
            minY: Math.min(from.y, to.y) - radius,
            maxX: Math.max(from.x, to.x) + radius,
            maxY: Math.max(from.y, to.y) + radius
        });

        for (const stroke of candidates) {
            const pieces = this.eraserMode === "partial"
                ? splitStroke(stroke, from.x, from.y, to.x, to.y, radius)
                : strokeHitsSegment(stroke, from.x, from.y, to.x, to.y, radius) ? [] : undefined;
            if (!pieces) continue;
            this.strokes.delete(stroke);
            this.index.remove(stroke);
            this.thumbnail.markChanged(stroke);
            // A piece that this erase made and now removes was never in the note.
            if (!this.erasePieces.delete(stroke)) this.erased.push(stroke);
            for (const piece of pieces) {
                this.strokes.add(piece);
                this.index.add(piece);
                this.thumbnail.markChanged(piece);
                this.erasePieces.add(piece);
            }
            this.redrawBounds(stroke.bounds);
        }
    }

    private pushHistory(entry: HistoryEntry) {
        this.undoStack.push(entry);
        this.redoStack = [];
        this.reportState();
    }

    private applyHistory(
        add: Stroke[], remove: Stroke[], addImages: InkImage[] = [], removeImages: InkImage[] = []
    ) {
        // An image put back in the place of the selected one, as by undoing a move, stays selected.
        const selection = this.images.selection;
        const reselect = selection && removeImages.includes(selection) && addImages.length === 1;
        for (const image of removeImages) {
            this.images.remove(image);
            this.thumbnail.markChanged(image);
        }
        for (const image of addImages) {
            this.images.add(image);
            this.thumbnail.markChanged(image);
        }
        if (reselect) this.images.select(addImages[0]);
        for (const stroke of remove) {
            this.strokes.delete(stroke);
            this.index.remove(stroke);
            this.thumbnail.markChanged(stroke);
            this.redrawBounds(stroke.bounds);
        }
        for (const stroke of add) {
            this.strokes.add(stroke);
            this.index.add(stroke);
            this.thumbnail.markChanged(stroke);
            this.redrawBounds(stroke.bounds);
        }
        this.updatePageCount();
    }

    /** How many pages the note shows: its sheets with a size of their own at least. */
    private countPages() {
        return Math.max(this.pages.getPageCount(this.getItems()), this.pages.sizes.length);
    }

    /** The strokes and the images, for what needs only their bounds. */
    private *getItems(): Iterable<{ bounds: Bounds }> {
        yield* this.strokes;
        yield* this.images.getAll();
    }

    /** Adds an empty page after the last one holding ink or an image, or drops the pages after it. */
    private updatePageCount() {
        const count = this.countPages();
        if (count === this.pageCount) return;
        const from = Math.min(count, this.pageCount);
        const to = Math.max(count, this.pageCount);
        this.pageCount = count;
        this.reportState();
        if (this.layout === "pages") {
            this.redrawBounds({
                minX: -Infinity, minY: this.pages.getPageTop(from) - PAGE_GAP,
                maxX: Infinity, maxY: this.pages.getPageTop(to)
            });
        }
    }

    //#endregion

    //#region View

    private zoomAround(deviceX: number, deviceY: number, factor: number) {
        this.applyPendingPan();
        const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
        if (zoom === this.zoom) return;
        this.beginZoomPreview();

        const applied = zoom / this.zoom;
        this.tx = Math.round(deviceX - (deviceX - this.tx) * applied);
        this.ty = Math.round(deviceY - (deviceY - this.ty) * applied);
        this.zoom = zoom;
        this.schedulePreviewFrame();
        this.liveStroke.redraw();
        this.images.updateBox();
        this.options.onViewChange?.();
        this.reportState();
    }

    /**
     * Pans the view in the next animation frame. Pointers and wheels report several moves per
     * frame, and drawing each one would copy the whole canvas several times per frame.
     */
    private panByClient(dx: number, dy: number) {
        this.pendingPanX += dx;
        this.pendingPanY += dy;
        this.panFrame ??= requestAnimationFrame(() => {
            this.panFrame = undefined;
            this.applyPendingPan();
        });
    }

    private applyPendingPan() {
        if (this.panFrame !== undefined) cancelAnimationFrame(this.panFrame);
        this.panFrame = undefined;
        const dx = this.pendingPanX;
        const dy = this.pendingPanY;
        this.pendingPanX = 0;
        this.pendingPanY = 0;
        if (dx === 0 && dy === 0) return;

        const deviceX = dx * this.dpr + this.panRemainderX;
        const deviceY = dy * this.dpr + this.panRemainderY;
        const wholeX = Math.trunc(deviceX);
        const wholeY = Math.trunc(deviceY);
        this.panRemainderX = deviceX - wholeX;
        this.panRemainderY = deviceY - wholeY;
        if (wholeX === 0 && wholeY === 0) return;

        this.tx += wholeX;
        this.ty += wholeY;
        this.liveStroke.redraw();
        this.images.updateBox();
        this.options.onViewChange?.();
        if (this.getVisiblePage() !== this.reportedPage) this.reportState();

        const { width, height } = this.baseCanvas;
        if (this.zoomPreview) {
            this.schedulePreviewFrame();
            return;
        }
        if (Math.abs(wholeX) >= width || Math.abs(wholeY) >= height) {
            this.redrawAll();
            return;
        }

        this.base.save();
        this.base.setTransform(1, 0, 0, 1, 0, 0);
        this.base.globalCompositeOperation = "copy";
        this.base.drawImage(this.baseCanvas, wholeX, wholeY);
        this.base.restore();

        if (wholeX > 0) this.redrawRegion(0, 0, wholeX, height);
        if (wholeX < 0) this.redrawRegion(width + wholeX, 0, -wholeX, height);
        if (wholeY > 0) this.redrawRegion(0, 0, width, wholeY);
        if (wholeY < 0) this.redrawRegion(0, height + wholeY, width, -wholeY);
    }

    private resize() {
        const rect = this.container.getBoundingClientRect();
        this.dpr = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.round(rect.width * this.dpr));
        const height = Math.max(1, Math.round(rect.height * this.dpr));
        if (width === this.baseCanvas.width && height === this.baseCanvas.height) return;

        // The view keeps its middle in place, as when the note goes fullscreen.
        if (this.sized) {
            this.tx += Math.round((width - this.baseCanvas.width) / 2);
            this.ty += Math.round((height - this.baseCanvas.height) / 2);
        }
        this.sized = true;
        this.baseCanvas.width = width;
        this.baseCanvas.height = height;
        this.liveStroke.resize(width, height);
        this.cancelZoomPreview();
        if (this.pendingView && width > 1 && height > 1) {
            this.showView(this.pendingView);
            return;
        }
        this.redrawAll();
        this.liveStroke.redraw();
        this.images.updateBox();
        this.options.onViewChange?.();
        if (this.getVisiblePage() !== this.reportedPage) this.reportState();
    }

    private reportState() {
        this.reportedPage = this.getVisiblePage();
        this.options.onStateChange({
            zoom: this.zoom,
            paper: this.paper,
            layout: this.layout,
            canUndo: this.undoStack.length > 0,
            canRedo: this.redoStack.length > 0,
            penErasing: this.penErasing,
            page: this.reportedPage,
            pageCount: this.pageCount,
            hasSelection: !!this.images.selection,
            pdfs: this.getPdfs()
        });
    }

    private getVisiblePage() {
        const scale = this.zoom * this.dpr;
        const top = -this.ty / scale;
        return this.pages.getVisiblePage(top, top + this.baseCanvas.height / scale, this.pageCount);
    }

    private toDevice(clientX: number, clientY: number) {
        const rect = this.container.getBoundingClientRect();
        return { x: (clientX - rect.left) * this.dpr, y: (clientY - rect.top) * this.dpr };
    }

    getTextBoxes() {
        return this.texts;
    }

    setTextBoxes(texts: InkTextBox[]) {
        const before = new Set(this.texts);
        const after = new Set(texts);
        for (const box of [ ...this.texts, ...texts ]) {
            if (before.has(box) && after.has(box)) continue;
            // A box is as tall as its text, which the surface does not know.
            this.thumbnail.markChanged({
                bounds: { minX: box.x, minY: box.y, maxX: box.x + box.width, maxY: Infinity }
            });
        }
        this.texts = texts;
        this.options.onChange();
    }

    toWorld(clientX: number, clientY: number) {
        const device = this.toDevice(clientX, clientY);
        const scale = this.zoom * this.dpr;
        return { x: (device.x - this.tx) / scale, y: (device.y - this.ty) / scale };
    }

    //#endregion

    //#region Rendering

    /** Keeps the base canvas as it is now, to be scaled until the zoom settles. */
    private beginZoomPreview() {
        clearTimeout(this.settleTimer);
        this.settleTimer = setTimeout(() => this.settleZoom(), ZOOM_SETTLE_DELAY);
        if (this.zoomPreview) return;

        this.snapshotCanvas ??= document.createElement("canvas");
        const snapshot = this.snapshotCanvas;
        if (snapshot.width !== this.baseCanvas.width || snapshot.height !== this.baseCanvas.height) {
            snapshot.width = this.baseCanvas.width;
            snapshot.height = this.baseCanvas.height;
        }
        const ctx = getContext(snapshot);
        ctx.clearRect(0, 0, snapshot.width, snapshot.height);
        ctx.drawImage(this.baseCanvas, 0, 0);
        this.zoomPreview = { snapshot, zoom: this.zoom, tx: this.tx, ty: this.ty };
    }

    private schedulePreviewFrame() {
        this.previewFrame ??= requestAnimationFrame(() => {
            this.previewFrame = undefined;
            this.drawZoomPreview();
        });
    }

    /** Draws the snapshot of `zoomPreview` where its strokes are in the current view. */
    private drawZoomPreview() {
        const preview = this.zoomPreview;
        if (!preview) return;

        const scale = this.zoom / preview.zoom;
        const { width, height } = this.baseCanvas;
        this.base.save();
        this.base.setTransform(1, 0, 0, 1, 0, 0);
        drawPaper(this.base, 0, 0, width, height, this.getPaperScene());
        this.base.drawImage(
            preview.snapshot,
            this.tx - preview.tx * scale,
            this.ty - preview.ty * scale,
            preview.snapshot.width * scale,
            preview.snapshot.height * scale
        );
        this.base.restore();
    }

    private settleZoom() {
        this.cancelZoomPreview();
        this.redrawAll();
    }

    private cancelZoomPreview() {
        clearTimeout(this.settleTimer);
        this.settleTimer = undefined;
        if (this.previewFrame !== undefined) cancelAnimationFrame(this.previewFrame);
        this.previewFrame = undefined;
        this.zoomPreview = undefined;
    }

    private redrawAll() {
        const style = getComputedStyle(this.container);
        this.autoColor = style.color;
        this.backgroundColor = style.backgroundColor;
        const isDark = isDarkColor(style.backgroundColor);
        if (isDark !== this.isDark) this.inkColors.clear();
        this.isDark = isDark;
        this.deskColor = style.getPropertyValue("--note-list-view-content-background").trim() || undefined;
        this.redrawRegion(0, 0, this.baseCanvas.width, this.baseCanvas.height);
    }

    private redrawBounds(bounds: Bounds) {
        if (this.zoomPreview) return;

        const scale = this.zoom * this.dpr;
        const margin = 2;
        const left = Math.max(0, Math.floor(bounds.minX * scale + this.tx) - margin);
        const top = Math.max(0, Math.floor(bounds.minY * scale + this.ty) - margin);
        const right = Math.min(this.baseCanvas.width, Math.ceil(bounds.maxX * scale + this.tx) + margin);
        const bottom = Math.min(this.baseCanvas.height, Math.ceil(bounds.maxY * scale + this.ty) + margin);
        if (right > left && bottom > top) {
            this.redrawRegion(left, top, right - left, bottom - top);
        }
    }

    /** Clears a rectangle of the base canvas, in device pixels, and draws its strokes again. */
    private redrawRegion(x: number, y: number, width: number, height: number) {
        const ctx = this.base;
        const scale = this.zoom * this.dpr;

        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.beginPath();
        ctx.rect(x, y, width, height);
        ctx.clip();
        drawPaper(ctx, x, y, width, height, this.getPaperScene());
        this.applyWorldTransform(ctx);

        const bounds = {
            minX: (x - this.tx) / scale,
            minY: (y - this.ty) / scale,
            maxX: (x + width - this.tx) / scale,
            maxY: (y + height - this.ty) / scale
        };
        this.pdf.draw(ctx, bounds, this.isDark);
        this.images.draw(ctx, bounds, this.autoColor, this.isDark);
        for (const stroke of this.index.query(bounds)) {
            this.fillStroke(ctx, stroke);
        }
        ctx.restore();
    }

    /** The note's paper as `drawPaper()` draws it in the current view and theme. */
    private getPaperScene(): PaperScene {
        return {
            paper: this.paper,
            layout: this.layout,
            pages: this.pages,
            pageCount: this.pageCount,
            tx: this.tx,
            ty: this.ty,
            scale: this.zoom * this.dpr,
            dpr: this.dpr,
            textColor: this.autoColor,
            backgroundColor: this.backgroundColor,
            deskColor: this.deskColor
        };
    }

    private applyWorldTransform(ctx: CanvasRenderingContext2D) {
        const scale = this.zoom * this.dpr;
        ctx.setTransform(scale, 0, 0, scale, this.tx, this.ty);
    }

    private fillStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
        ctx.globalAlpha = stroke.tool === "highlighter" ? HIGHLIGHTER_ALPHA : 1;
        ctx.fillStyle = this.getInkColor(stroke.color);
        ctx.fill(getStrokePath(stroke));
        ctx.globalAlpha = 1;
    }

    /**
     * Returns the color that ink of `color` is drawn in: the text color for `AUTO_COLOR`, and
     * otherwise the color as `adaptInkColor()` adapts it to the theme. The saved color is kept.
     */
    private getInkColor(color: string) {
        if (color === AUTO_COLOR) return this.autoColor;
        let drawn = this.inkColors.get(color);
        if (drawn === undefined) {
            drawn = adaptInkColor(color, this.isDark);
            this.inkColors.set(color, drawn);
        }
        return drawn;
    }

    //#endregion
}

/** Whether the eraser end or the barrel button of the pen of `e` is pressed. */
function isPenErasing(e: PointerEvent) {
    return (e.buttons & (PEN_ERASER_BUTTON | PEN_BARREL_BUTTON)) !== 0;
}

/** Whether a computed color, `rgb(r, g, b)` or `color(srgb r g b)`, is nearer to black than to white. */
export function isDarkColor(color: string) {
    const channels = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    if (channels.length < 3) return false;
    const range = color.startsWith("rgb") ? 255 : 1;
    return (0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]) / range < 0.5;
}

function isWithinSlop(touch: { x: number, y: number, downX: number, downY: number }) {
    return Math.hypot(touch.x - touch.downX, touch.y - touch.downY) <= TWO_FINGER_TAP_SLOP;
}
