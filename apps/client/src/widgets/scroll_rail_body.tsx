import { TAB_CHANGE_EVENT } from "@triliumnext/ckeditor5/src/plugins/tabs/constants.js";
import type { RefObject } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";

import { useChartTooltip } from "./react/charts/chart_tooltip";
import { useWhenShown } from "./react/hooks/dom";
import { useColorScheme } from "./react/hooks/options";
import {
    getPickDistance, type PublishedLayer, type RailHit, type RailLines, SCROLL_RAIL_KINDS,
    type ScrollRailBar, type ScrollRailColorPreset, type ScrollRailKind
} from "./scroll_rail";
import {
    drawRows, findRow, getMarkerHue, goToTarget, RANGE_MEASURE_LIMIT, type RowSet,
    SCROLL_RAIL_MEASURE_EVENT, type ScrollRailLayer, ScrollRailLocator, type ScrollRailTarget,
    toRows
} from "./scroll_rail_markers";

/**
 * Delay of a read after the last size signal, content change, measure event or `refreshLater()`,
 * in ms.
 */
export const READ_DELAY = 150;

interface ScrollRailLinesProps {
    bar: ScrollRailBar;
    layers: PublishedLayer[];
    railRef: RefObject<HTMLElement | null>;
    canvasRef: RefObject<HTMLCanvasElement | null>;
    /** Whether the rail is rendered, with the canvas in it. */
    isRailShown: boolean;
    /** Called with whether a line has a place, which shows the rail on a note that fits. */
    onLines(hasLines: boolean): void;
}

/**
 * The lines of the markers on the scroll rail, once a layer is published: measures the targets of
 * the layers, draws their lines on the bar's canvas, handles the presses the bar passes on, and
 * shows the tooltip of the line under the pointer.
 */
export default function ScrollRailLines({
    bar, layers, railRef, canvasRef, isRailShown, onLines
}: ScrollRailLinesProps) {
    const scrollerRef = useRef<HTMLElement | null>(bar.scroller);
    const [ controller, setController ] = useState<RailController | null>(null);
    const colorScheme = useColorScheme();
    const whenShown = useWhenShown(scrollerRef);
    const { showTooltip, hideTooltip, tooltipNode } = useChartTooltip<HTMLDivElement>();

    useLayoutEffect(() => {
        const created = new RailController(bar, { onLines, whenShown });
        setController(created);
        return () => {
            created.destroy();
            onLines(false);
        };
    }, [ bar, onLines, whenShown ]);

    useLayoutEffect(() => {
        controller?.setLayers(layers);
    }, [ controller, layers ]);

    useLayoutEffect(() => {
        const rail = isRailShown ? railRef.current : null;
        controller?.attach(rail ? canvasRef.current : null);
        if (!controller || !rail) return;

        const onPointerMove = (event: PointerEvent) => {
            if (bar.isPressed) return;
            const y = event.clientY - rail.getBoundingClientRect().top;
            const hit = controller.hitTest(y, getPickDistance(event));
            rail.classList.toggle("is-over-line", !!hit?.isCurrent);
            const tooltip = hit?.isCurrent ? hit.layer.source.getTooltip?.(hit.marker) : undefined;
            if (tooltip) {
                showTooltip(tooltip, event);
            } else {
                hideTooltip();
            }
        };
        const onPointerLeave = () => {
            rail.classList.remove("is-over-line");
            hideTooltip();
        };
        rail.addEventListener("pointermove", onPointerMove);
        rail.addEventListener("pointerleave", onPointerLeave);
        return () => {
            rail.removeEventListener("pointermove", onPointerMove);
            rail.removeEventListener("pointerleave", onPointerLeave);
            onPointerLeave();
        };
        // `showTooltip` and `hideTooltip` only set the tooltip's state.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ bar, controller, isRailShown, colorScheme ]);

    return <>{tooltipNode}</>;
}

/** A published layer and the lines of its last read. */
interface LayerState {
    kind: ScrollRailKind;
    layer: ScrollRailLayer;
    unsubscribe: () => void;
    /** The targets of the last read, and the generation of the layer they were read at. */
    targets: ScrollRailTarget[];
    generation: number;
    /** The colors of each target, for a source that gives them. */
    colors: string[][] | undefined;
    places: (number | null)[];
    rows: RowSet;
}

interface RailControllerOptions {
    onLines(hasLines: boolean): void;
    /** Runs `callback` at once while the scroller shows, else once it shows again. */
    whenShown(callback: () => void): void;
}

/** The colors of a kind, as the theme sets them now. */
interface KindColors {
    color: string;
    emphasisColor: string;
    /** The color that a marker's own color `color` is drawn in. */
    toDrawn(color: string): string;
}

const NO_ROWS: RowSet = { rows: [], markerRows: [] };

/**
 * Reads the targets of the layers of a scroller and draws their lines on the track of `bar`. A
 * read runs after the next paint for `refresh()`, a published layer and a tab change,
 * and 150 ms after the last size signal of the bar, {@link SCROLL_RAIL_MEASURE_EVENT},
 * `refreshLater()` or scroll, and for some kinds the last content change; never while the scroller
 * is hidden.
 */
export class RailController implements RailLines {

    private readonly scroller: HTMLElement;
    private readonly states = new Map<string, LayerState>();
    private readonly afterPaint = new Set<string>();
    private readonly later = new Set<string>();
    private readonly waiting = new Set<string>();
    private frame: number | null = null;
    private paintTask: ReturnType<typeof setTimeout> | null = null;
    private laterTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly unsubscribe: () => void;
    private readonly onTabChange = () => this.requestAfterPaint(this.states.keys());
    private readonly onMeasure = () => this.requestLater(this.states.keys());
    /** Delays a pending read while the note scrolls: a read of many targets takes tens of ms. */
    private readonly onScroll = () => {
        if (this.laterTimer !== null) this.startLaterTimer();
    };
    private canvas: HTMLCanvasElement | null = null;
    private colors = new Map<string, KindColors>();

    constructor(
        private readonly bar: ScrollRailBar,
        private readonly options: RailControllerOptions
    ) {
        this.scroller = bar.scroller;
        this.unsubscribe = bar.subscribe((change) => {
            if (change === "content") {
                this.onContentChange();
                return;
            }
            this.mapRows();
            this.requestLater(this.states.keys());
        });
        this.scroller.addEventListener(TAB_CHANGE_EVENT, this.onTabChange);
        this.scroller.addEventListener(SCROLL_RAIL_MEASURE_EVENT, this.onMeasure);
        this.scroller.addEventListener("scroll", this.onScroll, { passive: true });
        bar.setLines(this);
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
                colors: undefined,
                places: [],
                rows: NO_ROWS
            });
            this.requestAfterPaint([ kind.key ]);
        }
        this.update();
    }

    /** Draws on `canvas` from now on, resolving the colors of the layers again; `null` stops. */
    attach(canvas: HTMLCanvasElement | null) {
        this.canvas = canvas;
        this.colors.clear();
        this.draw();
    }

    /** The line at `y` px down the track, within `distance`, or `null`. */
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
            isCurrent: this.isCurrent(state),
            generation: state.layer.generation
        };
    }

    /**
     * Acts on a press on a line, as things are at its release. A line of a layer no longer
     * published does nothing. A line that was current, on a layer still at the same generation,
     * calls the owner's `onClick()`. Any other line, or a click the owner declines, jumps to the
     * line's own target.
     */
    click(hit: RailHit) {
        const isPublished = [ ...this.states.values() ].some((state) => state.layer === hit.layer);
        if (!isPublished) return;

        const isStillCurrent = hit.isCurrent && hit.layer.generation === hit.generation;
        if (isStillCurrent && hit.layer.source.onClick) {
            if (hit.layer.source.onClick(hit.marker) !== false) return;
        }
        goToTarget(hit.target, this.scroller);
    }

    destroy() {
        for (const key of [ ...this.states.keys() ]) {
            this.dropLayer(key);
        }
        this.unsubscribe();
        if (this.bar.lines === this) {
            this.bar.setLines(null);
        }
        this.scroller.removeEventListener(TAB_CHANGE_EVENT, this.onTabChange);
        this.scroller.removeEventListener(SCROLL_RAIL_MEASURE_EVENT, this.onMeasure);
        this.scroller.removeEventListener("scroll", this.onScroll);
        if (this.frame !== null) cancelAnimationFrame(this.frame);
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

    /** Requests a read of the layers whose kind has `isReadOnContentChange`. */
    private onContentChange() {
        const keys = [ ...this.states.values() ]
            .filter(({ kind }) => kind.isReadOnContentChange)
            .map(({ kind }) => kind.key);
        if (keys.length) {
            this.requestLater(keys);
        }
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

    /** Reads `keys` once no such request and no scroll has come for {@link READ_DELAY} ms. */
    private requestLater(keys: Iterable<string>) {
        for (const key of keys) {
            this.later.add(key);
        }
        this.startLaterTimer();
    }

    private startLaterTimer() {
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

        this.bar.check();
        for (const key of keys) {
            const state = this.states.get(key);
            if (!state) continue;

            if (!state.layer.isPaused) {
                const { source } = state.layer;
                const getColors = source.getColors?.bind(source);
                state.targets = source.readTargets();
                state.generation = state.layer.generation;
                state.colors = getColors && state.targets.map((_, index) => getColors(index));
            }
            const locator = new ScrollRailLocator(this.scroller,
                state.targets.length > RANGE_MEASURE_LIMIT);
            state.places = state.targets.map((target) => locator.locate(target));
            state.rows = toRows(state.places, this.bar.metrics);
        }
        this.update();
    }

    /** Maps the places of every layer to rows of the bar's track as it is now. */
    private mapRows() {
        for (const state of this.states.values()) {
            state.rows = toRows(state.places, this.bar.metrics);
        }
        this.update();
    }

    private update() {
        const states = [ ...this.states.values() ];
        this.options.onLines(states.some(({ rows }) => rows.rows.length > 0));
        this.draw();
    }

    private draw() {
        const canvas = this.canvas;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;

        const ratio = window.devicePixelRatio || 1;
        const width = canvas.parentElement?.clientWidth ?? 0;
        const height = this.bar.metrics.railHeight;
        const deviceWidth = Math.round(width * ratio);
        const deviceHeight = Math.round(height * ratio);
        if (canvas.width !== deviceWidth || canvas.height !== deviceHeight) {
            canvas.width = deviceWidth;
            canvas.height = deviceHeight;
        }
        drawRows(context, { width, height, ratio }, this.getOrderedStates().map((state) => {
            const { color, emphasisColor, toDrawn } = this.getColors(state.kind, canvas);
            return {
                rows: state.rows,
                emphasized: this.getEmphasized(state),
                opacity: state.kind.opacity,
                colors: state.colors?.map((colors) => colors.map(toDrawn)),
                color,
                emphasisColor
            };
        }));
    }

    private getColors(kind: ScrollRailKind, probe: HTMLElement) {
        let colors = this.colors.get(kind.key);
        if (!colors) {
            const color = resolveColor(probe, `var(${kind.color})`);
            colors = {
                color,
                emphasisColor: kind.emphasisColor
                    ? resolveColor(probe, `var(${kind.emphasisColor})`)
                    : color,
                toDrawn: kind.colorPreset
                    ? getColorCorrection(probe, kind.colorPreset)
                    : (given) => given
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

/**
 * The color that a marker's own color is drawn in under `preset`, for `probe`: its hue at the
 * theme's saturation and lightness, or the theme's gray for a gray. While the theme sets no
 * saturation or lightness, the color as given.
 */
function getColorCorrection(
    probe: HTMLElement,
    { saturation, lightness, grayColor }: ScrollRailColorPreset
) {
    const style = getComputedStyle(probe);
    if (!style.getPropertyValue(saturation).trim() || !style.getPropertyValue(lightness).trim()) {
        return (color: string) => color;
    }

    const gray = resolveColor(probe, `var(${grayColor})`);
    const drawn = new Map<string, string>();
    return (color: string) => {
        let corrected = drawn.get(color);
        if (corrected === undefined) {
            const hue = getMarkerHue(color);
            corrected = hue === null
                ? gray
                : resolveColor(probe, `hsl(${hue}deg var(${saturation}) var(${lightness}))`);
            drawn.set(color, corrected);
        }
        return corrected;
    };
}

/** The computed value of the CSS color `value` for `element`, in a form that a canvas takes. */
function resolveColor(element: HTMLElement, value: string) {
    element.style.color = value;
    const color = getComputedStyle(element).color;
    element.style.removeProperty("color");
    return color;
}
