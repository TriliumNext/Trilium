import { TAB_CHANGE_EVENT } from "@triliumnext/ckeditor5/src/plugins/tabs/constants.js";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import appContext from "../components/app_context";
import Component from "../components/component";
import NoteContext from "../components/note_context";
import contextMenu from "../menus/context_menu";
import { revealElement } from "../services/bookmark_jump";
import options from "../services/options";
import { getEffectiveThemeStyle } from "../services/theme";
import { resetLayoutRecords, scrollCalls, stubBox, type StubbedBox } from "../test/layout_stubs";
import { NoteContextContext, ParentComponent } from "./react/react_utils";
import ScrollRail, {
    getHandleBox, getPageLength, getPageTarget, getTrack, MIN_HANDLE_LENGTH, type RailMetrics,
    SCROLL_RAIL_KINDS, type ScrollRailKind, stepMotion, toScrollTop
} from "./scroll_rail";
import { READ_DELAY } from "./scroll_rail_body";
import {
    SCROLL_RAIL_MEASURE_EVENT, ScrollRailLayer, type ScrollRailSource, type ScrollRailTarget, toRow
} from "./scroll_rail_markers";

vi.mock("../services/bookmark_jump", () => ({ revealElement: vi.fn() }));
vi.mock("../services/i18n", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../services/i18n")>()),
    t: (key: string) => key
}));

const [ HIGHLIGHTS, FIND ] = SCROLL_RAIL_KINDS;
const OWNED_CLASS = "detail-has-end-margin";

/** A `ResizeObserver` that reports only when a spec calls {@link resize}. */
class FakeResizeObserver {

    static readonly instances = new Set<FakeResizeObserver>();
    readonly elements = new Set<Element>();

    constructor(private readonly callback: ResizeObserverCallback) {
        FakeResizeObserver.instances.add(this);
    }

    observe(element: Element) {
        this.elements.add(element);
        FakeResizeObserver.instances.add(this);
    }

    unobserve(element: Element) {
        this.elements.delete(element);
    }

    disconnect() {
        this.elements.clear();
        FakeResizeObserver.instances.delete(this);
    }

    report(element: Element) {
        if (this.elements.has(element)) {
            this.callback([], this as unknown as ResizeObserver);
        }
    }

}

/** A `MutationObserver` that reports only the records a spec gives to {@link mutate}. */
class FakeMutationObserver {

    static readonly instances = new Set<FakeMutationObserver>();
    private target: Node | null = null;
    private options: MutationObserverInit = {};

    constructor(private readonly callback: MutationCallback) {}

    observe(target: Node, options: MutationObserverInit) {
        this.target = target;
        this.options = options;
        FakeMutationObserver.instances.add(this);
    }

    disconnect() {
        this.target = null;
        FakeMutationObserver.instances.delete(this);
    }

    takeRecords() {
        return [];
    }

    report(record: Pick<MutationRecord, "type" | "target" | "attributeName">) {
        const { target, options } = this;
        if (!target) return;
        const isInScope = record.target === target
            || (!!options.subtree && target.contains(record.target));
        let isObserved = !!options.characterData;
        if (record.type === "childList") {
            isObserved = !!options.childList;
        } else if (record.type === "attributes") {
            const filter = options.attributeFilter;
            isObserved = filter
                ? filter.includes(record.attributeName ?? "")
                : !!options.attributes;
        }
        if (isInScope && isObserved) {
            this.callback([ record as MutationRecord ], this as unknown as MutationObserver);
        }
    }

}

/** The lines drawn since the canvas was last cleared, as `[color, top, height, opacity]`. */
let drawn: [ string, number, number, number ][];
let scroller: HTMLElement;
let scrollerBox: StubbedBox;
let content: HTMLElement;
let host: HTMLElement;
let fragment: DocumentFragment | null;
let parent: Component;
let noteContext: NoteContext;
/** The properties for which `CSS.supports()` returns `true`. */
let supported: Set<string>;

beforeEach(() => {
    vi.useFakeTimers({
        toFake: [ "setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame" ]
    });
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
    // happy-dom returns a new `CSS` at each access, so a spy on one never reaches the module.
    supported = new Set();
    vi.stubGlobal("CSS", { supports: (property: string) => supported.has(property) });
    drawn = [];
    const context = {
        fillStyle: "",
        globalAlpha: 1,
        clearRect: () => {
            drawn = [];
        },
        fillRect(_x: number, y: number, _width: number, height: number) {
            drawn.push([ String(this.fillStyle), y, height, this.globalAlpha ]);
        }
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
    vi.mocked(revealElement).mockReset();
    options.load({ textNoteScrollRailHighlightsEnabled: "true" });

    scroller = document.body.appendChild(document.createElement("div"));
    scroller.className = `scrolling-container ${OWNED_CLASS}`;
    scrollerBox = { top: 0, height: 400, clientHeight: 400, scrollHeight: 400 };
    stubBox(scroller, scrollerBox);
    content = scroller.appendChild(document.createElement("div"));
    stubBox(content, { top: 0, height: 400 });

    parent = new Component();
    noteContext = new NoteContext("rail-ntx");
    noteContext.notePath = "root/long";
    noteContext.viewScope = { viewMode: "default" };
    appContext.child(parent);
    appContext.child(noteContext);
});

afterEach(() => {
    const mounted = fragment;
    if (mounted) {
        act(() => render(null, mounted));
    }
    fragment = null;
    appContext.removeChild(parent);
    appContext.removeChild(noteContext);
    document.body.replaceChildren();
    document.body.className = "";
    resetLayoutRecords();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("handle geometry", () => {
    const tall: RailMetrics = { railHeight: 384, clientHeight: 400, scrollHeight: 4000 };
    const veryTall: RailMetrics = { railHeight: 384, clientHeight: 400, scrollHeight: 400_000 };

    it("keeps the line of a target on screen inside the handle, on a track shorter than the view",
        () => {
            expect(getHandleBox(tall, 0).height).toBeCloseTo(38.4);
            expect(getHandleBox(veryTall, 0).height).toBe(MIN_HANDLE_LENGTH);
            for (const metrics of [ tall, veryTall ]) {
                const maxScroll = metrics.scrollHeight - metrics.clientHeight;
                for (const scrollTop of [ 0, maxScroll / 2, maxScroll ]) {
                    const handle = getHandleBox(metrics, scrollTop);
                    for (const offset of [ scrollTop, scrollTop + 200, scrollTop + 399 ]) {
                        const row = toRow(offset, metrics);
                        expect(row).toBeGreaterThanOrEqual(Math.floor(handle.top));
                        expect(row).toBeLessThanOrEqual(Math.ceil(handle.top + handle.height));
                    }
                }
            }
        });

    it("leaves the handle shorter than the track whenever the note overflows", () => {
        expect(getTrack(8, 400)).toEqual({ gap: 8, track: 384 });
        const slight = getHandleBox({ railHeight: 384, clientHeight: 400, scrollHeight: 401 }, 0);
        expect(slight.height).toBeCloseTo(383.04, 2);
        expect(slight.travel).toBeCloseTo(0.96, 2);

        expect(getTrack(8, 40)).toEqual({ gap: 8, track: 24 });
        const short: RailMetrics = { railHeight: 24, clientHeight: 40, scrollHeight: 400 };
        expect(getHandleBox(short, 0)).toEqual({ top: 0, height: 12, travel: 12 });
        // A press at the end of the track pages to the end of the note.
        let scrollTop = 0;
        for (let target = getPageTarget(scrollTop, 1, 23.9, short); target !== null;
            target = getPageTarget(scrollTop, 1, 23.9, short)) {
            scrollTop = target;
        }
        expect(scrollTop).toBe(360);

        expect(getTrack(30, 40)).toEqual({ gap: 10, track: 20 });
        expect(getTrack(-8, 40)).toEqual({ gap: 0, track: 40 });
        expect(getTrack(Number.NaN, 400)).toEqual({ gap: 0, track: 400 });
    });

    it("turns a handle position into a scroll position, clamped at both ends", () => {
        const view: RailMetrics = { railHeight: 400, clientHeight: 400, scrollHeight: 4000 };
        expect(toScrollTop(180, view)).toBe(1800);
        expect(toScrollTop(-50, view)).toBe(0);
        expect(toScrollTop(10_000, view)).toBe(3600);
        expect(toScrollTop(100, { railHeight: 400, clientHeight: 400, scrollHeight: 400 })).toBe(0);
    });
});

describe("paging", () => {
    /** A handle of 40 px that moves by 360 px. */
    const view: RailMetrics = { railHeight: 400, clientHeight: 400, scrollHeight: 4000 };

    it("moves one page of 87.5 % of the view toward the pointer, within the scroll range", () => {
        expect(getPageLength(400)).toBe(350);
        expect(getPageLength(0.5)).toBe(1);
        expect(getPageTarget(0, 1, 300, view)).toBe(350);
        expect(getPageTarget(1200, -1, 10, view)).toBe(850);
        expect(getPageTarget(3500, 1, 399, view)).toBe(3600);
        expect(getPageTarget(100, -1, 5, view)).toBe(0);
    });

    it("adds no page once the handle at the target holds the pointer, or passed it", () => {
        // The handle at 2,800 spans rows 280 to 320.
        expect(getPageTarget(2450, 1, 300, view)).toBe(2800);
        expect(getPageTarget(2800, 1, 300, view)).toBeNull();
        expect(getPageTarget(2800, 1, 250, view)).toBeNull();
        expect(getPageTarget(2800, -1, 300, view)).toBeNull();
        expect(getPageTarget(2800, -1, 330, view)).toBeNull();
        expect(getPageTarget(3600, 1, 399.5, view)).toBeNull();
    });

    it("eases to the exact target in nine frames, never past it", () => {
        let position = 0;
        let frames = 0;
        while (position !== 347.375 && frames < 30) {
            const next = stepMotion(position, 347.375, 1000 / 60);
            expect(next).toBeGreaterThan(position);
            expect(next).toBeLessThanOrEqual(347.375);
            position = next;
            frames++;
        }
        expect(position).toBe(347.375);
        expect(frames).toBe(9);
        expect(stepMotion(349.6, 350, 16)).toBe(350);
        expect(stepMotion(350, 0, 16)).toBeGreaterThan(0);
    });
});

describe("ScrollRail", () => {
    it("starts in the scroller it is moved to, and loads the lines with a layer", async () => {
        fragment = document.createDocumentFragment();
        const mountPoint = fragment;
        act(() => render(railTree(), mountPoint));
        const root = mountPoint.firstElementChild;
        if (!(root instanceof HTMLElement)) throw new Error("the host is not rendered");
        host = root;

        // Inside the fragment, the host has no scroller.
        act(() => resize(host));
        expect(scroller.classList.contains("has-scroll-rail")).toBe(false);
        scroller.prepend(host);
        act(() => resize(host));
        expect(scroller.classList.contains("has-scroll-rail")).toBe(true);
        expect(host.childElementCount).toBe(0);

        const paragraph = append(content, "p", { top: 100, height: 20 });
        await publish({ readTargets: () => [ paragraph ] });
        afterPaint();
        expect(host.querySelector(".scroll-rail > canvas")).not.toBeNull();
        expect(drawn.map(([ , y ]) => y)).toEqual([ 99 ]);

        act(() => noteContext.clearContextData("scrollRailFind"));
        expect(host.childElementCount).toBe(0);
    });

    it("replaces the scrollbar only in a split marked with an end margin, and follows the mark",
        async () => {
            scroller.classList.remove(OWNED_CLASS);
            scrollerBox.scrollHeight = 4000;
            mountRail();
            expect(FakeResizeObserver.instances.size).toBe(0);
            act(() => resize(scroller));
            expect(host.childElementCount).toBe(0);
            expect(hasHandleClass()).toBe(false);
            // A layer published on a split the bar does not own draws nothing.
            const paragraph = append(content, "p", { top: 100, height: 20 });
            await publish({ readTargets: () => [ paragraph ] });
            afterPaint();
            expect(host.childElementCount).toBe(0);

            scroller.classList.add(OWNED_CLASS);
            act(() => mutate(scroller, "attributes", "class"));
            expect(host.querySelector(".scroll-rail > .scroll-rail-handle")).not.toBeNull();
            expect(hasHandleClass()).toBe(true);
            expect(FakeResizeObserver.instances.size).toBe(1);

            scroller.classList.remove(OWNED_CLASS);
            act(() => mutate(scroller, "attributes", "class"));
            expect(host.childElementCount).toBe(0);
            expect(hasHandleClass()).toBe(false);
            expect(FakeResizeObserver.instances.size).toBe(0);
        });

    it("rebuilds a native bar that disagrees with the class where the engine keeps its style",
        () => {
            let nativeWidth = 10;
            const overflowAtReads: string[] = [];
            Object.defineProperty(scroller, "offsetWidth", {
                configurable: true,
                get: () => {
                    overflowAtReads.push(scroller.style.overflowY);
                    return 300;
                }
            });
            Object.defineProperty(scroller, "clientWidth", {
                configurable: true,
                get: () => 300 - nativeWidth
            });
            scroller.style.overflowY = "auto";
            mountRail();

            // An engine without `::-webkit-scrollbar` reads nothing.
            scrollerBox.scrollHeight = 4000;
            act(() => resize(scroller));
            expect(hasHandleClass()).toBe(true);
            expect(overflowAtReads).toEqual([]);
            nativeWidth = 0;
            scrollerBox.scrollHeight = 400;
            act(() => resize(scroller));
            expect(hasHandleClass()).toBe(false);

            // The note overflows, and the native bar keeps its width once the class is set.
            supported.add("-webkit-box-reflect");
            nativeWidth = 10;
            scrollerBox.scrollHeight = 4000;
            act(() => resize(scroller));
            expect(hasHandleClass()).toBe(true);
            expect(overflowAtReads).toEqual([ "auto", "hidden" ]);
            expect(scroller.style.overflowY).toBe("auto");

            // The class and the native bar agree.
            overflowAtReads.length = 0;
            nativeWidth = 0;
            scrollerBox.scrollHeight = 400;
            act(() => resize(scroller));
            scrollerBox.scrollHeight = 4000;
            act(() => resize(scroller));
            expect(hasHandleClass()).toBe(true);
            expect(overflowAtReads).toEqual([ "auto", "auto" ]);

            // The split stops being owned while the note overflows, and no native bar comes back.
            overflowAtReads.length = 0;
            scroller.classList.remove(OWNED_CLASS);
            act(() => mutate(scroller, "attributes", "class"));
            expect(hasHandleClass()).toBe(false);
            expect(overflowAtReads).toEqual([ "auto", "hidden" ]);
            expect(scroller.style.overflowY).toBe("auto");
        });

    it("takes over in the callback that reports the native bar, before any scroll", () => {
        mountRail();
        // Content spills out of a box of fixed height: no observed box changes.
        scrollerBox.scrollHeight = 2000;
        advance(1000);
        expect(host.childElementCount).toBe(0);
        expect(hasHandleClass()).toBe(false);

        // The native bar appears and narrows the scroller.
        act(() => resize(scroller));
        expect(host.querySelector(".scroll-rail > .scroll-rail-handle")).not.toBeNull();
        expect(host.querySelector(".scroll-rail > canvas")).toBeNull();
        expect(hasHandleClass()).toBe(true);
        expect(scrollCalls).toEqual([]);
    });

    it("measures again after the next paint when the DOM of the note changes", () => {
        scrollerBox.scrollHeight = 2000;
        mountRail();
        expect(hostProperty("--scroll-rail-handle-height")).toBe("80px");
        const styleReads = vi.spyOn(globalThis, "getComputedStyle");

        // A growth, with several changes in one frame.
        scrollerBox.scrollHeight = 4000;
        act(() => {
            mutate(content, "attributes", "style");
            mutate(content, "childList");
            mutate(content.appendChild(document.createTextNode("text")), "characterData");
        });
        expect(hostProperty("--scroll-rail-handle-height")).toBe("80px");
        afterPaint();
        expect(hostProperty("--scroll-rail-handle-height")).toBe("40px");
        expect(styleReads.mock.calls.filter(([ element ]) => element === scroller)).toHaveLength(1);
        // Row 60 was on the handle before the growth, and is on the track now.
        click(60);
        advance(1000);
        expect(scroller.scrollTop).toBe(350);

        // A shrink to fit.
        scroller.scrollTop = 0;
        scrollerBox.scrollHeight = 400;
        act(() => mutate(content, "childList"));
        afterPaint();
        expect(host.childElementCount).toBe(0);
        expect(hasHandleClass()).toBe(false);

        // A regrowth.
        scrollerBox.scrollHeight = 800;
        act(() => mutate(content, "attributes", "class"));
        afterPaint();
        expect(hostProperty("--scroll-rail-handle-height")).toBe("200px");
        expect(hasHandleClass()).toBe(true);

        // The bar's own writes in the host ask for no check.
        scrollerBox.scrollHeight = 4000;
        act(() => mutate(host, "attributes", "style"));
        afterPaint();
        expect(hostProperty("--scroll-rail-handle-height")).toBe("200px");

        // The pointer entering the rail measures, and a press then hits the handle as drawn.
        pointer("pointerenter", 100);
        expect(hostProperty("--scroll-rail-handle-height")).toBe("40px");
        click(100);
        advance(1000);
        expect(scroller.scrollTop).toBe(350);

        // A press with no `pointerenter` before it, as by touch, measures too.
        scroller.scrollTop = 0;
        scrollerBox.scrollHeight = 800;
        act(() => resize(scroller));
        scrollerBox.scrollHeight = 4000;
        click(100);
        expect(hostProperty("--scroll-rail-handle-height")).toBe("40px");
        advance(1000);
        expect(scroller.scrollTop).toBe(350);
    });

    it("writes the sizes of the track and the handle, with the gap at most a quarter of the view",
        () => {
            mountRail({ gap: 8 });
            expect(host.childElementCount).toBe(0);
            expect(hostProperty("--scroll-rail-top")).toBe("8px");
            expect(hostProperty("--scroll-rail-height")).toBe("384px");

            scrollerBox.scrollHeight = 4000;
            act(() => resize(scroller));
            expect(host.querySelector(".scroll-rail > .scroll-rail-handle")).not.toBeNull();
            expect(host.querySelector(".scroll-rail > canvas")).toBeNull();
            expect(hasHandleClass()).toBe(true);
            expect(parseFloat(hostProperty("--scroll-rail-handle-height"))).toBeCloseTo(38.4);
            expect(parseFloat(hostProperty("--scroll-rail-handle-travel"))).toBeCloseTo(345.6);

            scrollerBox.clientHeight = 20;
            act(() => resize(scroller));
            expect(hostProperty("--scroll-rail-top")).toBe("5px");
            expect(hostProperty("--scroll-rail-height")).toBe("10px");

            scrollerBox.clientHeight = 400;
            scrollerBox.scrollHeight = 400;
            act(() => resize(scroller));
            expect(host.childElementCount).toBe(0);
            expect(hasHandleClass()).toBe(false);

            // A scroller that hides its overflow does not scroll.
            scroller.style.overflowY = "hidden";
            scrollerBox.scrollHeight = 4000;
            act(() => resize(scroller));
            expect(host.childElementCount).toBe(0);
            expect(hasHandleClass()).toBe(false);
        });

    it("pages toward the pointer at the press, also for a click shorter than a frame", () => {
        scrollerBox.scrollHeight = 4000;
        mountRail();

        click(300);
        expect(scrollCalls).toEqual([]);
        advance(1000);
        expect(scroller.scrollTop).toBe(350);
        expect(scrollCalls).toHaveLength(9);

        // The handle now spans rows 35 to 75; a press above it pages up.
        click(10);
        advance(1000);
        expect(scroller.scrollTop).toBe(0);

        // A second click while the first page moves adds to its target.
        click(300);
        advance(50);
        click(300);
        advance(1000);
        expect(scroller.scrollTop).toBe(700);
    });

    it("repeats a held press after 250 ms, then every 50 ms, until the handle holds the pointer",
        () => {
            scrollerBox.scrollHeight = 4000;
            document.body.classList.add("motion-disabled");
            mountRail();

            // Each page lands at once.
            pointer("pointerdown", 300);
            expect(scroller.scrollTop).toBe(350);
            advance(249);
            expect(scroller.scrollTop).toBe(350);
            advance(1);
            expect(scroller.scrollTop).toBe(700);
            advance(49);
            expect(scroller.scrollTop).toBe(700);
            advance(1);
            expect(scroller.scrollTop).toBe(1050);
            // The handle at 2,800 spans rows 280 to 320.
            advance(2000);
            expect(scroller.scrollTop).toBe(2800);
            pointer("pointerup", 300);
            advance(1000);
            expect(scroller.scrollTop).toBe(2800);
        });

    it("ends the repeats at the release, and lets the page in progress settle", () => {
        scrollerBox.scrollHeight = 4000;
        mountRail();

        pointer("pointerdown", 300);
        advance(260);
        pointer("pointerup", 300);
        advance(1000);
        expect(scroller.scrollTop).toBe(700);

        // The same at `pointercancel` and `lostpointercapture`.
        pointer("pointerdown", 380);
        advance(20);
        pointer("pointercancel", 380);
        advance(1000);
        expect(scroller.scrollTop).toBe(1050);
        pointer("pointerdown", 380);
        advance(260);
        pointer("lostpointercapture", 380);
        advance(1000);
        expect(scroller.scrollTop).toBe(1750);
    });

    it("ends a page on its exact target where the scroller rounds each write", () => {
        scrollerBox.clientHeight = 397;
        scrollerBox.scrollHeight = 4000;
        mountRail();
        const writes: number[] = [];
        scroller.scrollTo = ((options: ScrollToOptions) => {
            writes.push(options.top ?? 0);
            scroller.scrollTop = Math.round(options.top ?? 0);
        }) as Element["scrollTo"];

        click(300);
        advance(1000);
        expect(writes).toHaveLength(9);
        expect(writes.at(-1)).toBe(347.375);
        expect(scroller.scrollTop).toBe(347);
    });

    it("gives way to a scroll from elsewhere", () => {
        scrollerBox.scrollHeight = 4000;
        mountRail();

        click(300);
        advance(40);
        const writes = scrollCalls.length;
        expect(writes).toBeGreaterThan(0);
        scroller.scrollTop = 50;
        advance(1000);
        expect(scrollCalls).toHaveLength(writes);
        expect(scroller.scrollTop).toBe(50);
    });

    it("drops a press and its motion once the split shows another note or view", () => {
        scrollerBox.scrollHeight = 4000;
        mountRail();

        // A quick click, then a link to another long note, which starts at the top.
        click(300);
        noteContext.notePath = "root/other";
        advance(1000);
        expect(scrollCalls).toEqual([]);

        // A held press, then another view of the note.
        pointer("pointerdown", 300);
        advance(100);
        const pageWrites = scrollCalls.length;
        expect(pageWrites).toBeGreaterThan(0);
        noteContext.viewScope = { viewMode: "source" };
        scroller.scrollTop = 0;
        advance(1000);
        expect(scrollCalls).toHaveLength(pageWrites);
        pointer("pointerup", 300);

        // A drag of the handle held across a note switch.
        const release = vi.spyOn(rail(), "releasePointerCapture");
        vi.spyOn(rail(), "hasPointerCapture").mockReturnValue(true);
        pointer("pointerdown", 20);
        pointer("pointermove", 100);
        const dragWrites = scrollCalls.length;
        expect(dragWrites).toBeGreaterThan(pageWrites);
        noteContext.notePath = "root/third";
        scroller.scrollTop = 0;
        pointer("pointermove", 200);
        expect(scrollCalls).toHaveLength(dragWrites);
        expect(release).toHaveBeenCalledWith(1);
        expect(rail().classList.contains("is-handle-held")).toBe(false);
        pointer("pointermove", 250);
        pointer("pointerup", 250);
        expect(scrollCalls).toHaveLength(dragWrites);
        expect(scroller.scrollTop).toBe(0);
    });

    it("drops a press and its motion when the split stops being owned, or the bar goes", () => {
        scrollerBox.scrollHeight = 4000;
        mountRail();

        click(300);
        scroller.classList.remove(OWNED_CLASS);
        act(() => mutate(scroller, "attributes", "class"));
        advance(1000);
        expect(scrollCalls).toEqual([]);

        scroller.classList.add(OWNED_CLASS);
        act(() => mutate(scroller, "attributes", "class"));
        click(300);
        const mounted = fragment;
        if (mounted) {
            act(() => render(null, mounted));
        }
        fragment = null;
        advance(1000);
        expect(scrollCalls).toEqual([]);
        expect(scroller.classList.contains("has-scroll-rail")).toBe(false);
    });

    it("ends paging at input elsewhere, before that input's own scroll", () => {
        scrollerBox.scrollHeight = 4000;
        const added = vi.spyOn(window, "addEventListener");
        const removed = vi.spyOn(window, "removeEventListener");
        mountRail();
        const outside = document.body.appendChild(document.createElement("button"));
        const inputs: [ string, () => void ][] = [
            [ "pointerdown", () => outside.dispatchEvent(
                new PointerEvent("pointerdown", { bubbles: true })) ],
            [ "click", () => outside.dispatchEvent(new MouseEvent("click", { bubbles: true })) ],
            [ "wheel", () => scroller.dispatchEvent(new WheelEvent("wheel", { bubbles: true })) ],
            [ "keydown", () => document.body.dispatchEvent(
                new KeyboardEvent("keydown", { key: "Enter", bubbles: true })) ]
        ];

        for (const [ index, [ type, input ] ] of inputs.entries()) {
            scroller.scrollTop = 0;
            pointer("pointerdown", 300);
            advance(50);
            const writes = scrollCalls.length;
            // The input's own handler scrolls, as the Outline does with `scrollIntoView()`.
            const jump = 1000 + index;
            document.body.addEventListener(type, () => {
                scroller.scrollTop = jump;
            }, { once: true });
            act(() => input());
            advance(1000);
            expect(scroller.scrollTop, type).toBe(jump);
            expect(scrollCalls, type).toHaveLength(writes);
            pointer("pointerup", 300);
        }

        // The click that ends a press on the track, and a modifier alone, leave the page running.
        scroller.scrollTop = 0;
        click(300);
        act(() => {
            rail().dispatchEvent(new MouseEvent("click", { bubbles: true }));
            document.body.dispatchEvent(
                new KeyboardEvent("keydown", { key: "Shift", bubbles: true }));
        });
        advance(1000);
        expect(scroller.scrollTop).toBe(350);

        // A drag of the handle goes on. The handle spans rows 35 to 75, grabbed 15 px down.
        pointer("pointerdown", 50);
        pointer("pointermove", 100);
        act(() => {
            document.body.dispatchEvent(
                new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        });
        pointer("pointermove", 200);
        pointer("pointerup", 200);
        expect(scroller.scrollTop).toBeCloseTo(1850);

        // Each of the five pagings added a listener per input, and removed it again.
        const listener = added.mock.calls.find(([ type, , options ]) => type === "wheel"
            && typeof options === "object" && options.capture)?.[1];
        const countOf = (spy: typeof added) => spy.mock.calls
            .filter(([ , call ]) => call === listener).length;
        expect(countOf(added)).toBe(5 * inputs.length);
        expect(countOf(removed)).toBe(countOf(added));
    });

    it("keeps the grab point under the pointer when the handle changes length during a drag",
        () => {
            scrollerBox.scrollHeight = 2000;
            mountRail({ gap: 8 });

            // The handle is 76.8 px long, grabbed 65 px down.
            pointer("pointerdown", 65);
            pointer("pointermove", 70);
            expect(rail().classList.contains("is-handle-held")).toBe(true);
            expect(scroller.scrollTop).toBeCloseTo(5 / 307.2 * 1600);

            scrollerBox.scrollHeight = 4000;
            act(() => resize(scroller));
            pointer("pointermove", 66);
            const metrics = { railHeight: 384, clientHeight: 400, scrollHeight: 4000 };
            const handle = getHandleBox(metrics, scroller.scrollTop);
            expect(handle.top).toBeCloseTo(33.5, 1);
            expect(handle.top + handle.height).toBeCloseTo(71.9, 1);
            pointer("pointerup", 66);
            expect(rail().classList.contains("is-handle-held")).toBe(false);

            // Shift + press centers the handle on the pointer, and keeps it centered.
            pointer("pointerdown", 300, { shiftKey: true });
            expect(rail().classList.contains("is-handle-held")).toBe(true);
            let box = getHandleBox(metrics, scroller.scrollTop);
            expect(box.top + box.height / 2).toBeCloseTo(300);
            scrollerBox.scrollHeight = 8000;
            act(() => resize(scroller));
            pointer("pointermove", 250);
            box = getHandleBox({ ...metrics, scrollHeight: 8000 }, scroller.scrollTop);
            expect(box.top + box.height / 2).toBeCloseTo(250);
            pointer("pointerup", 250);

            // The note shrinks to fit during a drag: the drag ends.
            scroller.scrollTop = 0;
            pointer("pointerdown", 10);
            pointer("pointermove", 20);
            const writes = scrollCalls.length;
            const draggedRail = rail();
            scrollerBox.scrollHeight = 400;
            act(() => resize(scroller));
            expect(host.querySelector(".is-handle-held")).toBeNull();
            pointer("pointermove", 100, {}, draggedRail);
            expect(scrollCalls).toHaveLength(writes);
        });

    it("drags the handle once the pointer moves past the threshold, and pages nothing", () => {
        scrollerBox.scrollHeight = 4000;
        mountRail();

        // The handle is 40 px long, grabbed at its middle. It is held from the press on.
        const down = pointer("pointerdown", 20);
        expect(down.defaultPrevented).toBe(true);
        expect(rail().classList.contains("is-handle-held")).toBe(true);
        pointer("pointermove", 22);
        expect(scrollCalls).toEqual([]);
        expect(rail().classList.contains("is-handle-held")).toBe(true);
        pointer("pointermove", 200);
        expect(rail().classList.contains("is-handle-held")).toBe(true);
        pointer("pointerup", 200);
        expect(scrollCalls.at(-1)?.options).toEqual({ top: 1800, behavior: "instant" });
        expect(rail().classList.contains("is-handle-held")).toBe(false);

        // A press on the handle released in place does nothing.
        const writes = scrollCalls.length;
        click(190);
        advance(1000);
        expect(scrollCalls).toHaveLength(writes);

        // A press on the track holds no handle.
        pointer("pointerdown", 50);
        expect(rail().classList.contains("is-handle-held")).toBe(false);
        pointer("pointerup", 50);
    });
});

describe("ScrollRail lines", () => {
    it("draws level lines and no handle while the note fits; shows the handle while it overflows",
        async () => {
            mountRail();
            const first = append(content, "p", { top: 100, height: 20 });
            const second = append(content, "p", { top: 250, height: 20 });
            await publish({ readTargets: () => [ first, second ] });
            afterPaint();

            expect(host.querySelector(".scroll-rail")).not.toBeNull();
            expect(host.querySelector(".scroll-rail-handle")).toBeNull();
            expect(hasHandleClass()).toBe(false);
            expect(drawn.map(([ , top ]) => top)).toEqual([ 99, 249 ]);

            // A press off a line scrolls nothing and starts no drag.
            press(300, 320);
            advance(1000);
            expect(scrollCalls).toEqual([]);

            scrollerBox.scrollHeight = 4000;
            act(() => resize(scroller));
            expect(host.querySelector(".scroll-rail-handle")).not.toBeNull();
            expect(hostProperty("--scroll-rail-handle-height")).toBe("40px");

            scrollerBox.scrollHeight = 400;
            act(() => resize(scroller));
            expect(host.querySelector(".scroll-rail-handle")).toBeNull();
            expect(host.querySelector(".scroll-rail")).not.toBeNull();
        });

    it("draws the first lines of a note that fits on the track, not in the gaps", async () => {
        mountRail({ gap: 8 });
        const target = append(content, "p", { top: 390, height: 8 });
        await publish({ readTargets: () => [ target ] });
        afterPaint();

        const canvas = host.querySelector("canvas");
        expect(canvas?.height).toBe(384);
        // 390 px down 400 px of content is row 374 of a track of 384 px.
        expect(drawn.map(([ , top ]) => top)).toEqual([ 373 ]);
    });

    it("maps rows again and reads at a size signal of the bar or a measure event", async () => {
        mountRail();
        const target = append(content, "p", { top: 100, height: 20 });
        const readTargets = vi.fn(() => [ target ]);
        await publish({ readTargets });
        afterPaint();
        readTargets.mockClear();

        scrollerBox.scrollHeight = 800;
        act(() => resize(content));
        expect(drawn.map(([ , top ]) => top)).toEqual([ 49 ]);
        expect(readTargets).not.toHaveBeenCalled();
        advance(READ_DELAY);
        expect(readTargets).toHaveBeenCalledTimes(1);

        // A report with no new size still requests a read: a child can have moved the targets.
        act(() => resize(content));
        advance(READ_DELAY);
        expect(readTargets).toHaveBeenCalledTimes(2);

        // Content that moves its parts with no size change reports it.
        content.dispatchEvent(new Event(SCROLL_RAIL_MEASURE_EVENT, { bubbles: true }));
        advance(READ_DELAY - 1);
        expect(readTargets).toHaveBeenCalledTimes(2);
        advance(1);
        expect(readTargets).toHaveBeenCalledTimes(3);
    });

    it("puts off a waiting read until the note stops scrolling", async () => {
        mountRail();
        const target = append(content, "p", { top: 100, height: 20 });
        const readTargets = vi.fn(() => [ target ]);
        await publish({ readTargets });
        afterPaint();
        readTargets.mockClear();

        act(() => resize(content));
        for (let index = 0; index < 5; index++) {
            advance(READ_DELAY - 50);
            scroller.dispatchEvent(new Event("scroll"));
        }
        expect(readTargets).not.toHaveBeenCalled();
        advance(READ_DELAY);
        expect(readTargets).toHaveBeenCalledTimes(1);
    });

    it("shows nothing while no target has a place, and shows once a refresh places one",
        async () => {
            mountRail();
            const target = document.createElement("p");
            stubBox(target, { top: 100, height: 20 });
            const layer = await publish({ readTargets: () => [ target, null ] });
            afterPaint();
            expect(host.querySelector(".scroll-rail")).toBeNull();

            content.append(target);
            act(() => layer.refresh());
            afterPaint();
            expect(host.querySelector(".scroll-rail")).not.toBeNull();
        });

    it("measures nothing in a hidden split, and measures once it shows", async () => {
        mountRail();
        const readTargets = vi.fn(() => [ append(content, "p", { top: 100, height: 20 }) ]);
        scroller.style.display = "none";
        await publish({ readTargets });
        afterPaint();
        expect(readTargets).not.toHaveBeenCalled();

        scroller.style.display = "";
        act(() => resize(scroller));
        expect(readTargets).toHaveBeenCalledTimes(1);
        expect(host.querySelector(".scroll-rail")).not.toBeNull();
    });

    it("measures again on a tab change, which resizes nothing", async () => {
        mountRail();
        const block = append(content, "div", { top: 80, height: 120 });
        append(block, "div", { top: 80, height: 20 });
        const panels = [ 0, 1 ].map(() => {
            const section = append(block, "section", {});
            section.style.display = "contents";
            return append(section, "div", { top: 100, height: 100 });
        });
        const targets = panels.map((panel) => append(panel, "p", { top: 150, height: 16 }));
        panels[1].style.display = "none";
        const onClick = vi.fn();
        await publish({ readTargets: () => targets, onClick });
        afterPaint();
        click(150);
        expect(onClick).toHaveBeenLastCalledWith(0);

        panels[0].style.display = "none";
        panels[1].style.display = "";
        block.dispatchEvent(new Event(TAB_CHANGE_EVENT, { bubbles: true }));
        afterPaint();
        click(150);
        expect(onClick).toHaveBeenLastCalledWith(1);
        click(80);
        expect(onClick).toHaveBeenLastCalledWith(0);
    });

    it("reads the targets after the paint of the next frame, not in its callback", async () => {
        mountRail();
        const readTargets = vi.fn(() => [ append(content, "p", { top: 100, height: 20 }) ]);
        await publish({ readTargets });
        act(() => {
            vi.advanceTimersToNextFrame();
        });
        expect(readTargets).not.toHaveBeenCalled();
        advance(1);
        expect(readTargets).toHaveBeenCalledTimes(1);
    });

    it("retires the lines at once on every change, until the read that follows", async () => {
        mountRail();
        const target = append(content, "p", { top: 100, height: 20 });
        const onClick = vi.fn();
        const getTooltip = vi.fn(() => "tip");
        const layer = await publish({ readTargets: () => [ target ], onClick, getTooltip });
        afterPaint();
        act(() => layer.emphasize(0));
        expect(drawn.map(([ , , height ]) => height)).toEqual([ 2, 4 ]);

        for (const change of [ "retire", "refresh", "refreshLater" ] as const) {
            act(() => layer[change]());
            expect(drawn.map(([ , , height ]) => height), change).toEqual([ 2 ]);
            hover(100);
            expect(getTooltip, change).not.toHaveBeenCalled();
            click(100);
            expect(onClick, change).not.toHaveBeenCalled();
            expect(revealElement, change).toHaveBeenLastCalledWith(target, scroller);
        }

        act(() => layer.refresh());
        afterPaint();
        hover(100);
        expect(getTooltip).toHaveBeenCalledWith(0);
        click(100);
        expect(onClick).toHaveBeenCalledWith(0);
        expect(drawn.map(([ , , height ]) => height)).toEqual([ 2, 4 ]);
    });

    it("keeps a paused source unread, while sizes and tab changes measure its old targets",
        async () => {
            mountRail();
            let top = 100;
            const target = append(content, "p", { top: () => top, height: 20 });
            const readTargets = vi.fn(() => [ target ]);
            const onClick = vi.fn();
            const layer = await publish({ readTargets, onClick });
            afterPaint();

            act(() => layer.retire());
            top = 300;
            act(() => resize(content));
            advance(READ_DELAY);
            expect(drawn.map(([ , y ]) => y)).toEqual([ 299 ]);
            top = 200;
            scroller.dispatchEvent(new Event(TAB_CHANGE_EVENT));
            afterPaint();
            expect(drawn.map(([ , y ]) => y)).toEqual([ 199 ]);
            act(() => layer.refreshLater());
            advance(READ_DELAY * 10);
            click(200);
            expect(readTargets).toHaveBeenCalledTimes(1);
            expect(onClick).not.toHaveBeenCalled();

            act(() => layer.refresh());
            afterPaint();
            expect(readTargets).toHaveBeenCalledTimes(2);
            click(200);
            expect(onClick).toHaveBeenCalledWith(0);
        });

    it("drops the reads asked for before a retire, and reads once per refreshLater() pause",
        async () => {
            mountRail();
            const readTargets = vi.fn((): ScrollRailTarget[] => []);
            const layer = await publish({ readTargets });
            afterPaint();
            readTargets.mockClear();

            act(() => {
                layer.refreshLater();
                layer.refresh();
                layer.retire();
            });
            act(() => {
                vi.advanceTimersToNextFrame();
            });
            advance(READ_DELAY * 2);
            expect(readTargets).not.toHaveBeenCalled();

            act(() => layer.refresh());
            afterPaint();
            readTargets.mockClear();
            for (let index = 0; index < 10; index++) {
                act(() => layer.refreshLater());
                advance(10);
            }
            advance(READ_DELAY - 11);
            expect(readTargets).not.toHaveBeenCalled();
            advance(1);
            expect(readTargets).toHaveBeenCalledTimes(1);
        });

    it("gives a click to the owner, or jumps when it declines or has no click", async () => {
        mountRail();
        const first = append(content, "p", { top: 100, height: 20 });
        const second = append(content, "p", { top: 250, height: 20 });
        const onClick = vi.fn((index: number) => (index === 1 ? false : undefined));
        await publish({ readTargets: () => [ first, second ], onClick });
        afterPaint();

        click(101);
        expect(onClick).toHaveBeenLastCalledWith(0);
        expect(revealElement).not.toHaveBeenCalled();
        click(248);
        expect(onClick).toHaveBeenLastCalledWith(1);
        expect(revealElement).toHaveBeenLastCalledWith(second, scroller);
    });

    it("gives a shared row to its emphasized marker, else the first; the first if retired",
        async () => {
            mountRail();
            const first = append(content, "p", { top: 100, height: 20 });
            const second = append(content, "p", { top: 100.2, height: 20 });
            const onClick = vi.fn();
            const getTooltip = vi.fn(() => "tip");
            const layer = await publish({
                readTargets: () => [ first, second ], onClick, getTooltip
            });
            afterPaint();

            act(() => layer.emphasize(1));
            click(100);
            hover(100);
            expect(onClick).toHaveBeenLastCalledWith(1);
            expect(getTooltip).toHaveBeenLastCalledWith(1);

            act(() => layer.emphasize(null));
            click(100);
            hover(100);
            expect(onClick).toHaveBeenLastCalledWith(0);
            expect(getTooltip).toHaveBeenLastCalledWith(0);

            act(() => layer.emphasize(1));
            act(() => layer.refreshLater());
            click(100);
            expect(revealElement).toHaveBeenLastCalledWith(first, scroller);
        });

    it("draws the highlights in their colors at half opacity, and hides them for the find lines",
        async () => {
            mountRail();
            const highlights = [
                append(content, "span", { top: 100, height: 20 }),
                append(content, "span", { top: 250, height: 20 })
            ];
            const colors = [ [ "yellow", "red" ], [ "blue" ] ];
            const readHighlights = vi.fn(() => highlights);
            await publish({
                readTargets: readHighlights,
                getColors: (index) => colors[index]
            }, HIGHLIGHTS);
            afterPaint();
            const highlightLines = [
                [ "yellow", 99, 2, 0.5 ],
                [ "red", 99, 2, 0.5 ],
                [ "blue", 249, 2, 0.5 ]
            ];
            expect(drawn).toEqual(highlightLines);
            click(250);
            expect(revealElement).toHaveBeenLastCalledWith(highlights[1], scroller);

            // While the find layer is published, only its lines show and take the presses.
            const match = append(content, "p", { top: 100, height: 20 });
            await publish({ readTargets: () => [ match ] });
            afterPaint();
            expect(drawn).toEqual([ [ expect.any(String), 99, 2, 1 ] ]);
            vi.mocked(revealElement).mockClear();
            click(250);
            expect(revealElement).not.toHaveBeenCalled();
            click(100);
            expect(revealElement).toHaveBeenLastCalledWith(match, scroller);

            // Once the find layer goes, the highlights are read again and show.
            readHighlights.mockClear();
            act(() => noteContext.clearContextData("scrollRailFind"));
            afterPaint();
            expect(readHighlights).toHaveBeenCalledOnce();
            expect(drawn).toEqual(highlightLines);
        });

    it("draws a highlight's hue at the theme's saturation and lightness, and a gray in its gray",
        async () => {
            const theme = document.body.appendChild(document.createElement("style"));
            const setPreset = (lightness: string, gray: string) => {
                theme.textContent = `.scroll-rail > canvas {
                    --scroll-rail-highlight-saturation: 70%;
                    --scroll-rail-highlight-lightness: ${lightness};
                    --scroll-rail-highlight-gray-color: ${gray};
                }`;
            };
            setPreset("65%", "#a6a6a6");
            mountRail();
            const highlights = [ 100, 250, 300 ].map((top) => append(content, "span",
                { top, height: 20 }));
            const colors = [
                [ "#e64d4d", "rgb(234, 228, 242)" ],
                [ "#555555", "#f6f8fa" ],
                [ "lab(50 20 30)", "rgb(230, 77, 77)" ]
            ];
            await publish({
                readTargets: () => highlights,
                getColors: (index) => colors[index]
            }, HIGHLIGHTS);
            afterPaint();

            // A pale purple keeps its hue; two grays share one segment, as do a color the rail
            // cannot read and a gray.
            expect(drawn).toEqual([
                [ "hsl(0deg 70% 65%)", 99, 2, 0.5 ],
                [ "hsl(266deg 70% 65%)", 99, 2, 0.5 ],
                [ "#a6a6a6", 249, 2, 0.5 ],
                [ "#a6a6a6", 299, 2, 0.5 ],
                [ "hsl(0deg 70% 65%)", 299, 2, 0.5 ]
            ]);

            setPreset("45%", "#737373");
            act(() => {
                void parent.handleEvent("themeChanged", {
                    themeStyle: getEffectiveThemeStyle() === "dark" ? "light" : "dark"
                });
            });
            expect(drawn.map(([ color ]) => color)).toEqual([
                "hsl(0deg 70% 45%)", "hsl(266deg 70% 45%)", "#737373", "#737373",
                "hsl(0deg 70% 45%)"
            ]);
        });

    it("leaves out the highlights while their option is off, which the rail's menu toggles",
        async () => {
            const show = vi.spyOn(contextMenu, "show").mockResolvedValue();
            const save = vi.spyOn(options, "save").mockResolvedValue();
            mountRail();
            const highlight = append(content, "span", { top: 100, height: 20 });
            await publish({ readTargets: () => [ highlight ], getColors: () => [ "yellow" ] },
                HIGHLIGHTS);
            afterPaint();
            expect(drawn).toEqual([ [ "yellow", 99, 2, 0.5 ] ]);

            const opened = openMenu();
            expect(opened.defaultPrevented).toBe(true);
            const shown = menuItem(show);
            expect(shown).toMatchObject({ title: "scroll_rail.show_highlights", checked: true });
            act(() => shown.handler?.(shown, opened));
            expect(save).toHaveBeenLastCalledWith("textNoteScrollRailHighlightsEnabled", "false");
            // The note fits, so the rail goes with its only lines.
            expect(host.querySelector(".scroll-rail")).toBeNull();

            // A note that overflows keeps the rail, with no lines, and its menu shows them again.
            scrollerBox.scrollHeight = 4000;
            act(() => resize(scroller));
            expect(rail().querySelector("canvas")).toBeNull();
            const reopened = openMenu();
            const hidden = menuItem(show);
            expect(hidden.checked).toBe(false);
            act(() => hidden.handler?.(hidden, reopened));
            expect(save).toHaveBeenLastCalledWith("textNoteScrollRailHighlightsEnabled", "true");
            await act(async () => {
                await vi.dynamicImportSettled();
            });
            afterPaint();
            expect(drawn.map(([ color ]) => color)).toEqual([ "yellow" ]);
        });

    it("keeps the browser's menu on a rail with no highlights published", async () => {
        const show = vi.spyOn(contextMenu, "show").mockResolvedValue();
        scrollerBox.scrollHeight = 4000;
        mountRail();
        await publish({ readTargets: () => [ append(content, "p", { top: 300, height: 20 }) ] });
        afterPaint();

        expect(openMenu().defaultPrevented).toBe(false);
        expect(show).not.toHaveBeenCalled();
    });

    it("reads the highlights again once the content stops changing, and no hidden layer",
        async () => {
            mountRail();
            const highlight = append(content, "span", { top: 200, height: 20 });
            const readHighlights = vi.fn(() => [ highlight ]);
            await publish({ readTargets: readHighlights, getColors: () => [ "yellow" ] },
                HIGHLIGHTS);
            afterPaint();
            readHighlights.mockClear();

            const text = content.appendChild(document.createTextNode("text"));
            for (let index = 0; index < 5; index++) {
                act(() => mutate(text, "characterData"));
                advance(READ_DELAY - 50);
            }
            expect(readHighlights).not.toHaveBeenCalled();
            advance(50);
            expect(readHighlights).toHaveBeenCalledOnce();

            // The bar's own writes in the host change no content.
            act(() => mutate(host, "attributes", "style"));
            advance(READ_DELAY);
            expect(readHighlights).toHaveBeenCalledOnce();

            // The find layer hides the highlights, and is not read on a change of the content.
            const match = append(content, "p", { top: 100, height: 20 });
            const readFind = vi.fn(() => [ match ]);
            await publish({ readTargets: readFind });
            afterPaint();
            readFind.mockClear();
            readHighlights.mockClear();
            act(() => mutate(text, "characterData"));
            advance(READ_DELAY);
            expect(readFind).not.toHaveBeenCalled();
            expect(readHighlights).not.toHaveBeenCalled();
        });

    it("draws the lines under the handle, and gives a press on a line to the lines", async () => {
        scrollerBox.scrollHeight = 4000;
        mountRail();
        const onScreen = append(content, "p", { top: 100, height: 20 });
        const below = append(content, "p", { top: 2000, height: 20 });
        const onClick = vi.fn();
        await publish({ readTargets: () => [ onScreen, below ], onClick });
        afterPaint();
        expect([ ...rail().children ].map((child) => child.className || child.tagName))
            .toEqual([ "CANVAS", "scroll-rail-handle" ]);

        // Row 10 is under the handle, row 200 on the track. A press on row 10 holds the handle.
        pointer("pointerdown", 10);
        expect(rail().classList.contains("is-handle-held")).toBe(true);
        pointer("pointerup", 10);
        expect(rail().classList.contains("is-handle-held")).toBe(false);
        expect(onClick).toHaveBeenLastCalledWith(0);
        click(200);
        advance(1000);
        expect(onClick).toHaveBeenLastCalledWith(1);
        expect(scrollCalls).toEqual([]);

        // A press on a line beside the handle, then a move: no click, no page, no drag.
        press(200, 210);
        advance(1000);
        expect(onClick).toHaveBeenCalledTimes(2);
        expect(scrollCalls).toEqual([]);

        // A press on a line under the handle, then a move, drags the handle.
        press(10, 100);
        expect(onClick).toHaveBeenCalledTimes(2);
        expect(scroller.scrollTop).toBe(900);
    });

    it("ends a drag when the note stops overflowing, while lines keep the rail", async () => {
        scrollerBox.scrollHeight = 4000;
        mountRail();
        await publish({ readTargets: () => [ append(content, "p", { top: 300, height: 20 }) ] });
        afterPaint();

        pointer("pointerdown", 10);
        pointer("pointermove", 20);
        expect(rail().classList.contains("is-handle-held")).toBe(true);
        const writes = scrollCalls.length;
        scrollerBox.scrollHeight = 400;
        act(() => resize(scroller));
        expect(rail().classList.contains("is-handle-held")).toBe(false);
        pointer("pointermove", 100);
        pointer("pointerup", 100);
        expect(scrollCalls).toHaveLength(writes);
    });

    it("checks a press on a line again at its release", async () => {
        mountRail();
        const first = append(content, "p", { top: 100, height: 20 });
        const second = append(content, "p", { top: 300, height: 20 });
        const onClick = vi.fn();
        let targets = [ first ];
        const layer = await publish({ readTargets: () => targets, onClick });
        afterPaint();

        // A new result is committed between the press and the release: the saved target.
        pointer("pointerdown", 100);
        targets = [ second ];
        act(() => layer.refresh());
        afterPaint();
        pointer("pointerup", 100);
        expect(onClick).not.toHaveBeenCalled();
        expect(revealElement).toHaveBeenLastCalledWith(first, scroller);

        // The layer is unpublished between the press and the release, while the highlights keep
        // the lines: nothing.
        vi.mocked(revealElement).mockClear();
        scrollerBox.scrollHeight = 4000;
        act(() => resize(scroller));
        await publish({
            readTargets: () => [ append(content, "span", { top: 3000, height: 20 }) ]
        }, HIGHLIGHTS);
        afterPaint();
        pointer("pointerdown", 30);
        act(() => noteContext.clearContextData("scrollRailFind"));
        pointer("pointerup", 30);
        expect(onClick).not.toHaveBeenCalled();
        expect(revealElement).not.toHaveBeenCalled();

        // The last layer goes as well, while the bar stays: nothing.
        act(() => noteContext.clearContextData("scrollRailHighlights"));
        await publish({ readTargets: () => [ second ], onClick });
        afterPaint();
        pointer("pointerdown", 30);
        act(() => noteContext.clearContextData("scrollRailFind"));
        pointer("pointerup", 30);
        expect(onClick).not.toHaveBeenCalled();
        expect(revealElement).not.toHaveBeenCalled();
    });
});

/** The tree of the rail as the desktop layout renders it in a split. */
function railTree() {
    return (
        <ParentComponent.Provider value={parent}>
            <NoteContextContext.Provider value={noteContext}>
                <ScrollRail />
            </NoteContextContext.Provider>
        </ParentComponent.Provider>
    );
}

/**
 * Renders the rail as the layout does, into a fragment, then moves its host to the start of the
 * scroller and reports its size, which starts the bar. `gap` is the theme's gap, in px.
 */
function mountRail({ gap = 0 } = {}) {
    fragment = document.createDocumentFragment();
    const mountPoint = fragment;
    act(() => render(railTree(), mountPoint));
    const root = mountPoint.firstElementChild;
    if (!(root instanceof HTMLElement)) throw new Error("the host is not rendered");
    host = root;
    host.style.setProperty("--scroll-rail-gap", `${gap}px`);
    scroller.prepend(host);
    act(() => resize(host));
}

/** Publishes a layer of `source` on the note context, and waits for the lines' module. */
async function publish(source: ScrollRailSource, kind: ScrollRailKind = FIND) {
    const layer = new ScrollRailLayer(source);
    act(() => noteContext.setContextData(kind.key, layer));
    await act(async () => {
        await vi.dynamicImportSettled();
    });
    return layer;
}

/** Runs the animation frame and the task after it, in which the rail reads and checks. */
function afterPaint() {
    act(() => {
        vi.advanceTimersToNextFrame();
    });
    advance(1);
}

function advance(ms: number) {
    act(() => {
        vi.advanceTimersByTime(ms);
    });
}

function resize(element: Element) {
    for (const observer of [ ...FakeResizeObserver.instances ]) {
        observer.report(element);
    }
}

function mutate(target: Node, type: MutationRecordType, attributeName: string | null = null) {
    for (const observer of [ ...FakeMutationObserver.instances ]) {
        observer.report({ type, target, attributeName });
    }
}

function append(parentElement: Element, tag: string, box: StubbedBox) {
    const element = parentElement.appendChild(document.createElement(tag));
    stubBox(element, box);
    return element;
}

function hostProperty(name: string) {
    return host.style.getPropertyValue(name);
}

function hasHandleClass() {
    return scroller.classList.contains("shows-scroll-rail-handle");
}

function rail() {
    const element = host.querySelector<HTMLElement>(".scroll-rail");
    if (!element) throw new Error("the rail is not rendered");
    return element;
}

function pointer(type: string, clientY: number, init: PointerEventInit = {}, target = rail()) {
    const event = new PointerEvent(type, {
        clientY, pointerId: 1, button: 0, pointerType: "mouse", bubbles: true, cancelable: true,
        ...init
    });
    act(() => {
        target.dispatchEvent(event);
    });
    return event;
}

function press(fromY: number, toY: number) {
    pointer("pointerdown", fromY);
    pointer("pointermove", toY);
    pointer("pointerup", toY);
}

function click(y: number) {
    press(y, y);
}

function hover(y: number) {
    pointer("pointermove", y);
    pointer("pointerleave", y);
}

/** Right-clicks the rail. */
function openMenu() {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
    act(() => {
        rail().dispatchEvent(event);
    });
    return event;
}

/** The first item of the last menu that `show` opened. */
function menuItem(show: MockInstance<typeof contextMenu.show>) {
    const item = show.mock.lastCall?.[0].items[0];
    if (!item || "kind" in item) throw new Error("no menu with a command item was opened");
    return item;
}
