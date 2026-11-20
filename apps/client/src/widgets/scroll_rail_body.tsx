import "./scroll_rail.css";

import { TAB_CHANGE_EVENT } from "@triliumnext/ckeditor5/src/plugins/tabs/constants.js";
import type { RefObject } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

import { useChartTooltip } from "./react/charts/chart_tooltip";
import { useWhenShown } from "./react/hooks/dom";
import { useColorScheme } from "./react/hooks/options";
import { type PublishedLayer, SCROLL_RAIL_KINDS, type ScrollRailKind } from "./scroll_rail";
import {
    drawRows, findRow, getViewportBox, goToTarget, RANGE_MEASURE_LIMIT, type RailMetrics,
    type RowSet, type ScrollRailLayer, ScrollRailLocator, type ScrollRailTarget, toRows, toScrollTop
} from "./scroll_rail_markers";

/** Delay of a read after the last size signal or `refreshLater()`, in ms. */
export const READ_DELAY = 150;
/** How far from a line a press or a hover still picks it, in CSS px. */
const PICK_DISTANCE = { mouse: 3, touch: 8 };
/** How far the pointer moves before a press becomes a drag, in CSS px. */
const DRAG_THRESHOLD = 3;

interface ScrollRailBodyProps {
    /** The root of `ScrollRail`, whose parent is the scroller. */
    hostRef: RefObject<HTMLElement | null>;
    layers: PublishedLayer[];
}

/** What the rail renders: the rail while a line has a place, the box while the note overflows. */
interface RailView {
    hasLines: boolean;
    isOverflowing: boolean;
}

/** A press on the rail, until it is released. */
interface Press {
    pointerId: number;
    startY: number;
    hit: RailHit | null;
    /** The distance from the top of the box to the pointer while dragging, `null` without a box. */
    grab: number | null;
    isOnBox: boolean;
    isDragging: boolean;
}

/**
 * The scroll rail of a split once a layer is published: measures the targets of the layers, draws
 * their lines and the viewport box, and handles the pointer.
 */
export default function ScrollRailBody({ hostRef, layers }: ScrollRailBodyProps) {
    const railRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const boxRef = useRef<HTMLDivElement>(null);
    const scrollerRef = useRef<HTMLElement | null>(null);
    const pressRef = useRef<Press | null>(null);
    const [ controller, setController ] = useState<RailController | null>(null);
    const [ view, setView ] = useState<RailView>({ hasLines: false, isOverflowing: false });
    const colorScheme = useColorScheme();
    const whenShown = useWhenShown(scrollerRef);
    const { showTooltip, hideTooltip, tooltipNode } = useChartTooltip<HTMLDivElement>();

    useLayoutEffect(() => {
        const host = hostRef.current;
        const scroller = host?.parentElement;
        if (!host || !scroller) return;

        scrollerRef.current = scroller;
        const created = new RailController(host, scroller, {
            onView: (next) => setView((previous) => (
                previous.hasLines === next.hasLines && previous.isOverflowing === next.isOverflowing
                    ? previous
                    : next)),
            whenShown
        });
        setController(created);
        return () => created.destroy();
    }, [ hostRef, whenShown ]);

    useLayoutEffect(() => {
        controller?.setLayers(layers);
    }, [ controller, layers ]);

    useLayoutEffect(() => {
        controller?.attach(view.hasLines ? {
            rail: railRef.current,
            canvas: canvasRef.current,
            box: boxRef.current
        } : null);
    }, [ controller, view.hasLines, view.isOverflowing, colorScheme ]);

    if (!view.hasLines) return null;

    const pickDistance = (event: PointerEvent) =>
        (event.pointerType === "touch" ? PICK_DISTANCE.touch : PICK_DISTANCE.mouse);
    const toRailY = (event: PointerEvent) =>
        event.clientY - (railRef.current?.getBoundingClientRect().top ?? 0);

    const onPointerDown = (event: PointerEvent) => {
        event.preventDefault();
        if (!controller || event.button !== 0) return;

        const y = toRailY(event);
        const box = controller.getBox();
        const isOnBox = !!box && y >= box.top && y <= box.top + box.height;
        pressRef.current = {
            pointerId: event.pointerId,
            startY: y,
            hit: controller.hitTest(y, pickDistance(event)),
            grab: box ? (isOnBox ? y - box.top : box.height / 2) : null,
            isOnBox,
            isDragging: false
        };
    };

    const onPointerMove = (event: PointerEvent) => {
        if (!controller) return;
        const y = toRailY(event);
        const press = pressRef.current;
        if (press && press.pointerId === event.pointerId) {
            if (!press.isDragging && press.grab !== null
                && Math.abs(y - press.startY) > DRAG_THRESHOLD) {
                press.isDragging = true;
                railRef.current?.setPointerCapture?.(event.pointerId);
                railRef.current?.classList.remove("is-over-line");
                hideTooltip();
            }
            if (press.isDragging && press.grab !== null) {
                controller.scrollToBoxTop(y - press.grab);
            }
            return;
        }

        const hit = controller.hitTest(y, pickDistance(event));
        const isOverLine = !!hit?.isCurrent;
        railRef.current?.classList.toggle("is-over-line", isOverLine);
        const tooltip = hit?.isCurrent ? hit.layer.source.getTooltip?.(hit.marker) : undefined;
        if (tooltip) {
            showTooltip(tooltip, event);
        } else {
            hideTooltip();
        }
    };

    const onPointerUp = (event: PointerEvent) => {
        const press = pressRef.current;
        if (!controller || !press || press.pointerId !== event.pointerId) return;

        pressRef.current = null;
        railRef.current?.releasePointerCapture?.(event.pointerId);
        if (press.isDragging) return;
        if (press.hit) {
            controller.click(press.hit);
        } else if (press.grab !== null && !press.isOnBox) {
            controller.scrollToBoxTop(press.startY - press.grab);
        }
    };

    const onPointerLeave = () => {
        if (pressRef.current?.isDragging) return;
        railRef.current?.classList.remove("is-over-line");
        hideTooltip();
    };

    return (
        <>
            <div
                ref={railRef}
                className="scroll-rail"
                aria-hidden="true"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => {
                    pressRef.current = null;
                }}
                onPointerLeave={onPointerLeave}
            >
                <canvas ref={canvasRef} />
                {view.isOverflowing && <div ref={boxRef} className="scroll-rail-viewport" />}
            </div>
            {tooltipNode}
        </>
    );
}

/**
 * A line under the pointer: its layer, its marker, and whether it is of the layer's current read.
 */
export interface RailHit {
    layer: ScrollRailLayer;
    marker: number;
    target: ScrollRailTarget;
    isCurrent: boolean;
}

/** A published layer and the lines of its last read. */
interface LayerState {
    kind: ScrollRailKind;
    layer: ScrollRailLayer;
    unsubscribe: () => void;
    /** The targets of the last read, and the generation of the layer they were read at. */
    targets: ScrollRailTarget[];
    generation: number;
    places: (number | null)[];
    rows: RowSet;
}

/** The elements of the rendered rail. The box exists only while the note overflows. */
interface RailParts {
    rail: HTMLElement | null;
    canvas: HTMLCanvasElement | null;
    box: HTMLElement | null;
}

interface RailControllerOptions {
    onView(view: RailView): void;
    /** Runs `callback` at once while the scroller shows, else once it shows again. */
    whenShown(callback: () => void): void;
}

const NO_ROWS: RowSet = { rows: [], markerRows: [] };

/**
 * Reads the targets of the layers of a scroller and draws their lines. A read runs after the next
 * paint for `refresh()`, a published layer and a tab change, and 150 ms after the last size signal
 * or `refreshLater()`; never while the scroller is hidden.
 */
export class RailController {

    private readonly states = new Map<string, LayerState>();
    private readonly afterPaint = new Set<string>();
    private readonly later = new Set<string>();
    private readonly waiting = new Set<string>();
    private frame: number | null = null;
    private paintTask: ReturnType<typeof setTimeout> | null = null;
    private laterTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly resizeObserver: ResizeObserver;
    private readonly onTabChange = () => this.requestAfterPaint(this.states.keys());
    private readonly onScroll = () => {
        this.boxFrame ??= requestAnimationFrame(() => {
            this.boxFrame = null;
            this.placeBox();
        });
    };
    private parts: RailParts | null = null;
    private boxFrame: number | null = null;
    private colors = new Map<string, { color: string; emphasisColor: string }>();
    metrics: RailMetrics = { railHeight: 0, clientHeight: 0, scrollHeight: 0 };

    constructor(
        private readonly host: HTMLElement,
        readonly scroller: HTMLElement,
        private readonly options: RailControllerOptions
    ) {
        this.resizeObserver = new ResizeObserver(() => {
            this.updateMetrics();
            this.requestLater(this.states.keys());
        });
        this.resizeObserver.observe(scroller);
        for (const child of scroller.children) {
            if (child !== host) {
                this.resizeObserver.observe(child);
            }
        }
        scroller.addEventListener(TAB_CHANGE_EVENT, this.onTabChange);
        this.updateMetrics();
    }

    /**
     * Follows `layers`: subscribes to new ones and drops the lines of those no longer published.
     */
    setLayers(layers: PublishedLayer[]) {
        for (const [ key, state ] of this.states) {
            if (!layers.some(({ kind, layer }) => kind.key === key && layer === state.layer)) {
                this.dropLayer(key);
            }
        }
        for (const { kind, layer } of layers) {
            if (this.states.has(kind.key)) continue;
            this.states.set(kind.key, {
                kind,
                layer,
                unsubscribe: layer.subscribe((change) => this.onLayerChange(kind.key, change)),
                targets: [],
                generation: -1,
                places: [],
                rows: NO_ROWS
            });
            this.requestAfterPaint([ kind.key ]);
        }
        this.update();
    }

    /**
     * Draws in `parts` from now on, resolving the colors of the layers again; `null` while the
     * rail is not rendered. Without scroll-driven animations, a scroll listener moves the box.
     */
    attach(parts: RailParts | null) {
        this.parts = parts;
        this.colors.clear();
        const isListening = !!parts?.box && !supportsScrollTimeline();
        this.scroller.removeEventListener("scroll", this.onScroll);
        if (isListening) {
            this.scroller.addEventListener("scroll", this.onScroll, { passive: true });
        }
        this.placeBox();
        this.draw();
    }

    /** The viewport box while the note overflows, else `null`. */
    getBox() {
        const { scrollHeight, clientHeight } = this.metrics;
        return scrollHeight > clientHeight
            ? getViewportBox(this.metrics, this.scroller.scrollTop)
            : null;
    }

    /** Scrolls the note so that the top of the viewport box is at `boxTop`. */
    scrollToBoxTop(boxTop: number) {
        this.scroller.scrollTo({ top: toScrollTop(boxTop, this.metrics), behavior: "instant" });
    }

    /** The line at `y` px down the rail, within `distance`, or `null`. */
    hitTest(y: number, distance: number): RailHit | null {
        const states = this.getOrderedStates();
        const found = findRow(states.map((state) => ({
            rows: state.rows,
            emphasized: this.getEmphasized(state)
        })), y, distance);
        const state = found && states[found.layer];
        if (!found || !state) return null;
        return {
            layer: state.layer,
            marker: found.marker,
            target: state.targets[found.marker] ?? null,
            isCurrent: this.isCurrent(state)
        };
    }

    /** The owner's click on a current line, else the jump to the line's own target. */
    click(hit: RailHit) {
        if (hit.isCurrent && hit.layer.source.onClick) {
            if (hit.layer.source.onClick(hit.marker) !== false) return;
        }
        goToTarget(hit.target, this.scroller);
    }

    destroy() {
        for (const key of [ ...this.states.keys() ]) {
            this.dropLayer(key);
        }
        this.resizeObserver.disconnect();
        this.scroller.removeEventListener(TAB_CHANGE_EVENT, this.onTabChange);
        this.scroller.removeEventListener("scroll", this.onScroll);
        if (this.frame !== null) cancelAnimationFrame(this.frame);
        if (this.boxFrame !== null) cancelAnimationFrame(this.boxFrame);
        if (this.paintTask !== null) clearTimeout(this.paintTask);
        if (this.laterTimer !== null) clearTimeout(this.laterTimer);
    }

    private onLayerChange(key: string, change: string) {
        const state = this.states.get(key);
        if (!state) return;

        if (change === "retire") {
            this.afterPaint.delete(key);
            this.later.delete(key);
            this.waiting.delete(key);
        } else if (change === "refresh") {
            this.requestAfterPaint([ key ]);
        } else if (change === "refreshLater" && !state.layer.isPaused) {
            this.requestLater([ key ]);
        }
        this.draw();
    }

    private dropLayer(key: string) {
        this.states.get(key)?.unsubscribe();
        this.states.delete(key);
        this.afterPaint.delete(key);
        this.later.delete(key);
        this.waiting.delete(key);
    }

    /** Reads `keys` in a task queued from the next animation frame, so after that frame paints. */
    private requestAfterPaint(keys: Iterable<string>) {
        for (const key of keys) {
            this.afterPaint.add(key);
        }
        if (this.frame !== null || this.paintTask !== null || !this.afterPaint.size) return;
        this.frame = requestAnimationFrame(() => {
            this.frame = null;
            this.paintTask = setTimeout(() => {
                this.paintTask = null;
                this.read(this.takeAll(this.afterPaint));
            });
        });
    }

    /** Reads `keys` once no such request has come for {@link READ_DELAY} ms. */
    private requestLater(keys: Iterable<string>) {
        for (const key of keys) {
            this.later.add(key);
        }
        if (this.laterTimer !== null) clearTimeout(this.laterTimer);
        this.laterTimer = setTimeout(() => {
            this.laterTimer = null;
            this.read(this.takeAll(this.later));
        }, READ_DELAY);
    }

    /**
     * Measures the targets of `keys`. A layer that is not paused gives its targets anew, and its
     * lines become current; a paused one keeps the targets of its retired lines.
     */
    private read(keys: string[]) {
        if (!keys.length) return;
        if (this.scroller.isConnected && !this.scroller.checkVisibility()) {
            for (const key of keys) {
                this.waiting.add(key);
            }
            this.options.whenShown(() => this.read(this.takeAll(this.waiting)));
            return;
        }

        this.updateMetrics(false);
        for (const key of keys) {
            const state = this.states.get(key);
            if (!state) continue;

            if (!state.layer.isPaused) {
                state.targets = state.layer.source.readTargets();
                state.generation = state.layer.generation;
            }
            const locator = new ScrollRailLocator(this.scroller,
                state.targets.length > RANGE_MEASURE_LIMIT);
            state.places = state.targets.map((target) => locator.locate(target));
            state.rows = toRows(state.places, this.metrics);
        }
        this.update();
    }

    /** Reads the sizes of the scroller, and writes those of the rail and the box for the CSS. */
    private updateMetrics(isUpdating = true) {
        const { clientHeight, scrollHeight } = this.scroller;
        const metrics = { railHeight: clientHeight, clientHeight, scrollHeight };
        const previous = this.metrics;
        if (previous.railHeight === metrics.railHeight
            && previous.scrollHeight === metrics.scrollHeight) {
            return;
        }

        this.metrics = metrics;
        const box = getViewportBox(metrics, 0);
        this.host.style.setProperty("--scroll-rail-height", `${metrics.railHeight}px`);
        this.host.style.setProperty("--scroll-rail-box-height", `${box.height}px`);
        this.host.style.setProperty("--scroll-rail-box-travel", `${box.travel}px`);
        for (const state of this.states.values()) {
            state.rows = toRows(state.places, metrics);
        }
        this.placeBox();
        if (isUpdating) {
            this.update();
        }
    }

    /** Moves the box to the scroll position, where no scroll timeline moves it. */
    private placeBox() {
        const box = this.parts?.box;
        if (box && !supportsScrollTimeline()) {
            box.style.translate = `0 ${this.getBox()?.top ?? 0}px`;
        }
    }

    private update() {
        const { scrollHeight, clientHeight } = this.metrics;
        this.options.onView({
            hasLines: [ ...this.states.values() ].some((state) => state.rows.rows.length > 0),
            isOverflowing: scrollHeight > clientHeight
        });
        this.draw();
    }

    private draw() {
        const rail = this.parts?.rail;
        const canvas = this.parts?.canvas;
        const context = canvas?.getContext("2d");
        if (!rail || !canvas || !context) return;

        const ratio = window.devicePixelRatio || 1;
        const width = rail.clientWidth;
        const height = this.metrics.railHeight;
        const deviceWidth = Math.round(width * ratio);
        const deviceHeight = Math.round(height * ratio);
        if (canvas.width !== deviceWidth || canvas.height !== deviceHeight) {
            canvas.width = deviceWidth;
            canvas.height = deviceHeight;
        }
        drawRows(context, { width, height, ratio }, this.getOrderedStates().map((state) => ({
            rows: state.rows,
            emphasized: this.getEmphasized(state),
            ...this.getColors(state.kind, canvas)
        })));
    }

    private getColors(kind: ScrollRailKind, probe: HTMLElement) {
        let colors = this.colors.get(kind.key);
        if (!colors) {
            colors = {
                color: resolveColor(probe, kind.color),
                emphasisColor: resolveColor(probe, kind.emphasisColor)
            };
            this.colors.set(kind.key, colors);
        }
        return colors;
    }

    /** The published layers, in drawing order. */
    private getOrderedStates() {
        return SCROLL_RAIL_KINDS.flatMap(({ key }) => this.states.get(key) ?? []);
    }

    private isCurrent(state: LayerState) {
        return state.generation === state.layer.generation;
    }

    /** The marker drawn thicker, which retired lines have none of. */
    private getEmphasized(state: LayerState) {
        return this.isCurrent(state) ? state.layer.emphasized : null;
    }

    private takeAll(keys: Set<string>) {
        const taken = [ ...keys ];
        keys.clear();
        return taken;
    }

}

function supportsScrollTimeline() {
    return typeof CSS !== "undefined" && !!CSS.supports?.("animation-timeline", "scroll()");
}

/** The value of the color variable `name` for `element`, in a form that a canvas takes. */
function resolveColor(element: HTMLElement, name: string) {
    element.style.color = `var(${name})`;
    const color = getComputedStyle(element).color;
    element.style.removeProperty("color");
    return color;
}
