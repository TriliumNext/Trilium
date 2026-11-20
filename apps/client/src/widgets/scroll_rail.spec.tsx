import { TAB_CHANGE_EVENT } from "@triliumnext/ckeditor5/src/plugins/tabs/constants.js";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../components/app_context";
import Component from "../components/component";
import NoteContext from "../components/note_context";
import { revealElement } from "../services/bookmark_jump";
import { resetLayoutRecords, scrollCalls, stubBox, type StubbedBox } from "../test/layout_stubs";
import { renderInto } from "../test/render";
import { NoteContextContext, ParentComponent } from "./react/react_utils";
import ScrollRail, { SCROLL_RAIL_KINDS, type ScrollRailKind } from "./scroll_rail";
import ScrollRailBody, { READ_DELAY } from "./scroll_rail_body";
import {
    ScrollRailLayer, type ScrollRailSource, type ScrollRailTarget
} from "./scroll_rail_markers";

vi.mock("../services/bookmark_jump", () => ({ revealElement: vi.fn() }));

const [ HEADINGS, FIND ] = SCROLL_RAIL_KINDS;

/** A `ResizeObserver` that reports only when a spec calls {@link resize}. */
class FakeResizeObserver {

    static readonly instances = new Set<FakeResizeObserver>();
    readonly elements = new Set<Element>();

    constructor(private readonly callback: ResizeObserverCallback) {
        FakeResizeObserver.instances.add(this);
    }

    observe(element: Element) {
        this.elements.add(element);
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

/** The lines drawn since the canvas was last cleared, as `[color, top, height]`. */
let drawn: [ string, number, number ][];
let scroller: HTMLElement;
let scrollerBox: StubbedBox;
let host: HTMLElement;
let content: HTMLElement;

beforeEach(() => {
    vi.useFakeTimers({
        toFake: [ "setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame" ]
    });
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    drawn = [];
    const context = {
        fillStyle: "",
        clearRect: () => {
            drawn = [];
        },
        fillRect(_x: number, y: number, _width: number, height: number) {
            drawn.push([ String(this.fillStyle), y, height ]);
        }
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
    vi.mocked(revealElement).mockReset();

    scroller = document.body.appendChild(document.createElement("div"));
    scroller.className = "scrolling-container";
    scrollerBox = { top: 0, height: 400, clientHeight: 400, scrollHeight: 400 };
    stubBox(scroller, scrollerBox);
    host = scroller.appendChild(document.createElement("div"));
    host.className = "scroll-rail-host";
    content = scroller.appendChild(document.createElement("div"));
    stubBox(content, { top: 0, height: 400 });
});

afterEach(() => {
    act(() => render(null, host));
    document.body.replaceChildren();
    resetLayoutRecords();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("ScrollRail", () => {
    it("renders only its host until a layer is published, and loads the rail then", async () => {
        const noteContext = new NoteContext("rail-ntx");
        const parent = new Component();
        appContext.child(parent);
        appContext.child(noteContext);
        const container = renderInto(
            <ParentComponent.Provider value={parent}>
                <NoteContextContext.Provider value={noteContext}>
                    <ScrollRail />
                </NoteContextContext.Provider>
            </ParentComponent.Provider>);
        const railHost = container.querySelector(".scroll-rail-host");
        if (!railHost) throw new Error("the host is not rendered");
        expect(railHost.childElementCount).toBe(0);

        // The layout moves the root of the rail into the scroller.
        scroller.prepend(railHost);
        const paragraph = append(content, "p", { top: 100, height: 20 });
        act(() => noteContext.setContextData(
            "scrollRailFind", new ScrollRailLayer({ readTargets: () => [ paragraph ] })
        ));
        await vi.waitFor(() => {
            act(() => {
                vi.advanceTimersToNextFrame();
            });
            act(() => {
                vi.runOnlyPendingTimers();
            });
            expect(railHost.querySelector(".scroll-rail")).not.toBeNull();
        });

        act(() => noteContext.clearContextData("scrollRailFind"));
        expect(railHost.childElementCount).toBe(0);
        appContext.removeChild(parent);
        appContext.removeChild(noteContext);
    });
});

describe("ScrollRailBody", () => {
    it("draws level lines and no box while the note fits; shows the box while it overflows", () => {
        const first = append(content, "p", { top: 100, height: 20 });
        const second = append(content, "p", { top: 250, height: 20 });
        mount([ layerOf({ readTargets: () => [ first, second ] }) ]);
        readAfterPaint();

        expect(host.querySelector(".scroll-rail")).not.toBeNull();
        expect(host.querySelector(".scroll-rail-viewport")).toBeNull();
        expect(drawn.map(([ , top ]) => top)).toEqual([ 99, 249 ]);

        // A press off a line scrolls nothing and starts no drag.
        press(300, 320);
        expect(scrollCalls).toEqual([]);

        scrollerBox.scrollHeight = 4000;
        act(() => resize(scroller));
        expect(host.querySelector(".scroll-rail-viewport")).not.toBeNull();
        expect(host.style.getPropertyValue("--scroll-rail-box-height")).toBe("40px");

        scrollerBox.scrollHeight = 400;
        act(() => resize(scroller));
        expect(host.querySelector(".scroll-rail-viewport")).toBeNull();
        expect(host.querySelector(".scroll-rail")).not.toBeNull();
    });

    it("shows nothing while no target has a place, and shows once a refresh places one", () => {
        const target = document.createElement("p");
        stubBox(target, { top: 100, height: 20 });
        const layer = mount([ layerOf({ readTargets: () => [ target, null ] }) ])[0];
        readAfterPaint();
        expect(host.querySelector(".scroll-rail")).toBeNull();

        content.append(target);
        act(() => layer.refresh());
        readAfterPaint();
        expect(host.querySelector(".scroll-rail")).not.toBeNull();
    });

    it("measures nothing in a hidden split, and measures once it shows", () => {
        const readTargets = vi.fn(() => [ append(content, "p", { top: 100, height: 20 }) ]);
        scroller.style.display = "none";
        mount([ layerOf({ readTargets }) ]);
        readAfterPaint();
        expect(readTargets).not.toHaveBeenCalled();

        scroller.style.display = "";
        act(() => resize(scroller));
        expect(readTargets).toHaveBeenCalledTimes(1);
        expect(host.querySelector(".scroll-rail")).not.toBeNull();
    });

    it("measures again on a tab change, which resizes nothing", () => {
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
        mount([ layerOf({ readTargets: () => targets, onClick }) ]);
        readAfterPaint();
        click(150);
        expect(onClick).toHaveBeenLastCalledWith(0);

        panels[0].style.display = "none";
        panels[1].style.display = "";
        block.dispatchEvent(new Event(TAB_CHANGE_EVENT, { bubbles: true }));
        readAfterPaint();
        click(150);
        expect(onClick).toHaveBeenLastCalledWith(1);
        click(80);
        expect(onClick).toHaveBeenLastCalledWith(0);
    });

    it("reads the targets after the paint of the next frame, not in its callback", () => {
        const readTargets = vi.fn(() => [ append(content, "p", { top: 100, height: 20 }) ]);
        mount([ layerOf({ readTargets }) ]);
        act(() => {
            vi.advanceTimersToNextFrame();
        });
        expect(readTargets).not.toHaveBeenCalled();
        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(readTargets).toHaveBeenCalledTimes(1);
    });

    it("retires the lines at once on every change, until the read that follows", () => {
        const target = append(content, "p", { top: 100, height: 20 });
        const onClick = vi.fn();
        const getTooltip = vi.fn(() => "tip");
        const [ layer ] = mount([
            layerOf({ readTargets: () => [ target ], onClick, getTooltip })
        ]);
        readAfterPaint();
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
        readAfterPaint();
        hover(100);
        expect(getTooltip).toHaveBeenCalledWith(0);
        click(100);
        expect(onClick).toHaveBeenCalledWith(0);
        expect(drawn.map(([ , , height ]) => height)).toEqual([ 2, 4 ]);
    });

    it("keeps a paused source unread, while sizes and tab changes measure its old targets", () => {
        let top = 100;
        const target = append(content, "p", { top: () => top, height: 20 });
        const readTargets = vi.fn(() => [ target ]);
        const onClick = vi.fn();
        const [ layer ] = mount([ layerOf({ readTargets, onClick }) ]);
        readAfterPaint();

        act(() => layer.retire());
        top = 300;
        act(() => resize(content));
        act(() => {
            vi.advanceTimersByTime(READ_DELAY);
        });
        expect(drawn.map(([ , y ]) => y)).toEqual([ 299 ]);
        top = 200;
        scroller.dispatchEvent(new Event(TAB_CHANGE_EVENT));
        readAfterPaint();
        expect(drawn.map(([ , y ]) => y)).toEqual([ 199 ]);
        act(() => layer.refreshLater());
        act(() => {
            vi.advanceTimersByTime(READ_DELAY * 10);
        });
        click(200);
        expect(readTargets).toHaveBeenCalledTimes(1);
        expect(onClick).not.toHaveBeenCalled();

        act(() => layer.refresh());
        readAfterPaint();
        expect(readTargets).toHaveBeenCalledTimes(2);
        click(200);
        expect(onClick).toHaveBeenCalledWith(0);
    });

    it("drops the reads asked for before a retire, and reads once per refreshLater() pause", () => {
        const readTargets = vi.fn((): ScrollRailTarget[] => []);
        const [ layer ] = mount([ layerOf({ readTargets }) ]);
        readAfterPaint();
        readTargets.mockClear();

        act(() => {
            layer.refreshLater();
            layer.refresh();
            layer.retire();
        });
        act(() => {
            vi.advanceTimersToNextFrame();
        });
        act(() => {
            vi.advanceTimersByTime(READ_DELAY * 2);
        });
        expect(readTargets).not.toHaveBeenCalled();

        act(() => layer.refresh());
        readAfterPaint();
        readTargets.mockClear();
        for (let index = 0; index < 10; index++) {
            act(() => layer.refreshLater());
            act(() => {
                vi.advanceTimersByTime(10);
            });
        }
        act(() => {
            vi.advanceTimersByTime(READ_DELAY - 11);
        });
        expect(readTargets).not.toHaveBeenCalled();
        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(readTargets).toHaveBeenCalledTimes(1);
    });

    it("gives a click to the owner, or jumps when it declines or has no click", () => {
        const first = append(content, "p", { top: 100, height: 20 });
        const second = append(content, "p", { top: 250, height: 20 });
        const onClick = vi.fn((index: number) => (index === 1 ? false : undefined));
        mount([ layerOf({ readTargets: () => [ first, second ], onClick }) ]);
        readAfterPaint();

        click(101);
        expect(onClick).toHaveBeenLastCalledWith(0);
        expect(revealElement).not.toHaveBeenCalled();
        click(248);
        expect(onClick).toHaveBeenLastCalledWith(1);
        expect(revealElement).toHaveBeenLastCalledWith(second, scroller);
    });

    it("gives a shared row to its emphasized marker, else the first; the first if retired", () => {
        const first = append(content, "p", { top: 100, height: 20 });
        const second = append(content, "p", { top: 100.2, height: 20 });
        const onClick = vi.fn();
        const getTooltip = vi.fn(() => "tip");
        const [ layer ] = mount([
            layerOf({ readTargets: () => [ first, second ], onClick, getTooltip })
        ]);
        readAfterPaint();

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

    it("draws the layers in their order, whatever order they are published in", () => {
        const find = layerOf({
            readTargets: () => [ append(content, "p", { top: 100, height: 20 }) ]
        }, FIND);
        const headings = layerOf({
            readTargets: () => [ append(content, "h2", { top: 300, height: 20 }) ]
        }, HEADINGS);
        mount([ find, headings ]);
        readAfterPaint();
        expect(drawn.map(([ , y ]) => y)).toEqual([ 299, 99 ]);
    });

    it("scrolls with a drag past the threshold, and centers the box on a press beside it", () => {
        scrollerBox.scrollHeight = 4000;
        const target = append(content, "p", { top: 100, height: 20 });
        const onClick = vi.fn();
        mount([ layerOf({ readTargets: () => [ target ], onClick }) ]);
        readAfterPaint();

        // The box is 40 px tall at the top: the grab point stays 20 px down it.
        const down = pointer("pointerdown", 20);
        expect(down.defaultPrevented).toBe(true);
        pointer("pointermove", 22);
        expect(scrollCalls).toEqual([]);
        pointer("pointermove", 200);
        pointer("pointerup", 200);
        expect(scrollCalls.at(-1)?.options).toEqual({ top: 1800, behavior: "instant" });
        expect(onClick).not.toHaveBeenCalled();

        scroller.scrollTop = 0;
        press(380, 380);
        expect(scrollCalls.at(-1)?.options).toEqual({ top: 3600, behavior: "instant" });
    });
});

function layerOf(source: ScrollRailSource, kind: ScrollRailKind = FIND) {
    return { kind, layer: new ScrollRailLayer(source) };
}

function mount(layers: ReturnType<typeof layerOf>[]) {
    act(() => render(<ScrollRailBody hostRef={{ current: host }} layers={layers} />, host));
    return layers.map(({ layer }) => layer);
}

/** Runs the animation frame and the task after it, in which the rail reads. */
function readAfterPaint() {
    act(() => {
        vi.advanceTimersToNextFrame();
    });
    act(() => {
        vi.advanceTimersByTime(1);
    });
}

function resize(element: Element) {
    for (const observer of [ ...FakeResizeObserver.instances ]) {
        observer.report(element);
    }
}

function append(parent: Element, tag: string, box: StubbedBox) {
    const element = parent.appendChild(document.createElement(tag));
    stubBox(element, box);
    return element;
}

function pointer(type: string, clientY: number) {
    const rail = host.querySelector(".scroll-rail");
    if (!rail) throw new Error("the rail is not rendered");
    const event = new PointerEvent(type, {
        clientY, pointerId: 1, button: 0, pointerType: "mouse", bubbles: true, cancelable: true
    });
    act(() => {
        rail.dispatchEvent(event);
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
