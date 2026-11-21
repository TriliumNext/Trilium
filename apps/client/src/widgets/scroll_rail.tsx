import "./scroll_rail.css";

import { useLayoutEffect, useRef, useState } from "preact/hooks";

import type NoteContext from "../components/note_context";
import contextMenu from "../menus/context_menu";
import { t } from "../services/i18n";
import { useGetContextDataFrom, useNoteContext } from "./react/hooks/note_context";
import { useColorScheme, useTriliumOptionBool } from "./react/hooks/options";
import { WithLazyModule } from "./react/LazyComponent";
import type { ScrollRailLayer, ScrollRailTarget } from "./scroll_rail_markers";

/** A kind of markers, with the CSS variables of its colors. */
export interface ScrollRailKind {
    key: "scrollRailHighlights" | "scrollRailFind";
    /** The color of a marker whose source gives no colors of its own. */
    color: string;
    /** The color of the emphasized marker, else `color`. */
    emphasisColor?: string;
    /**
     * The saturation and lightness that the markers' own colors are drawn at, keeping their hue,
     * and the color of a gray marker. While the theme sets no saturation or lightness, the colors
     * are drawn as given.
     */
    colorPreset?: ScrollRailColorPreset;
    /** The opacity of the lines, from 0 to 1. Defaults to 1. */
    opacity?: number;
    /** Whether the rail reads the layer again after a change of the note's content. */
    isReadOnContentChange?: boolean;
    /** Whether the rail shows only this layer while it is published. */
    isExclusive?: boolean;
}

/** The CSS variables of a kind's saturation, lightness and gray. */
export interface ScrollRailColorPreset {
    saturation: string;
    lightness: string;
    grayColor: string;
}

/** The kinds of markers, in drawing order. */
export const SCROLL_RAIL_KINDS: readonly ScrollRailKind[] = [
    {
        key: "scrollRailHighlights",
        color: "--main-text-color",
        colorPreset: {
            saturation: "--scroll-rail-highlight-saturation",
            lightness: "--scroll-rail-highlight-lightness",
            grayColor: "--scroll-rail-highlight-gray-color"
        },
        opacity: 0.5,
        isReadOnContentChange: true
    },
    {
        key: "scrollRailFind",
        color: "--scroll-rail-find-color",
        emphasisColor: "--scroll-rail-find-emphasis-color",
        isExclusive: true
    }
];

/** A layer that a note context publishes, with its kind. */
export interface PublishedLayer {
    kind: ScrollRailKind;
    layer: ScrollRailLayer;
}

const loadLines = () => import("./scroll_rail_body");

/**
 * The scrollbar of a note split or the quick edit popup, with the markers that its note context
 * publishes. Its root is the first child of the scroller. It replaces the scroller's own scrollbar
 * while the scroller has `detail-has-end-margin`, and loads the lines of the markers with the first
 * layer.
 */
export default function ScrollRail() {
    const hostRef = useRef<HTMLDivElement>(null);
    const railRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const handleRef = useRef<HTMLDivElement>(null);
    const { noteContext } = useNoteContext();
    const noteContextRef = useRef(noteContext);
    noteContextRef.current = noteContext;
    const [ areHighlightsShown, setHighlightsShown ] =
        useTriliumOptionBool("textNoteScrollRailHighlightsEnabled");
    const { layers, hasHighlights } = usePublishedLayers(noteContext, areHighlightsShown);
    const colorScheme = useColorScheme();
    const [ bar, setBar ] = useState<ScrollRailBar | null>(null);
    const [ view, setView ] = useState<BarView>({ isOwned: false, isOverflowing: false });
    const [ hasLines, setHasLines ] = useState(false);

    // The layout moves the host into the scroller after this effect has run, so the bar starts
    // at the first size report of the host.
    useLayoutEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        let started: ScrollRailBar | null = null;
        const observer = new ResizeObserver(() => {
            const scroller = host.parentElement;
            if (started || !scroller) return;
            observer.disconnect();
            started = new ScrollRailBar(host, scroller, {
                getPlace: () => ({
                    notePath: noteContextRef.current?.notePath,
                    viewScope: noteContextRef.current?.viewScope
                }),
                onView: (next) => setView((previous) => (
                    previous.isOwned === next.isOwned
                        && previous.isOverflowing === next.isOverflowing ? previous : next))
            });
            setBar(started);
        });
        observer.observe(host);
        return () => {
            observer.disconnect();
            started?.destroy();
        };
    }, []);

    useLayoutEffect(() => {
        bar?.readTheme();
    }, [ bar, colorScheme ]);

    const isLayered = view.isOwned && layers.length > 0;
    const isRailShown = view.isOwned && (view.isOverflowing || (isLayered && hasLines));

    useLayoutEffect(() => {
        bar?.attach(railRef.current, handleRef.current);
    }, [ bar, isRailShown, view.isOverflowing ]);

    return (
        <div ref={hostRef} className="scroll-rail-host">
            {isRailShown && (
                <div
                    ref={railRef}
                    className="scroll-rail"
                    aria-hidden="true"
                    onContextMenu={hasHighlights
                        ? (event) => showRailMenu(event, areHighlightsShown, setHighlightsShown)
                        : undefined}
                >
                    {isLayered && <canvas ref={canvasRef} />}
                    {view.isOverflowing && <div ref={handleRef} className="scroll-rail-handle" />}
                </div>
            )}
            {isLayered && bar && (
                <WithLazyModule load={loadLines}>
                    {({ default: ScrollRailLines }) => (
                        <ScrollRailLines
                            bar={bar}
                            layers={layers}
                            railRef={railRef}
                            canvasRef={canvasRef}
                            isRailShown={isRailShown}
                            onLines={setHasLines}
                        />
                    )}
                </WithLazyModule>
            )}
        </div>
    );
}

/**
 * The layers that `noteContext` publishes, in drawing order, or only the first exclusive one,
 * leaving out the highlights unless `areHighlightsShown`. `hasHighlights` tells whether the
 * highlights are published, shown or not.
 */
function usePublishedLayers(noteContext: NoteContext | null | undefined,
    areHighlightsShown: boolean) {
    const published: PublishedLayer[] = [];
    // The list is constant, so the hooks run in the same order on every render.
    for (const kind of SCROLL_RAIL_KINDS) {
        const layer = useGetContextDataFrom(noteContext, kind.key);
        if (layer) {
            published.push({ kind, layer });
        }
    }
    const isHighlights = ({ kind }: PublishedLayer) => kind.key === "scrollRailHighlights";
    const shown = areHighlightsShown
        ? published
        : published.filter((layer) => !isHighlights(layer));
    const exclusive = shown.find(({ kind }) => kind.isExclusive);
    return {
        layers: exclusive ? [ exclusive ] : shown,
        hasHighlights: published.some(isHighlights)
    };
}

/** Opens the menu of the rail, which shows or hides the lines of the highlights. */
function showRailMenu(event: MouseEvent, areHighlightsShown: boolean,
    setHighlightsShown: (isShown: boolean) => Promise<void>) {
    event.preventDefault();
    void contextMenu.show({
        x: event.pageX,
        y: event.pageY,
        items: [ {
            title: t("scroll_rail.show_highlights"),
            checked: areHighlightsShown,
            handler: () => void setHighlightsShown(!areHighlightsShown)
        } ],
        selectMenuItemHandler: () => {}
    });
}

/** A line under the pointer, as the lines' module found it at a press. */
export interface RailHit {
    layer: ScrollRailLayer;
    marker: number;
    target: ScrollRailTarget;
    /** Whether the line was of its layer's current read at the press. */
    isCurrent: boolean;
    /** `layer.generation` at the press. */
    generation: number;
}

/** What the lines answer to the pointer handling of the bar. Set while a layer is published. */
export interface RailLines {
    /** The line within `distance` of `y`, as it is at this moment. */
    hitTest(y: number, distance: number): RailHit | null;
    /** Checks `hit` again and acts on it: the owner's click, the jump, or nothing. */
    click(hit: RailHit): void;
}

/** What changed in the scroller, for the subscribers of the bar. */
export type BarChange = "size" | "content";

/** Whether the bar replaces the scrollbar of its scroller, and whether the note overflows. */
interface BarView {
    isOwned: boolean;
    isOverflowing: boolean;
}

/** The note and the view that a split shows. A press is bound to those it started on. */
interface Place {
    notePath: NoteContext["notePath"];
    viewScope: NoteContext["viewScope"];
}

interface ScrollRailBarOptions {
    /** The note and the view that the split shows now. */
    getPlace(): Place;
    onView(view: BarView): void;
}

/** A press on the rail, until it is released. */
interface Press {
    pointerId: number;
    place: Place;
    startY: number;
    /** The last position of the pointer, from the top of the track. */
    y: number;
    /**
     * `line` clicks the line on release, `handle` drags once the pointer moves, `drag` drags,
     * `page` pages toward the pointer, `idle` does nothing.
     */
    mode: "line" | "handle" | "drag" | "page" | "idle";
    hit: RailHit | null;
    /** The grab point as a fraction of the handle's length, `null` off the handle. */
    grab: number | null;
}

/** The eased motion of the pages of a press, in px of scroll position. */
interface Motion {
    target: number;
    position: number;
    /** `scrollTop` as read back after the last write. */
    readBack: number;
    /** The time of the last frame, `null` before the first. */
    time: number | null;
}

/** The paging of a press on the track, until the press ends and its motion settles. */
interface Paging {
    place: Place;
    direction: 1 | -1;
    isHeld: boolean;
    repeatTimer: ReturnType<typeof setTimeout> | null;
    motion: Motion | null;
}

const OWNED_CLASS = "detail-has-end-margin";
const ALIVE_CLASS = "has-scroll-rail";
const HANDLE_CLASS = "shows-scroll-rail-handle";
/** On the rail while a press holds the handle, whose `:hover` the pointer capture removes. */
const HELD_CLASS = "is-handle-held";
/** How far the pointer moves before a press becomes a drag, in CSS px. */
const DRAG_THRESHOLD = 3;
/** Delay before a held press on the track repeats, then between repeats, in ms. */
const REPEAT_DELAY = 250;
const REPEAT_INTERVAL = 50;
const FRAME_TIME = 1000 / 60;
/** The input elsewhere that ends paging, listened to on the window while paging runs. */
const OUTSIDE_INPUTS = [ "pointerdown", "click", "wheel", "keydown" ];
const MODIFIER_KEYS = new Set([ "Shift", "Control", "Alt", "Meta" ]);

/**
 * The scrollbar of a scroller. While the scroller has `detail-has-end-margin`, it measures the
 * note, shows its handle in place of the native scrollbar, drags and pages, and passes its sizes
 * and the presses on lines to the lines of the markers.
 */
export class ScrollRailBar {

    /** The sizes of the track and of the scroller at the last measure. */
    metrics: RailMetrics = { railHeight: 0, clientHeight: 0, scrollHeight: 0 };
    isOwned = false;
    isOverflowing = false;
    /** The lines of the markers, while a layer is published. */
    lines: RailLines | null = null;
    private gap = 0;
    private themeGap = Number.NaN;
    private rail: HTMLElement | null = null;
    private handle: HTMLElement | null = null;
    private press: Press | null = null;
    private paging: Paging | null = null;
    private frame: number | null = null;
    private handleFrame: number | null = null;
    private checkFrame: number | null = null;
    private checkTask: ReturnType<typeof setTimeout> | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private readonly mutationObserver: MutationObserver;
    private readonly listeners = new Set<(change: BarChange) => void>();

    constructor(
        private readonly host: HTMLElement,
        readonly scroller: HTMLElement,
        private readonly options: ScrollRailBarOptions
    ) {
        scroller.classList.add(ALIVE_CLASS);
        this.mutationObserver = new MutationObserver((records) => this.onMutations(records));
        this.readTheme();
        this.observeMutations();
        this.updateOwnership();
    }

    /** Whether a press on the rail is held. */
    get isPressed() {
        return this.press !== null;
    }

    /** Reads the theme's gap from the registered `--scroll-rail-gap`, in px, and measures. */
    readTheme() {
        const value = getComputedStyle(this.host).getPropertyValue("--scroll-rail-gap");
        this.themeGap = parseFloat(value);
        this.measure(false);
    }

    /** Measures again, and calls the subscribers only if a size changed. */
    check() {
        this.measure(false);
    }

    /**
     * Calls `listener` with `"size"` after every size report of the observers and every check that
     * found new sizes, and with `"content"` after every change of the DOM of an owned scroller
     * outside the bar, until the returned function is called.
     */
    subscribe(listener: (change: BarChange) => void) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    setLines(lines: RailLines | null) {
        this.lines = lines;
    }

    /** Handles the pointer on `rail` and moves `handle`, from now on; `null` while not rendered. */
    attach(rail: HTMLElement | null, handle: HTMLElement | null) {
        if (rail !== this.rail) {
            this.endPress();
            this.rail?.removeEventListener("pointerenter", this.onPointerEnter);
            this.rail?.removeEventListener("pointerdown", this.onPointerDown);
            this.rail?.removeEventListener("pointermove", this.onPointerMove);
            this.rail?.removeEventListener("pointerup", this.onPointerUp);
            this.rail?.removeEventListener("pointercancel", this.onPressLost);
            this.rail?.removeEventListener("lostpointercapture", this.onPressLost);
            this.rail = rail;
            rail?.addEventListener("pointerenter", this.onPointerEnter);
            rail?.addEventListener("pointerdown", this.onPointerDown);
            rail?.addEventListener("pointermove", this.onPointerMove);
            rail?.addEventListener("pointerup", this.onPointerUp);
            rail?.addEventListener("pointercancel", this.onPressLost);
            rail?.addEventListener("lostpointercapture", this.onPressLost);
        }

        this.handle = handle;
        this.scroller.removeEventListener("scroll", this.onScroll);
        if (handle && !supportsScrollTimeline()) {
            this.scroller.addEventListener("scroll", this.onScroll, { passive: true });
        }
        this.placeHandle();
    }

    destroy() {
        this.endPress();
        this.endPaging();
        this.attach(null, null);
        this.mutationObserver.disconnect();
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.cancelCheck();
        if (this.handleFrame !== null) cancelAnimationFrame(this.handleFrame);
        this.scroller.classList.remove(ALIVE_CLASS, HANDLE_CLASS);
        this.listeners.clear();
        this.lines = null;
    }

    private observeMutations() {
        this.mutationObserver.disconnect();
        this.mutationObserver.observe(this.scroller, this.isOwned
            ? { attributes: true, childList: true, characterData: true, subtree: true }
            : { attributes: true, attributeFilter: [ "class" ] });
    }

    /** Re-reads the class of the scroller, and owns the scroller while it has the mark. */
    private updateOwnership() {
        const isOwned = this.scroller.classList.contains(OWNED_CLASS);
        if (isOwned === this.isOwned) return;

        this.isOwned = isOwned;
        this.observeMutations();
        if (isOwned) {
            this.resizeObserver = new ResizeObserver(() => this.measure(true));
            this.observeBoxes();
            this.measure(false);
        } else {
            this.endPress();
            this.endPaging();
            this.resizeObserver?.disconnect();
            this.resizeObserver = null;
            this.cancelCheck();
            this.metrics = { railHeight: 0, clientHeight: 0, scrollHeight: 0 };
            this.isOverflowing = false;
            this.toggleHandleClass(false);
        }
        this.emitView();
    }

    private observeBoxes() {
        const observer = this.resizeObserver;
        if (!observer) return;
        observer.disconnect();
        observer.observe(this.scroller);
        for (const child of this.scroller.children) {
            if (child !== this.host) {
                observer.observe(child);
            }
        }
    }

    private onMutations(records: MutationRecord[]) {
        let isClassChanged = false;
        let isContentChanged = false;
        let areChildrenChanged = false;
        for (const { type, target, attributeName } of records) {
            if (target === this.scroller && type === "attributes" && attributeName === "class") {
                isClassChanged = true;
            } else if (!this.host.contains(target)) {
                isContentChanged = true;
                areChildrenChanged ||= type === "childList" && target === this.scroller;
            }
        }

        if (isClassChanged) {
            this.updateOwnership();
        }
        if (!this.isOwned) return;
        if (areChildrenChanged) {
            this.observeBoxes();
        }
        if (isContentChanged) {
            this.requestCheck();
            this.notify("content");
        }
    }

    /** Measures once in a task queued from the next animation frame, so on a clean layout. */
    private requestCheck() {
        if (this.checkFrame !== null || this.checkTask !== null) return;
        this.checkFrame = requestAnimationFrame(() => {
            this.checkFrame = null;
            this.checkTask = setTimeout(() => {
                this.checkTask = null;
                this.check();
            });
        });
    }

    private cancelCheck() {
        if (this.checkFrame !== null) cancelAnimationFrame(this.checkFrame);
        if (this.checkTask !== null) clearTimeout(this.checkTask);
        this.checkFrame = null;
        this.checkTask = null;
    }

    /**
     * Reads the sizes of the scroller, writes those of the track and the handle for the CSS, and
     * shows the handle while the note can scroll. `isReport` calls the subscribers even when no
     * size changed, since a child that resized can have moved the targets of the lines.
     */
    private measure(isReport: boolean) {
        if (!this.isOwned) return;
        if (this.scroller.isConnected && !this.scroller.checkVisibility()) return;

        const style = getComputedStyle(this.scroller);
        const { clientHeight, scrollHeight } = this.scroller;
        const { gap, track } = getTrack(this.themeGap, clientHeight);
        const isOverflowing = scrollHeight > clientHeight && canScroll(style);
        const previous = this.metrics;
        const isChanged = previous.railHeight !== track
            || previous.clientHeight !== clientHeight
            || previous.scrollHeight !== scrollHeight
            || this.gap !== gap
            || this.isOverflowing !== isOverflowing;

        if (isChanged) {
            this.metrics = { railHeight: track, clientHeight, scrollHeight };
            this.gap = gap;
            this.writeSizes();
            if (isOverflowing !== this.isOverflowing) {
                this.isOverflowing = isOverflowing;
                const mode = this.press?.mode;
                if (!isOverflowing && (mode === "drag" || mode === "handle")) {
                    this.endPress();
                }
                this.toggleHandleClass(isOverflowing);
                this.emitView();
            }
            this.placeHandle();
        }
        if (isChanged || isReport) {
            this.notify("size");
        }
    }

    private notify(change: BarChange) {
        for (const listener of [ ...this.listeners ]) {
            listener(change);
        }
    }

    private writeSizes() {
        const { height, travel } = getHandleBox(this.metrics, 0);
        const style = this.host.style;
        style.setProperty("--scroll-rail-top", `${this.gap}px`);
        style.setProperty("--scroll-rail-height", `${this.metrics.railHeight}px`);
        style.setProperty("--scroll-rail-handle-height", `${height}px`);
        style.setProperty("--scroll-rail-handle-travel", `${travel}px`);
    }

    /** Puts `shows-scroll-rail-handle` on the scroller, which hides its native scrollbar. */
    private toggleHandleClass(isShown: boolean) {
        const classes = this.scroller.classList;
        if (classes.contains(HANDLE_CLASS) === isShown) return;
        classes.toggle(HANDLE_CLASS, isShown);
        if (hasWebKitScrollbars()) {
            this.rebuildNativeBar(isShown);
        }
    }

    /**
     * WebKit applies a new style only to a scrollbar it builds. When the width of the native bar
     * disagrees with `isHidden`, hiding the overflow for one layout makes WebKit build it again.
     */
    private rebuildNativeBar(isHidden: boolean) {
        const scroller = this.scroller;
        const style = getComputedStyle(scroller);
        const borders = (parseFloat(style.borderLeftWidth) || 0)
            + (parseFloat(style.borderRightWidth) || 0);
        const width = scroller.offsetWidth - scroller.clientWidth - borders;
        const isScrollable = scroller.scrollHeight > scroller.clientHeight && canScroll(style);
        const isMismatched = isHidden ? width > 0 : width <= 0 && isScrollable;
        if (!isMismatched) return;

        const inline = scroller.style.overflowY;
        scroller.style.overflowY = "hidden";
        void scroller.offsetWidth;
        scroller.style.overflowY = inline;
    }

    private emitView() {
        this.options.onView({ isOwned: this.isOwned, isOverflowing: this.isOverflowing });
    }

    /** The handle at the current scroll position while the note overflows, else `null`. */
    private getHandleBox() {
        return this.isOverflowing ? getHandleBox(this.metrics, this.scroller.scrollTop) : null;
    }

    private readonly onScroll = () => {
        this.handleFrame ??= requestAnimationFrame(() => {
            this.handleFrame = null;
            this.placeHandle();
        });
    };

    /** Moves the handle to the scroll position, where no scroll timeline moves it. */
    private placeHandle() {
        if (this.handle && !supportsScrollTimeline()) {
            this.handle.style.translate = `0 ${this.getHandleBox()?.top ?? 0}px`;
        }
    }

    private toRailY(event: PointerEvent) {
        return event.clientY - (this.rail?.getBoundingClientRect().top ?? 0);
    }

    private isSamePlace(place: Place) {
        const current = this.options.getPlace();
        return current.notePath === place.notePath && current.viewScope === place.viewScope;
    }

    private readonly onPointerEnter = () => {
        this.check();
    };

    private readonly onPointerDown = (event: PointerEvent) => {
        event.preventDefault();
        if (event.button !== 0 || this.press || !this.rail) return;

        this.check();
        const y = this.toRailY(event);
        const handle = this.getHandleBox();
        const isOnHandle = !!handle && y >= handle.top && y <= handle.top + handle.height;
        const press: Press = {
            pointerId: event.pointerId,
            place: this.options.getPlace(),
            startY: y,
            y,
            mode: "idle",
            hit: this.lines?.hitTest(y, getPickDistance(event)) ?? null,
            grab: handle && isOnHandle ? (y - handle.top) / handle.height : null
        };
        this.press = press;
        this.rail.setPointerCapture?.(event.pointerId);
        if (press.grab !== null) {
            this.rail.classList.add(HELD_CLASS);
        }

        if (press.hit) {
            press.mode = "line";
        } else if (!handle) {
            press.mode = "idle";
        } else if (isOnHandle) {
            press.mode = "handle";
        } else if (event.shiftKey) {
            press.grab = 0.5;
            this.startDrag(press);
            this.dragTo(press);
        } else {
            press.mode = "page";
            this.startPaging(press.place, y < handle.top ? -1 : 1);
        }
    };

    private readonly onPointerMove = (event: PointerEvent) => {
        const press = this.press;
        if (!press || press.pointerId !== event.pointerId) return;
        if (!this.isSamePlace(press.place)) {
            this.endPress();
            this.endPaging();
            return;
        }

        press.y = this.toRailY(event);
        const isPastThreshold = Math.abs(press.y - press.startY) > DRAG_THRESHOLD;
        if (press.mode === "line" && isPastThreshold) {
            if (press.grab === null) {
                press.mode = "idle";
            } else {
                this.startDrag(press);
            }
        } else if (press.mode === "handle" && isPastThreshold) {
            this.startDrag(press);
        }
        if (press.mode === "drag") {
            this.dragTo(press);
        }
    };

    private readonly onPointerUp = (event: PointerEvent) => {
        const press = this.press;
        if (!press || press.pointerId !== event.pointerId) return;
        if (!this.isSamePlace(press.place)) {
            this.endPress();
            this.endPaging();
            return;
        }

        this.endPress();
        if (press.mode === "line" && press.hit) {
            this.lines?.click(press.hit);
        }
    };

    /** Ends the press as a release does, with no click: `pointercancel`, `lostpointercapture`. */
    private readonly onPressLost = (event: PointerEvent) => {
        if (this.press?.pointerId === event.pointerId) {
            this.endPress();
        }
    };

    private startDrag(press: Press) {
        press.mode = "drag";
        press.hit = null;
        this.endPaging();
        this.rail?.classList.add(HELD_CLASS);
    }

    /** Scrolls so that the grab point of the handle, at its length of now, is under the pointer. */
    private dragTo(press: Press) {
        const handle = this.getHandleBox();
        if (!handle || press.grab === null) {
            this.endPress();
            return;
        }
        const top = press.y - press.grab * handle.height;
        this.scroller.scrollTo({ top: toScrollTop(top, this.metrics), behavior: "instant" });
    }

    /** Ends the press: its capture, a drag, and the repeats of its paging, whose motion settles. */
    private endPress() {
        const press = this.press;
        if (!press) return;

        this.press = null;
        this.rail?.classList.remove(HELD_CLASS);
        if (this.rail?.hasPointerCapture?.(press.pointerId)) {
            this.rail.releasePointerCapture(press.pointerId);
        }
        const paging = this.paging;
        if (paging) {
            paging.isHeld = false;
            if (paging.repeatTimer !== null) clearTimeout(paging.repeatTimer);
            paging.repeatTimer = null;
            if (this.frame === null) {
                this.endPaging();
            }
        }
    }

    /** Starts paging, from the target of the motion of an earlier press when it still moves. */
    private startPaging(place: Place, direction: 1 | -1) {
        const previous = this.paging;
        const motion = previous && this.isSamePlace(previous.place) ? previous.motion : null;
        this.endPaging();
        this.paging = { place, direction, isHeld: true, repeatTimer: null, motion };
        for (const type of OUTSIDE_INPUTS) {
            window.addEventListener(type, this.onOutsideInput, { capture: true, passive: true });
        }
        this.addPage();
        this.paging.repeatTimer = setTimeout(this.repeat, REPEAT_DELAY);
    }

    /** Drops the paging: its repeats, its motion and its listeners. */
    private endPaging() {
        const paging = this.paging;
        if (!paging) return;

        this.paging = null;
        if (paging.repeatTimer !== null) clearTimeout(paging.repeatTimer);
        if (this.frame !== null) cancelAnimationFrame(this.frame);
        this.frame = null;
        for (const type of OUTSIDE_INPUTS) {
            window.removeEventListener(type, this.onOutsideInput, { capture: true });
        }
    }

    /** Ends the paging in the capture phase, before the input's handlers start a smooth scroll. */
    private readonly onOutsideInput = (event: Event) => {
        if (event instanceof KeyboardEvent && MODIFIER_KEYS.has(event.key)) return;
        const isPress = event.type === "pointerdown" || event.type === "click";
        if (isPress && event.target instanceof Node && this.host.contains(event.target)) return;

        if (this.press?.mode === "page") {
            this.endPress();
        }
        this.endPaging();
    };

    private readonly repeat = () => {
        const paging = this.paging;
        if (!paging) return;

        paging.repeatTimer = null;
        if (!this.isSamePlace(paging.place)) {
            this.endPress();
            this.endPaging();
            return;
        }
        if (!paging.isHeld) return;
        this.addPage();
        paging.repeatTimer = setTimeout(this.repeat, REPEAT_INTERVAL);
    };

    /**
     * Adds one page to the target of the motion, unless the handle at that target contains the
     * pointer or is past it. Starts from `scrollTop` once something else scrolled the note.
     */
    private addPage() {
        const paging = this.paging;
        const press = this.press;
        if (!paging || !press) return;

        const scrollTop = this.scroller.scrollTop;
        const motion = paging.motion?.readBack === scrollTop ? paging.motion : null;
        const target = getPageTarget(motion?.target ?? scrollTop, paging.direction, press.y,
            this.metrics);
        if (target === null) return;

        if (document.body.classList.contains("motion-disabled")) {
            this.scroller.scrollTo({ top: target, behavior: "instant" });
            const readBack = this.scroller.scrollTop;
            paging.motion = { target, position: target, readBack, time: null };
            return;
        }
        paging.motion = {
            target,
            position: motion?.position ?? scrollTop,
            readBack: scrollTop,
            time: motion?.time ?? null
        };
        this.frame ??= requestAnimationFrame(this.onFrame);
    }

    /** Moves the note one step toward the target, unless something else scrolled it. */
    private readonly onFrame = (time: number) => {
        this.frame = null;
        const paging = this.paging;
        const motion = paging?.motion;
        if (!paging || !motion) return;
        if (!this.isSamePlace(paging.place)) {
            this.endPress();
            this.endPaging();
            return;
        }
        if (this.scroller.scrollTop !== motion.readBack) {
            paging.motion = null;
            if (!paging.isHeld) this.endPaging();
            return;
        }

        motion.position = stepMotion(motion.position, motion.target,
            motion.time === null ? FRAME_TIME : time - motion.time);
        motion.time = time;
        this.scroller.scrollTo({ top: motion.position, behavior: "instant" });
        motion.readBack = this.scroller.scrollTop;
        if (motion.position !== motion.target) {
            this.frame = requestAnimationFrame(this.onFrame);
        } else {
            motion.time = null;
            if (!paging.isHeld) this.endPaging();
        }
    };

}

/** How far from a line a press or a hover still picks it, in CSS px. */
export function getPickDistance(event: PointerEvent) {
    return event.pointerType === "touch" ? 8 : 3;
}

function canScroll(style: CSSStyleDeclaration) {
    return style.overflowY !== "hidden" && style.overflowY !== "clip";
}

function supportsScrollTimeline() {
    return typeof CSS !== "undefined" && !!CSS.supports?.("animation-timeline", "scroll()");
}

/** Whether the engine styles scrollbars with `::-webkit-scrollbar`: Chromium and WebKit. */
function hasWebKitScrollbars() {
    return typeof CSS !== "undefined" && !!CSS.supports?.("-webkit-box-reflect", "below");
}

/** Sizes of the track and of its scroller, in CSS px. `railHeight` is the length of the track. */
export interface RailMetrics {
    railHeight: number;
    clientHeight: number;
    scrollHeight: number;
}

/** The shortest handle, in CSS px, on a track at least twice as long. */
export const MIN_HANDLE_LENGTH = 24;
/** One page of a press on the track, as a fraction of the view. */
const PAGE_FRACTION = 0.875;
/** Time constant of the eased motion of a page, in ms. */
const MOTION_TIME_CONSTANT = 21;

/**
 * The gap at each end of the rail and the length of the track between them, for a view of
 * `clientHeight` px. The theme's gap is kept between 0 and a quarter of the view.
 */
export function getTrack(themeGap: number, clientHeight: number) {
    const gap = Number.isFinite(themeGap)
        ? Math.min(Math.max(themeGap, 0), clientHeight / 4)
        : 0;
    return { gap, track: clientHeight - 2 * gap };
}

/**
 * The handle at scroll position `scrollTop`: its top and length on the track, and how far it moves
 * from one end of the track to the other. Shorter than the track whenever the note overflows.
 */
export function getHandleBox(
    { railHeight, clientHeight, scrollHeight }: RailMetrics, scrollTop: number
) {
    const minimum = Math.min(MIN_HANDLE_LENGTH, railHeight / 2);
    const height = Math.min(railHeight,
        Math.max(minimum, railHeight * clientHeight / Math.max(scrollHeight, 1)));
    const travel = railHeight - height;
    const maxScroll = scrollHeight - clientHeight;
    const top = maxScroll > 0 ? Math.min(Math.max(scrollTop / maxScroll, 0), 1) * travel : 0;
    return { top, height, travel };
}

/** The scroll position at which the handle has its top at `handleTop`, within the scroll range. */
export function toScrollTop(handleTop: number, metrics: RailMetrics) {
    const { travel } = getHandleBox(metrics, 0);
    const maxScroll = Math.max(metrics.scrollHeight - metrics.clientHeight, 0);
    if (travel <= 0) return 0;
    return Math.min(Math.max(handleTop / travel * maxScroll, 0), maxScroll);
}

/** The length of one page in a view of `clientHeight` px, at least 1 px. */
export function getPageLength(clientHeight: number) {
    return Math.max(clientHeight * PAGE_FRACTION, 1);
}

/**
 * The scroll position one page from `base` in `direction`, or `null` when the handle at `base`
 * contains `pointerY` or is past it, or when the note cannot move further.
 */
export function getPageTarget(
    base: number, direction: 1 | -1, pointerY: number, metrics: RailMetrics
) {
    const handle = getHandleBox(metrics, base);
    const isBeyond = direction > 0
        ? pointerY > handle.top + handle.height
        : pointerY < handle.top;
    if (!isBeyond) return null;

    const maxScroll = Math.max(metrics.scrollHeight - metrics.clientHeight, 0);
    const target = Math.min(Math.max(base + direction * getPageLength(metrics.clientHeight), 0),
        maxScroll);
    return target === base ? null : target;
}

/**
 * The position after `elapsed` ms of eased motion from `position` toward `target`. Returns
 * `target` itself once within half a pixel of it.
 */
export function stepMotion(position: number, target: number, elapsed: number) {
    const next = position
        + (target - position) * (1 - Math.exp(-elapsed / MOTION_TIME_CONSTANT));
    return Math.abs(target - next) <= 0.5 ? target : next;
}
