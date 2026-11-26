import { isIOS } from "../../../services/utils";
import {
    AUTO_COLOR, type Bounds, createStroke, getShortStrokeOutline, getStrokeOutline, type InkDocument,
    type InkTool, type InkView, outlineStrokePoints, type PaperStyle, serializeInkDocument, serializeStroke,
    type Stroke, StrokeBuilder, strokeHitsSegment, StrokeIndex
} from "./ink_document";

export type SurfaceTool = InkTool | "eraser";

export interface InkSurfaceState {
    zoom: number;
    paper: PaperStyle;
    canUndo: boolean;
    canRedo: boolean;
}

interface InkSurfaceOptions {
    /** Called after the strokes or the paper change through the surface, not after `load()`. */
    onChange(): void;
    /** Called when a stroke or an erase starts, before it changes anything. */
    onGestureStart(): void;
    onStateChange(state: InkSurfaceState): void;
}

interface HistoryEntry {
    added: Stroke[];
    removed: Stroke[];
}

type Mode = "idle" | "draw" | "erase" | "pan" | "pinch";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
const ERASER_RADIUS = 8;
const HIGHLIGHTER_ALPHA = 0.35;
/** How much wider than the pen at the same thickness the highlighter draws. */
export const HIGHLIGHTER_WIDTH_FACTOR = 5;
/** The bit of `PointerEvent.buttons` that a pen sets while its eraser end touches the screen. */
const PEN_ERASER_BUTTON = 32;
/** How long two fingers can rest on the screen, and how far they can move, for a tap that undoes. */
const TWO_FINGER_TAP_TIME = 300;
const TWO_FINGER_TAP_SLOP = 10;
/** How many stroke points of the stroke being drawn are fixed onto `settledCanvas` at a time. */
const SETTLE_CHUNK = 48;
/**
 * How many stroke points before the end of a settled run the outline drawn after it starts from.
 * The outline of a point depends on its neighbors, so the runs overlap where theirs differ.
 */
const SETTLE_OVERLAP = 8;
/** How many loaded strokes `warmSerialization()` encodes per task. */
const WARM_BATCH = 2000;
/** How long after the last zoom step the strokes are drawn again at the new scale, in ms. */
const ZOOM_SETTLE_DELAY = 150;
/** The spacing of the paper's lines and of its grid, in world units. */
const RULED_STEP = 32;
const GRID_STEP = 24;
/** The room left around the content when the view fits it, in CSS pixels. */
const FIT_MARGIN = 32;
/** The opacity of the paper's lines over the background, in the text color. */
const PAPER_LINE_ALPHA = 0.16;

/**
 * A canvas for handwriting. Finished strokes live on one canvas and the stroke being drawn on two
 * more above it: `settledCanvas` holds the part of the stroke that further points no longer
 * change, and `liveCanvas` its end, drawn again on each animation frame. The cost of a frame
 * therefore does not grow with the length of the stroke. Panning moves the pixels of the first
 * canvas and draws only the strips that scroll into view.
 */
export default class InkSurface {

    tool: SurfaceTool = "pen";
    color = AUTO_COLOR;
    size = 3;
    readOnly = false;
    /** Whether one finger draws. Otherwise fingers only pan and zoom, and only a pen or a mouse draws. */
    fingerDrawing = false;

    private baseCanvas: HTMLCanvasElement;
    private liveLayer: HTMLDivElement;
    private settledCanvas: HTMLCanvasElement;
    private liveCanvas: HTMLCanvasElement;
    private base: CanvasRenderingContext2D;
    private settled: CanvasRenderingContext2D;
    private live: CanvasRenderingContext2D;
    private resizeObserver: ResizeObserver;
    private abort = new AbortController();

    private strokes = new Set<Stroke>();
    private index = new StrokeIndex();
    private nextOrder = 0;
    private paper: PaperStyle = "ruled";
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

    private mode: Mode = "idle";
    private activePointerId: number | undefined;
    private activePointerType: string | undefined;
    private touches = new Map<number, { x: number, y: number, downAt: number, downX: number, downY: number }>();
    /** When a two-finger contact started, while it can still be a tap that undoes. */
    private twoFingerTapStart: number | undefined;
    /** Touches that were down when a pen took over, or came while it drew, until they are lifted. */
    private ignoredTouches = new Set<number>();
    private liveStroke: Stroke | undefined;
    private liveBuilder: StrokeBuilder | undefined;
    /** The index of the stroke point up to which the stroke being drawn is on `settledCanvas`. */
    private settledUpTo = 0;
    /** Raw `x, y, pressure` triples of the input that the browser predicts after the last move. */
    private predicted: number[] = [];
    private liveFrame: number | undefined;
    private warmTimer: ReturnType<typeof setTimeout> | undefined;
    private erased: Stroke[] = [];
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
        this.baseCanvas = this.createCanvas(container);
        this.liveLayer = document.createElement("div");
        this.liveLayer.className = "handwriting-live-layer";
        container.append(this.liveLayer);
        this.settledCanvas = this.createCanvas(this.liveLayer);
        this.liveCanvas = this.createCanvas(this.liveLayer);
        this.base = getContext(this.baseCanvas, { alpha: false });
        this.settled = getContext(this.settledCanvas);
        this.live = getContext(this.liveCanvas);

        const listener = { signal: this.abort.signal };
        container.addEventListener("pointerdown", (e) => this.onPointerDown(e), listener);
        container.addEventListener("pointermove", (e) => this.onPointerMove(e), listener);
        container.addEventListener("pointerup", (e) => this.onPointerEnd(e), listener);
        container.addEventListener("pointercancel", (e) => this.onPointerEnd(e), listener);
        container.addEventListener("wheel", (e) => this.onWheel(e), { ...listener, passive: false });
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
        if (this.liveFrame !== undefined) cancelAnimationFrame(this.liveFrame);
        if (this.panFrame !== undefined) cancelAnimationFrame(this.panFrame);
        clearTimeout(this.warmTimer);
        this.baseCanvas.remove();
        this.liveLayer.remove();
    }

    load(doc: InkDocument) {
        this.cancelGesture();
        this.strokes = new Set(doc.strokes);
        this.index.clear();
        for (const stroke of doc.strokes) {
            this.index.add(stroke);
        }
        this.nextOrder = doc.strokes.length;
        this.paper = doc.paper;
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
        return serializeInkDocument(this.paper, this.strokes, this.getCenterView());
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
        this.redrawLiveStroke();
        this.reportState();
    }

    private getContentView(): InkView {
        const width = this.baseCanvas.width / this.dpr;
        const height = this.baseCanvas.height / this.dpr;
        const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        for (const stroke of this.strokes) {
            bounds.minX = Math.min(bounds.minX, stroke.bounds.minX);
            bounds.minY = Math.min(bounds.minY, stroke.bounds.minY);
            bounds.maxX = Math.max(bounds.maxX, stroke.bounds.maxX);
            bounds.maxY = Math.max(bounds.maxY, stroke.bounds.maxY);
        }
        if (!this.strokes.size) return { x: width / 2, y: height / 2, zoom: 1 };

        const zoom = Math.min(
            1,
            Math.max(1, width - 2 * FIT_MARGIN) / (bounds.maxX - bounds.minX),
            Math.max(1, height - 2 * FIT_MARGIN) / (bounds.maxY - bounds.minY)
        );
        return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2, zoom };
    }

    /** The zoom, and the position of the world origin in the container, in CSS pixels. */
    getView() {
        return { zoom: this.zoom, x: this.tx / this.dpr, y: this.ty / this.dpr };
    }

    getPaper() {
        return this.paper;
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
        this.applyHistory(entry.removed, entry.added);
        this.redoStack.push(entry);
        this.reportState();
        this.options.onChange();
    }

    redo() {
        const entry = this.redoStack.pop();
        if (!entry) return;
        this.applyHistory(entry.added, entry.removed);
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
            this.begin(this.fingerDrawing && !this.readOnly ? this.inkMode(e) : "pan", e);
            return;
        }

        if (e.pointerType === "pen" && this.activePointerType === "touch") {
            this.yieldTouchesToPen();
        }
        if (this.mode !== "idle") return;
        if (e.pointerType === "pen") {
            this.begin(this.readOnly ? "pan" : this.inkMode(e), e);
        } else if (e.button === 1 || (e.button === 0 && this.readOnly)) {
            this.begin("pan", e);
        } else if (e.button === 0) {
            this.begin(this.inkMode(e), e);
        }
    }

    /** Ends the gesture of the fingers on the screen, such as a resting palm, for a pen to draw. */
    private yieldTouchesToPen() {
        this.cancelGesture();
        for (const pointerId of this.touches.keys()) {
            this.ignoredTouches.add(pointerId);
        }
        this.touches.clear();
    }

    private inkMode(e: PointerEvent): Mode {
        return this.tool === "eraser" || (e.buttons & PEN_ERASER_BUTTON) ? "erase" : "draw";
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
        if (mode === "draw" || mode === "erase") {
            this.options.onGestureStart();
        }

        if (mode === "draw") {
            const tool = this.tool === "highlighter" ? "highlighter" : "pen";
            this.liveStroke = createStroke({
                tool,
                color: this.color,
                size: tool === "highlighter" ? this.size * HIGHLIGHTER_WIDTH_FACTOR : this.size,
                simulatePressure: e.pointerType !== "pen",
                points: [],
                order: this.nextOrder
            });
            this.liveBuilder = new StrokeBuilder(this.liveStroke);
            this.settledUpTo = 0;
            this.predicted = [];
            this.liveLayer.style.opacity = tool === "highlighter" ? String(HIGHLIGHTER_ALPHA) : "";
            this.addLivePoints([ e ]);
            this.scheduleLiveFrame();
        } else if (mode === "erase") {
            this.erased = [];
            this.eraseAlong(e.clientX, e.clientY, e.clientX, e.clientY);
        }
    }

    private onPointerMove(e: PointerEvent) {
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

        if (this.mode === "draw" && this.liveStroke) {
            const events = e.getCoalescedEvents?.() ?? [];
            this.addLivePoints(events.length ? events : [ e ]);
            this.predicted = [];
            for (const event of e.getPredictedEvents?.() ?? []) {
                const { x, y } = this.toWorld(event.clientX, event.clientY);
                this.predicted.push(x, y, this.liveStroke.simulatePressure ? 0.5 : event.pressure);
            }
            this.scheduleLiveFrame();
        } else if (this.mode === "erase") {
            this.eraseAlong(this.lastX, this.lastY, e.clientX, e.clientY);
        } else if (this.mode === "pan") {
            this.panByClient(e.clientX - this.lastX, e.clientY - this.lastY);
        }
        this.lastX = e.clientX;
        this.lastY = e.clientY;
    }

    private onPointerEnd(e: PointerEvent) {
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

        if (this.mode === "draw" && this.liveStroke) {
            if (e.type === "pointercancel") {
                this.cancelGesture();
                return;
            }
            this.commitLiveStroke();
        } else if (this.mode === "erase" && this.erased.length) {
            this.pushHistory({ added: [], removed: this.erased });
            this.erased = [];
            this.options.onChange();
        }
        this.mode = "idle";
        this.activePointerId = undefined;
        this.activePointerType = undefined;
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
        this.endLiveStroke();
        if (this.erased.length) {
            this.applyHistory(this.erased, []);
            this.erased = [];
        }
        this.mode = "idle";
        this.activePointerId = undefined;
        this.activePointerType = undefined;
    }

    //#endregion

    //#region Drawing and erasing

    private addLivePoints(events: PointerEvent[]) {
        const stroke = this.liveStroke;
        if (!stroke) return;

        const minDistance = 0.5 / this.zoom;
        for (const event of events) {
            const { x, y } = this.toWorld(event.clientX, event.clientY);
            const length = stroke.points.length;
            if (length >= 3
                && Math.hypot(x - stroke.points[length - 3], y - stroke.points[length - 2]) < minDistance) {
                continue;
            }
            const pressure = stroke.simulatePressure ? 0.5 : event.pressure;
            stroke.points.push(x, y, pressure);
            this.liveBuilder?.add(x, y, pressure);
        }
    }

    private scheduleLiveFrame() {
        if (this.liveFrame !== undefined) return;
        this.liveFrame = requestAnimationFrame(() => {
            this.liveFrame = undefined;
            this.drawLiveStroke();
        });
    }

    /** Settles the stroke points that the next ones can no longer change and draws the rest. */
    private drawLiveStroke() {
        const stroke = this.liveStroke;
        const builder = this.liveBuilder;
        if (!stroke || !builder) return;

        this.clearCanvas(this.live, this.liveCanvas);
        this.applyWorldTransform(this.live);
        if (stroke.points.length <= 6) {
            this.fillOpaque(this.live, stroke, toPath(getShortStrokeOutline(stroke)));
            return;
        }

        const { points } = builder;
        if (points.length - SETTLE_OVERLAP - this.settledUpTo >= SETTLE_CHUNK) {
            this.applyWorldTransform(this.settled);
            while (points.length - SETTLE_OVERLAP - this.settledUpTo >= SETTLE_CHUNK) {
                const end = this.settledUpTo + SETTLE_CHUNK;
                const run = points.slice(Math.max(0, this.settledUpTo - SETTLE_OVERLAP), end + 1);
                this.fillOpaque(this.settled, stroke, toPath(outlineStrokePoints(stroke, run)));
                this.settledUpTo = end;
            }
        }

        const tail = points.slice(Math.max(0, this.settledUpTo - SETTLE_OVERLAP));
        tail.push(...builder.preview(this.predicted));
        this.fillOpaque(this.live, stroke, toPath(outlineStrokePoints(stroke, tail)));
    }

    /** Draws the stroke being drawn again from its start, after the view moved under it. */
    private redrawLiveStroke() {
        if (!this.liveStroke) return;
        this.clearCanvas(this.settled, this.settledCanvas);
        this.settledUpTo = 0;
        this.scheduleLiveFrame();
    }

    private endLiveStroke() {
        if (this.liveFrame !== undefined) cancelAnimationFrame(this.liveFrame);
        this.liveFrame = undefined;
        this.liveStroke = undefined;
        this.liveBuilder = undefined;
        this.predicted = [];
        this.clearCanvas(this.settled, this.settledCanvas);
        this.clearCanvas(this.live, this.liveCanvas);
    }

    private commitLiveStroke() {
        const live = this.liveStroke;
        this.endLiveStroke();
        if (!live || live.points.length < 3) return;

        const stroke = createStroke(live);
        this.nextOrder++;
        this.strokes.add(stroke);
        this.index.add(stroke);
        this.pushHistory({ added: [ stroke ], removed: [] });

        if (!this.zoomPreview) {
            this.applyWorldTransform(this.base);
            this.fillStroke(this.base, stroke);
        }
        this.options.onChange();
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
            if (!strokeHitsSegment(stroke, from.x, from.y, to.x, to.y, radius)) continue;
            this.strokes.delete(stroke);
            this.index.remove(stroke);
            this.erased.push(stroke);
            this.redrawBounds(stroke.bounds);
        }
    }

    private pushHistory(entry: HistoryEntry) {
        this.undoStack.push(entry);
        this.redoStack = [];
        this.reportState();
    }

    private applyHistory(add: Stroke[], remove: Stroke[]) {
        for (const stroke of remove) {
            this.strokes.delete(stroke);
            this.index.remove(stroke);
            this.redrawBounds(stroke.bounds);
        }
        for (const stroke of add) {
            this.strokes.add(stroke);
            this.index.add(stroke);
            this.redrawBounds(stroke.bounds);
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
        this.redrawLiveStroke();
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
        this.redrawLiveStroke();

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
        for (const canvas of [ this.baseCanvas, this.settledCanvas, this.liveCanvas ]) {
            canvas.width = width;
            canvas.height = height;
        }
        this.cancelZoomPreview();
        if (this.pendingView && width > 1 && height > 1) {
            this.showView(this.pendingView);
            return;
        }
        this.redrawAll();
        this.redrawLiveStroke();
    }

    private reportState() {
        this.options.onStateChange({
            zoom: this.zoom,
            paper: this.paper,
            canUndo: this.undoStack.length > 0,
            canRedo: this.redoStack.length > 0
        });
    }

    private toDevice(clientX: number, clientY: number) {
        const rect = this.container.getBoundingClientRect();
        return { x: (clientX - rect.left) * this.dpr, y: (clientY - rect.top) * this.dpr };
    }

    private toWorld(clientX: number, clientY: number) {
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
        this.drawPaper(0, 0, width, height);
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
        this.drawPaper(x, y, width, height);
        this.applyWorldTransform(ctx);

        const strokes = this.index.query({
            minX: (x - this.tx) / scale,
            minY: (y - this.ty) / scale,
            maxX: (x + width - this.tx) / scale,
            maxY: (y + height - this.ty) / scale
        });
        for (const stroke of strokes) {
            this.fillStroke(ctx, stroke);
        }
        ctx.restore();
    }

    /**
     * Fills a rectangle of the base canvas, in device pixels, with the background and the paper's
     * lines. Each line is placed from the view's transform and rounded to a whole device pixel on
     * its own, so the lines stay sharp and in line with the strokes at any zoom.
     */
    private drawPaper(x: number, y: number, width: number, height: number) {
        const ctx = this.base;
        ctx.fillStyle = this.backgroundColor;
        ctx.fillRect(x, y, width, height);
        if (this.paper === "blank") return;

        const scale = this.zoom * this.dpr;
        const thickness = Math.max(1, Math.round(this.dpr));
        const lines = (offset: number, from: number, length: number, step: number) => {
            const positions: number[] = [];
            const first = Math.ceil((from - thickness - offset) / step);
            for (let k = first; offset + k * step < from + length; k++) {
                positions.push(Math.round(offset + k * step));
            }
            return positions;
        };

        ctx.fillStyle = this.autoColor;
        ctx.globalAlpha = PAPER_LINE_ALPHA;
        if (this.paper === "ruled") {
            for (const py of lines(this.ty, y, height, RULED_STEP * scale)) {
                ctx.fillRect(x, py, width, thickness);
            }
        } else if (this.paper === "grid") {
            const step = GRID_STEP * scale;
            for (const py of lines(this.ty, y, height, step)) {
                ctx.fillRect(x, py, width, thickness);
            }
            for (const px of lines(this.tx, x, width, step)) {
                ctx.fillRect(px, y, thickness, height);
            }
        } else {
            const step = GRID_STEP * scale;
            const dot = thickness * 2;
            const rows = lines(this.ty, y, height, step);
            for (const px of lines(this.tx, x, width, step)) {
                for (const py of rows) {
                    ctx.fillRect(px, py, dot, dot);
                }
            }
        }
        ctx.globalAlpha = 1;
    }

    private applyWorldTransform(ctx: CanvasRenderingContext2D) {
        const scale = this.zoom * this.dpr;
        ctx.setTransform(scale, 0, 0, scale, this.tx, this.ty);
    }

    private fillStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
        stroke.path ??= toPath(getStrokeOutline(stroke));
        ctx.globalAlpha = stroke.tool === "highlighter" ? HIGHLIGHTER_ALPHA : 1;
        this.fillOpaque(ctx, stroke, stroke.path);
        ctx.globalAlpha = 1;
    }

    /**
     * Fills a part of the stroke being drawn. The parts overlap, so they are filled opaque and
     * `liveLayer` takes the highlighter's transparency.
     */
    private fillOpaque(ctx: CanvasRenderingContext2D, stroke: Stroke, path: Path2D) {
        ctx.fillStyle = stroke.color === AUTO_COLOR ? this.autoColor : stroke.color;
        ctx.fill(path);
    }

    private clearCanvas(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    private createCanvas(parent: HTMLElement) {
        const canvas = document.createElement("canvas");
        parent.append(canvas);
        return canvas;
    }

    //#endregion
}

function isWithinSlop(touch: { x: number, y: number, downX: number, downY: number }) {
    return Math.hypot(touch.x - touch.downX, touch.y - touch.downY) <= TWO_FINGER_TAP_SLOP;
}

function getContext(canvas: HTMLCanvasElement, settings?: CanvasRenderingContext2DSettings) {
    const ctx = canvas.getContext("2d", settings);
    if (!ctx) throw new Error("The 2D canvas context is not available.");
    return ctx;
}

function toPath(outline: number[][]) {
    const path = new Path2D();
    if (outline.length < 2) return path;

    path.moveTo(outline[0][0], outline[0][1]);
    for (let i = 0; i < outline.length; i++) {
        const [ x, y ] = outline[i];
        const [ nextX, nextY ] = outline[(i + 1) % outline.length];
        path.quadraticCurveTo(x, y, (x + nextX) / 2, (y + nextY) / 2);
    }
    path.closePath();
    return path;
}
