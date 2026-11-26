import { isIOS } from "../../../services/utils";
import {
    AUTO_COLOR, type Bounds, createStroke, getStrokeOutline, type InkDocument, type InkTool,
    type PaperStyle, serializeInkDocument, type Stroke, strokeHitsSegment, StrokeIndex
} from "./ink_document";

export type SurfaceTool = InkTool | "eraser";

export interface InkSurfaceState {
    zoom: number;
    canUndo: boolean;
    canRedo: boolean;
}

interface InkSurfaceOptions {
    /** Called after the strokes or the paper change through the surface, not after `load()`. */
    onChange(): void;
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
/** The bit of `PointerEvent.buttons` that a pen sets while its eraser end touches the screen. */
const PEN_ERASER_BUTTON = 32;

/**
 * A canvas for handwriting. Finished strokes live on one canvas and the stroke being drawn on
 * another above it, so a pointer move repaints only the stroke in progress. Panning moves the
 * pixels of the first canvas and draws only the strips that scroll into view.
 */
export default class InkSurface {

    tool: SurfaceTool = "pen";
    color = AUTO_COLOR;
    size = 3;
    readOnly = false;

    private baseCanvas: HTMLCanvasElement;
    private liveCanvas: HTMLCanvasElement;
    private base: CanvasRenderingContext2D;
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
    private zoom = 1;
    /** The position of the world origin on the canvas, in whole device pixels. */
    private tx = 0;
    private ty = 0;
    private fullRedrawFrame: number | undefined;
    private autoColor = "#000";

    private mode: Mode = "idle";
    private activePointerId: number | undefined;
    private penSeen = false;
    private touches = new Map<number, { x: number, y: number }>();
    private liveStroke: Stroke | undefined;
    private erased: Stroke[] = [];
    private lastX = 0;
    private lastY = 0;
    private panRemainderX = 0;
    private panRemainderY = 0;
    private pinchDistance = 0;

    constructor(private container: HTMLElement, private options: InkSurfaceOptions) {
        this.baseCanvas = this.createCanvas();
        this.liveCanvas = this.createCanvas();
        this.base = getContext(this.baseCanvas);
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
        this.syncPaper();
    }

    destroy() {
        this.abort.abort();
        this.resizeObserver.disconnect();
        if (this.fullRedrawFrame !== undefined) cancelAnimationFrame(this.fullRedrawFrame);
        this.baseCanvas.remove();
        this.liveCanvas.remove();
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
        this.syncPaper();
        this.redrawAll();
        this.reportState();
    }

    serialize() {
        return serializeInkDocument(this.paper, this.strokes);
    }

    getPaper() {
        return this.paper;
    }

    setPaper(paper: PaperStyle) {
        if (paper === this.paper) return;
        this.paper = paper;
        this.syncPaper();
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
            this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
            this.container.setPointerCapture(e.pointerId);
            if (this.touches.size === 2) {
                this.cancelGesture();
                this.mode = "pinch";
                this.pinchDistance = this.getPinch().distance;
                const { x, y } = this.getPinch();
                this.lastX = x;
                this.lastY = y;
                return;
            }
            if (this.touches.size > 2 || this.mode !== "idle") return;
            // Once a pen has drawn, a finger moves the page; without a pen, the finger is the pen.
            this.begin(this.penSeen || this.readOnly ? "pan" : this.inkMode(e), e);
            return;
        }

        if (this.mode !== "idle") return;
        if (e.pointerType === "pen") {
            this.penSeen = true;
            this.begin(this.readOnly ? "pan" : this.inkMode(e), e);
        } else if (e.button === 1 || (e.button === 0 && this.readOnly)) {
            this.begin("pan", e);
        } else if (e.button === 0) {
            this.begin(this.inkMode(e), e);
        }
    }

    private inkMode(e: PointerEvent): Mode {
        return this.tool === "eraser" || (e.buttons & PEN_ERASER_BUTTON) ? "erase" : "draw";
    }

    private begin(mode: Mode, e: PointerEvent) {
        e.preventDefault();
        this.container.setPointerCapture(e.pointerId);
        this.mode = mode;
        this.activePointerId = e.pointerId;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
        this.panRemainderX = 0;
        this.panRemainderY = 0;

        if (mode === "draw") {
            const tool = this.tool === "highlighter" ? "highlighter" : "pen";
            this.liveStroke = createStroke({
                tool,
                color: this.color,
                size: tool === "highlighter" ? this.size * 5 : this.size,
                simulatePressure: e.pointerType !== "pen",
                points: [],
                order: this.nextOrder
            });
            this.addLivePoints([ e ]);
            this.drawLiveStroke([]);
        } else if (mode === "erase") {
            this.erased = [];
            this.eraseAlong(e.clientX, e.clientY, e.clientX, e.clientY);
        }
    }

    private onPointerMove(e: PointerEvent) {
        if (e.pointerType === "touch" && this.touches.has(e.pointerId)) {
            this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
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
            this.drawLiveStroke(e.getPredictedEvents?.() ?? []);
        } else if (this.mode === "erase") {
            this.eraseAlong(this.lastX, this.lastY, e.clientX, e.clientY);
        } else if (this.mode === "pan") {
            this.panByClient(e.clientX - this.lastX, e.clientY - this.lastY);
        }
        this.lastX = e.clientX;
        this.lastY = e.clientY;
    }

    private onPointerEnd(e: PointerEvent) {
        this.touches.delete(e.pointerId);

        if (this.mode === "pinch") {
            if (this.touches.size < 2) this.mode = "idle";
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
        this.liveStroke = undefined;
        this.clearLive();
        if (this.erased.length) {
            this.applyHistory(this.erased, []);
            this.erased = [];
        }
        this.mode = "idle";
        this.activePointerId = undefined;
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
            stroke.points.push(x, y, stroke.simulatePressure ? 0.5 : event.pressure);
        }
    }

    private drawLiveStroke(predicted: PointerEvent[]) {
        const stroke = this.liveStroke;
        if (!stroke) return;

        const extra: number[] = [];
        for (const event of predicted) {
            const { x, y } = this.toWorld(event.clientX, event.clientY);
            extra.push(x, y, stroke.simulatePressure ? 0.5 : event.pressure);
        }

        this.clearLive();
        this.applyWorldTransform(this.live);
        this.fillStroke(this.live, stroke, toPath(getStrokeOutline(stroke, extra, false)));
    }

    private commitLiveStroke() {
        const live = this.liveStroke;
        this.liveStroke = undefined;
        this.clearLive();
        if (!live || live.points.length < 3) return;

        const stroke = createStroke(live);
        this.nextOrder++;
        this.strokes.add(stroke);
        this.index.add(stroke);
        this.pushHistory({ added: [ stroke ], removed: [] });

        if (this.fullRedrawFrame === undefined) {
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
        const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
        if (zoom === this.zoom) return;

        const applied = zoom / this.zoom;
        this.tx = Math.round(deviceX - (deviceX - this.tx) * applied);
        this.ty = Math.round(deviceY - (deviceY - this.ty) * applied);
        this.zoom = zoom;
        this.syncPaper();
        this.scheduleFullRedraw();
        this.reportState();
    }

    private panByClient(dx: number, dy: number) {
        const deviceX = dx * this.dpr + this.panRemainderX;
        const deviceY = dy * this.dpr + this.panRemainderY;
        const wholeX = Math.trunc(deviceX);
        const wholeY = Math.trunc(deviceY);
        this.panRemainderX = deviceX - wholeX;
        this.panRemainderY = deviceY - wholeY;
        if (wholeX === 0 && wholeY === 0) return;

        this.tx += wholeX;
        this.ty += wholeY;
        this.syncPaper();

        const { width, height } = this.baseCanvas;
        if (this.fullRedrawFrame !== undefined) return;
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

        for (const canvas of [ this.baseCanvas, this.liveCanvas ]) {
            canvas.width = width;
            canvas.height = height;
        }
        this.syncPaper();
        this.redrawAll();
    }

    /** Positions the paper pattern, which is a CSS background of the container. */
    private syncPaper() {
        const { style, dataset } = this.container;
        dataset.paper = this.paper;
        style.setProperty("--ink-zoom", String(this.zoom));
        style.setProperty("--ink-x", `${this.tx / this.dpr}px`);
        style.setProperty("--ink-y", `${this.ty / this.dpr}px`);
    }

    private reportState() {
        this.options.onStateChange({
            zoom: this.zoom,
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

    private scheduleFullRedraw() {
        if (this.fullRedrawFrame !== undefined) return;
        this.fullRedrawFrame = requestAnimationFrame(() => {
            this.fullRedrawFrame = undefined;
            this.redrawAll();
        });
    }

    private redrawAll() {
        this.autoColor = getComputedStyle(this.container).color;
        this.redrawRegion(0, 0, this.baseCanvas.width, this.baseCanvas.height);
    }

    private redrawBounds(bounds: Bounds) {
        if (this.fullRedrawFrame !== undefined) return;

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
        ctx.clearRect(x, y, width, height);
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

    private applyWorldTransform(ctx: CanvasRenderingContext2D) {
        const scale = this.zoom * this.dpr;
        ctx.setTransform(scale, 0, 0, scale, this.tx, this.ty);
    }

    private fillStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, path?: Path2D) {
        if (!path) {
            stroke.path ??= toPath(getStrokeOutline(stroke));
            path = stroke.path;
        }
        ctx.globalAlpha = stroke.tool === "highlighter" ? HIGHLIGHTER_ALPHA : 1;
        ctx.fillStyle = stroke.color === AUTO_COLOR ? this.autoColor : stroke.color;
        ctx.fill(path);
        ctx.globalAlpha = 1;
    }

    private clearLive() {
        this.live.setTransform(1, 0, 0, 1, 0, 0);
        this.live.clearRect(0, 0, this.liveCanvas.width, this.liveCanvas.height);
    }

    private createCanvas() {
        const canvas = document.createElement("canvas");
        this.container.append(canvas);
        return canvas;
    }

    //#endregion
}

function getContext(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
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
