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

/**
 * The stroke being drawn, on two canvases above the finished strokes: `settledCanvas` holds the
 * part of the stroke that further points no longer change, and `liveCanvas` its end, drawn again
 * on each animation frame. The cost of a frame therefore does not grow with the length of the
 * stroke. A pointer that rests at the end of a stroke makes a line or another shape of it.
 */
export default class LiveStroke {

    private layer: HTMLDivElement;
    private settledCanvas: HTMLCanvasElement;
    private liveCanvas: HTMLCanvasElement;
    private settled: CanvasRenderingContext2D;
    private live: CanvasRenderingContext2D;

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

    /** Sizes the canvases, in device pixels. */
    resize(width: number, height: number) {
        for (const canvas of [ this.settledCanvas, this.liveCanvas ]) {
            canvas.width = width;
            canvas.height = height;
        }
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

        clearCanvas(this.live, this.liveCanvas);
        this.host.applyWorldTransform(this.live);
        if (this.snapped) {
            this.fill(this.live, stroke, getStrokeOutline(stroke));
            return;
        }
        if (stroke.points.length <= 6) {
            this.fill(this.live, stroke, getShortStrokeOutline(stroke));
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
        this.fill(this.live, stroke, outlineStrokePoints(stroke, tail));
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
