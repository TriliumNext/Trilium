import { lineToPoints } from "@triliumnext/commons/src/lib/handwriting.js";

import {
    AUTO_COLOR, createStroke, getShortStrokeOutline, getStrokeOutline, HIGHLIGHTER_ALPHA, outlineStrokePoints,
    outlineToPath, type Stroke, StrokeBuilder, trimPrediction
} from "./ink_document";
import { recognizeLine, shapeToPoints } from "./ink_shapes";

/** What `LiveStroke` reads from the surface it draws on. */
export interface LiveStrokeHost {
    /** The world position of a point in client coordinates. */
    toWorld(clientX: number, clientY: number): { x: number, y: number };
    getZoom(): number;
    /** Sets `ctx` to draw in world units in the current view. */
    applyWorldTransform(ctx: CanvasRenderingContext2D): void;
    /** The device pixels per world unit, and the device position of the world origin. */
    getWorldTransform(): { scale: number, x: number, y: number };
    /** The color of a stroke of `AUTO_COLOR`. */
    getAutoColor(): string;
}

/** A stroke that `LiveStroke.finish()` ends, and the stroke as it was drawn if a hold made a shape of it. */
export interface FinishedStroke {
    stroke: Stroke;
    drawn: Stroke | undefined;
}

/** How long the pointer rests at the end of a stroke, and how far it can move, to make a shape of it. */
const HOLD_TIME = 500;
const HOLD_SLOP = 5;
/** The shortest line and the shortest side of a shape that a hold makes, in CSS pixels. */
const MIN_SHAPE_SIZE = 20;
/** How many stroke points of the stroke being drawn are fixed onto `settledCanvas` at a time. */
const SETTLE_CHUNK = 48;
/**
 * How many stroke points before the end of a settled run the outline drawn after it starts from.
 * The outline of a point depends on its neighbors, so the runs overlap where theirs differ.
 */
const SETTLE_OVERLAP = 8;
/** The room left around the end of the stroke when `liveCanvas` is placed over it, in CSS pixels. */
const LIVE_CANVAS_MARGIN = 128;

/**
 * The stroke being drawn, on two canvases above the finished strokes: `settledCanvas` holds the
 * part of the stroke that further points no longer change, and `liveCanvas` its end, drawn again
 * on each animation frame. The cost of a frame therefore does not grow with the length of the
 * stroke. `liveCanvas` covers only the end of the stroke and moves with it: the browser composites
 * the whole of a canvas that changes, which at the size of the surface takes longer than a frame on
 * a large screen. A pointer that rests at the end of a stroke makes a line or another shape of it.
 */
export default class LiveStroke {

    private layer: HTMLDivElement;
    private settledCanvas: HTMLCanvasElement;
    private liveCanvas: HTMLCanvasElement;
    private settled: CanvasRenderingContext2D;
    private live: CanvasRenderingContext2D;
    /** The size of the surface, in device pixels. */
    private surfaceWidth = 0;
    private surfaceHeight = 0;
    /** Where `liveCanvas` lies on the surface, in device pixels. */
    private liveRect: DeviceRect = { x: 0, y: 0, width: 0, height: 0 };

    private stroke: Stroke | undefined;
    private builder: StrokeBuilder | undefined;
    /** The index of the stroke point up to which the stroke is on `settledCanvas`. */
    private settledUpTo = 0;
    /** Raw `x, y, pressure` triples of the input that the browser predicts after the last move. */
    private predicted: number[] = [];
    private frame: number | undefined;
    private holdTimer: ReturnType<typeof setTimeout> | undefined;
    /** Where the pointer was when `holdTimer` started, in client coordinates. */
    private holdX = 0;
    private holdY = 0;
    /**
     * Set once a hold has made a shape of the stroke: the stroke as it was drawn and, for a
     * straight line, its start and its pressure.
     */
    private snapped: { drawn: Stroke, line?: { fromX: number, fromY: number, pressure: number } } | undefined;

    constructor(container: HTMLElement, private host: LiveStrokeHost) {
        this.layer = document.createElement("div");
        this.layer.className = "handwriting-live-layer";
        container.append(this.layer);
        this.settledCanvas = createCanvas(this.layer);
        this.liveCanvas = createCanvas(this.layer);
        this.settled = getContext(this.settledCanvas);
        this.live = getContext(this.liveCanvas);
    }

    destroy() {
        if (this.frame !== undefined) cancelAnimationFrame(this.frame);
        clearTimeout(this.holdTimer);
        this.layer.remove();
    }

    /** Whether a stroke is being drawn. */
    get active() {
        return this.stroke !== undefined;
    }

    /** Sizes the canvases to the surface, in device pixels. */
    resize(width: number, height: number) {
        this.settledCanvas.width = width;
        this.settledCanvas.height = height;
        this.surfaceWidth = width;
        this.surfaceHeight = height;
        this.placeLiveCanvas({ x: 0, y: 0, width: 0, height: 0 });
    }

    start(e: PointerEvent, stroke: Pick<Stroke, "tool" | "color" | "size" | "order" | "sensitivity">) {
        this.stroke = createStroke({ ...stroke, simulatePressure: e.pointerType !== "pen", points: [] });
        this.builder = new StrokeBuilder(this.stroke);
        this.settledUpTo = 0;
        this.predicted = [];
        this.layer.style.opacity = stroke.tool === "highlighter" ? String(HIGHLIGHTER_ALPHA) : "";
        this.addPoints([ e ]);
        this.watchHold(e);
        this.scheduleFrame();
    }

    /** Follows a move of the pointer, which was last at `(lastX, lastY)` in client coordinates. */
    move(e: PointerEvent, lastX: number, lastY: number) {
        const stroke = this.stroke;
        if (!stroke) return;
        if (this.snapped?.line) {
            const { fromX, fromY, pressure } = this.snapped.line;
            const { x, y } = this.host.toWorld(e.clientX, e.clientY);
            stroke.points = lineToPoints({ fromX, fromY, toX: x, toY: y }, pressure);
        } else if (!this.snapped) {
            const events = e.getCoalescedEvents?.() ?? [];
            this.addPoints(events.length ? events : [ e ]);
            const predicted: number[] = [];
            for (const event of e.getPredictedEvents?.() ?? []) {
                const { x, y } = this.host.toWorld(event.clientX, event.clientY);
                predicted.push(x, y, stroke.simulatePressure ? 0.5 : event.pressure);
            }
            const from = this.host.toWorld(lastX, lastY);
            const to = this.host.toWorld(e.clientX, e.clientY);
            this.predicted = trimPrediction(from.x, from.y, to.x, to.y, predicted);
            this.watchHold(e);
        }
        this.scheduleFrame();
    }

    /** Ends the stroke and returns it, unless it has too few points to keep. */
    finish(): FinishedStroke | undefined {
        const stroke = this.stroke;
        const drawn = this.snapped?.drawn;
        this.cancel();
        if (!stroke || stroke.points.length < 3) return undefined;
        return { stroke, drawn };
    }

    /** Ends the stroke and clears it. */
    cancel() {
        if (this.frame !== undefined) cancelAnimationFrame(this.frame);
        this.frame = undefined;
        clearTimeout(this.holdTimer);
        this.holdTimer = undefined;
        this.snapped = undefined;
        this.stroke = undefined;
        this.builder = undefined;
        this.predicted = [];
        clearCanvas(this.settled, this.settledCanvas);
        clearCanvas(this.live, this.liveCanvas);
    }

    /** Draws the stroke again from its start, after the view moved under it. */
    redraw() {
        if (!this.stroke) return;
        clearCanvas(this.settled, this.settledCanvas);
        this.settledUpTo = 0;
        this.scheduleFrame();
    }

    private addPoints(events: PointerEvent[]) {
        const stroke = this.stroke;
        if (!stroke) return;

        const minDistance = 0.5 / this.host.getZoom();
        for (const event of events) {
            const { x, y } = this.host.toWorld(event.clientX, event.clientY);
            const length = stroke.points.length;
            if (length >= 3
                && Math.hypot(x - stroke.points[length - 3], y - stroke.points[length - 2]) < minDistance) {
                continue;
            }
            const pressure = stroke.simulatePressure ? 0.5 : event.pressure;
            stroke.points.push(x, y, pressure);
            this.builder?.add(x, y, pressure);
        }
    }

    /** Waits for a hold again once the pointer has left the place where the last wait started. */
    private watchHold(e: PointerEvent) {
        if (this.holdTimer !== undefined
            && Math.hypot(e.clientX - this.holdX, e.clientY - this.holdY) <= HOLD_SLOP) {
            return;
        }
        this.holdX = e.clientX;
        this.holdY = e.clientY;
        clearTimeout(this.holdTimer);
        this.holdTimer = setTimeout(() => this.snap(), HOLD_TIME);
    }

    /**
     * Makes a straight line or another shape of the stroke when it was drawn as one. The shape has
     * one width, from the mean pressure of the stroke. The end of a line then follows the pointer.
     */
    private snap() {
        const stroke = this.stroke;
        if (!stroke || this.snapped) return;
        const minSize = MIN_SHAPE_SIZE / this.host.getZoom();
        const line = recognizeLine(stroke.points, minSize);
        const strokePoints = this.builder?.points ?? [];
        let pressure = 0.5;
        if (strokePoints.length) {
            pressure = 0;
            for (const point of strokePoints) {
                pressure += point.pressure / strokePoints.length;
            }
        }
        const points = line
            ? lineToPoints(line, pressure)
            : shapeToPoints(stroke.points, minSize, pressure);
        if (!points) return;
        this.snapped = { drawn: stroke, line: line && { fromX: line.fromX, fromY: line.fromY, pressure } };
        this.stroke = { ...stroke, simulatePressure: false, points };
        this.predicted = [];
        this.redraw();
    }

    private scheduleFrame() {
        if (this.frame !== undefined) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = undefined;
            this.draw();
        });
    }

    /** Settles the stroke points that the next ones can no longer change and draws the rest. */
    private draw() {
        const stroke = this.stroke;
        const builder = this.builder;
        if (!stroke || !builder) return;

        if (this.snapped) {
            this.drawLive(stroke, getStrokeOutline(stroke));
            return;
        }
        if (stroke.points.length <= 6) {
            this.drawLive(stroke, getShortStrokeOutline(stroke));
            return;
        }

        const { points } = builder;
        if (points.length - SETTLE_OVERLAP - this.settledUpTo >= SETTLE_CHUNK) {
            this.host.applyWorldTransform(this.settled);
            while (points.length - SETTLE_OVERLAP - this.settledUpTo >= SETTLE_CHUNK) {
                const end = this.settledUpTo + SETTLE_CHUNK;
                const run = points.slice(Math.max(0, this.settledUpTo - SETTLE_OVERLAP), end + 1);
                this.fill(this.settled, stroke, outlineStrokePoints(stroke, run));
                this.settledUpTo = end;
            }
        }

        const tail = points.slice(Math.max(0, this.settledUpTo - SETTLE_OVERLAP));
        tail.push(...builder.preview(this.predicted));
        this.drawLive(stroke, outlineStrokePoints(stroke, tail));
    }

    /** Draws `outline` alone on `liveCanvas`, first moving the canvas over it if it lies outside. */
    private drawLive(stroke: Stroke, outline: number[][]) {
        const world = this.host.getWorldTransform();
        const needed = getDeviceBounds(outline, world);
        const rect = this.liveRect;
        if (needed && (needed.x < rect.x || needed.y < rect.y
            || needed.x + needed.width > rect.x + rect.width || needed.y + needed.height > rect.y + rect.height)) {
            const margin = LIVE_CANVAS_MARGIN * (window.devicePixelRatio || 1);
            const left = Math.max(0, needed.x - margin);
            const top = Math.max(0, needed.y - margin);
            this.placeLiveCanvas({
                x: left,
                y: top,
                width: Math.max(0, Math.min(this.surfaceWidth, needed.x + needed.width + margin) - left),
                height: Math.max(0, Math.min(this.surfaceHeight, needed.y + needed.height + margin) - top)
            });
        }
        clearCanvas(this.live, this.liveCanvas);
        this.live.setTransform(world.scale, 0, 0, world.scale, world.x - this.liveRect.x, world.y - this.liveRect.y);
        this.fill(this.live, stroke, outline);
    }

    /** Moves and sizes `liveCanvas` to `rect` of the surface, in device pixels, which clears it. */
    private placeLiveCanvas(rect: DeviceRect) {
        this.liveRect = rect;
        this.liveCanvas.width = rect.width;
        this.liveCanvas.height = rect.height;
        const dpr = window.devicePixelRatio || 1;
        Object.assign(this.liveCanvas.style, {
            left: `${rect.x / dpr}px`,
            top: `${rect.y / dpr}px`,
            width: `${rect.width / dpr}px`,
            height: `${rect.height / dpr}px`
        });
    }

    /**
     * Fills a part of the stroke. The parts overlap, so they are filled opaque and `layer` takes
     * the highlighter's transparency.
     */
    private fill(ctx: CanvasRenderingContext2D, stroke: Stroke, outline: number[][]) {
        ctx.fillStyle = stroke.color === AUTO_COLOR ? this.host.getAutoColor() : stroke.color;
        ctx.fill(outlineToPath(outline));
    }
}

/** A rectangle of the surface in whole device pixels. */
interface DeviceRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** The whole device pixels that `outline`, in world units, covers in the view `world`. */
function getDeviceBounds(
    outline: number[][], world: { scale: number, x: number, y: number }
): DeviceRect | undefined {
    let [ minX, minY, maxX, maxY ] = [ Infinity, Infinity, -Infinity, -Infinity ];
    for (const [ x, y ] of outline) {
        const deviceX = world.scale * x + world.x;
        const deviceY = world.scale * y + world.y;
        minX = Math.min(minX, deviceX);
        minY = Math.min(minY, deviceY);
        maxX = Math.max(maxX, deviceX);
        maxY = Math.max(maxY, deviceY);
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return undefined;
    // The path curves through the midpoints of the outline, never past its points; a pixel of
    // room covers the antialiased edge.
    const x = Math.floor(minX) - 1;
    const y = Math.floor(minY) - 1;
    return { x, y, width: Math.ceil(maxX) + 1 - x, height: Math.ceil(maxY) + 1 - y };
}

export function createCanvas(parent: HTMLElement) {
    const canvas = document.createElement("canvas");
    parent.append(canvas);
    return canvas;
}

export function getContext(canvas: HTMLCanvasElement, settings?: CanvasRenderingContext2DSettings) {
    const ctx = canvas.getContext("2d", settings);
    if (!ctx) throw new Error("The 2D canvas context is not available.");
    return ctx;
}

function clearCanvas(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
}
