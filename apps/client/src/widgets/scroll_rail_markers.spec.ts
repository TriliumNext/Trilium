import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type NoteContext from "../components/note_context";
import { revealElement } from "../services/bookmark_jump";
import { rectReads, resetLayoutRecords, scrollCalls, stubBox } from "../test/layout_stubs";
import type { RailMetrics } from "./scroll_rail";
import {
    DOT_SCALE, drawRows, findRow, getHeadingLevel, goToTarget, mapIntoClip, ScrollRailLayer,
    ScrollRailLocator, toRow, toRows, useScrollRailHeadings
} from "./scroll_rail_markers";

vi.mock("../services/bookmark_jump", () => ({ revealElement: vi.fn() }));

afterEach(() => {
    document.body.replaceChildren();
    resetLayoutRecords();
    vi.restoreAllMocks();
    vi.mocked(revealElement).mockReset();
});

describe("rows", () => {
    const metrics: RailMetrics = { railHeight: 100, clientHeight: 100, scrollHeight: 1000 };

    it("draws a shared row once, keeping its first marker, and skips markers with no place", () => {
        const rows = toRows([ 10, 12, null, 500, 14 ], metrics);
        expect(rows.rows).toEqual([ { y: 1, first: 0 }, { y: 50, first: 3 } ]);
        expect(rows.markerRows).toEqual([ 1, 1, null, 50, 1 ]);
    });

    it("picks the nearest line within the distance, and a shared row's emphasized marker", () => {
        const rows = toRows([ 10, 12, 500 ], metrics);
        expect(findRow([ { rows, emphasized: null } ], 1, 3)).toEqual({ layer: 0, marker: 0 });
        expect(findRow([ { rows, emphasized: 1 } ], 3, 3)).toEqual({ layer: 0, marker: 1 });
        // The emphasized marker is on another row.
        expect(findRow([ { rows, emphasized: 2 } ], 1, 3)).toEqual({ layer: 0, marker: 0 });
        expect(findRow([ { rows, emphasized: null } ], 48, 3)).toEqual({ layer: 0, marker: 2 });
        expect(findRow([ { rows, emphasized: null } ], 10, 3)).toBeNull();
        expect(findRow([ { rows: toRows([], metrics), emphasized: null } ], 10, 3)).toBeNull();
    });

    it("takes the nearer layer, and the upper one where two are as near", () => {
        const lower = { rows: toRows([ 200 ], metrics), emphasized: null };
        const upper = { rows: toRows([ 230 ], metrics), emphasized: null };
        expect(findRow([ lower, upper ], 21, 3)).toEqual({ layer: 0, marker: 0 });
        expect(findRow([ lower, upper ], 22, 3)).toEqual({ layer: 1, marker: 0 });
        const same = { rows: toRows([ 200 ], metrics), emphasized: null };
        expect(findRow([ lower, same ], 20, 3)).toEqual({ layer: 1, marker: 0 });
    });
});

describe("drawRows", () => {
    it("fills one rectangle snapped to device pixels per row, then thicker lines on top", () => {
        const metrics: RailMetrics = { railHeight: 100, clientHeight: 100, scrollHeight: 1000 };
        const calls: { style: string; rect: number[] }[] = [];
        const context = {
            ...fakeContext(),
            fillRect(...rect: number[]) {
                calls.push({ style: String(this.fillStyle), rect });
            }
        };

        drawRows(context, { width: 12, height: 100, ratio: 1.25 }, [
            {
                rows: toRows([ 10, 12, 333 ], metrics), emphasized: 1,
                color: "gray", emphasisColor: "black"
            },
            {
                rows: toRows([ 777 ], metrics), emphasized: null,
                color: "orange", emphasisColor: "red"
            }
        ]);

        expect(context.clearRect).toHaveBeenCalledWith(0, 0, 15, 125);
        expect(calls.map(({ style }) => style)).toEqual([ "gray", "gray", "orange", "black" ]);
        for (const { rect } of calls) {
            for (const value of rect) {
                expect(Number.isInteger(value)).toBe(true);
            }
        }
        // Inset 1 px from each side, 2 px thick, and 4 px for the emphasized marker.
        expect(calls[0].rect).toEqual([ 1, 0, 13, 3 ]);
        expect(calls[1].rect).toEqual([ 1, 40, 13, 3 ]);
        expect(calls[3].rect).toEqual([ 1, 0, 13, 5 ]);
    });

    it("draws a centered dot per row, sized by its highest heading, inside the canvas", () => {
        const metrics: RailMetrics = { railHeight: 100, clientHeight: 100, scrollHeight: 1000 };
        const dots: { style: string; arc: number[] }[] = [];
        let arc: number[] = [];
        const context = {
            ...fakeContext(),
            arc(x: number, y: number, radius: number, start: number, end: number) {
                arc = [ x, y, radius, start, end ];
            },
            fill() {
                dots.push({ style: String(this.fillStyle), arc });
            }
        };

        drawRows(context, { width: 12, height: 100, ratio: 2 }, [ {
            rows: toRows([ 0, 500, 503, null, 990 ], metrics), emphasized: null,
            color: "text", emphasisColor: "text", levels: [ 3, 4, 1, 2, 2 ]
        } ]);

        // In device px: an H1 dot is 12 across, H2 6 and H3 4.8, in the middle of the rail, and
        // fully on the canvas at both ends.
        expect(dots).toEqual([
            {
                style: "text",
                arc: [ 12, expect.closeTo(2.4), expect.closeTo(2.4), 0, 2 * Math.PI ]
            },
            { style: "text", arc: [ 12, 100, 6, 0, 2 * Math.PI ] },
            { style: "text", arc: [ 12, 197, 3, 0, 2 * Math.PI ] }
        ]);
        expect(context.fillRect).not.toHaveBeenCalled();
    });

    it("takes the level of a heading from its tag, and the deepest for any other target", () => {
        const levels = [ "h1", "h2", "h3", "h4", "h5", "h6", "p" ]
            .map((tag) => getHeadingLevel(document.createElement(tag)));
        expect(levels).toEqual([ 1, 2, 3, 4, 5, 6, 6 ]);
        expect(DOT_SCALE).toEqual([ 1, 0.5, 0.4, 0.3, 0.2, 0.1 ]);
        expect(getHeadingLevel(document.createRange())).toBe(6);
        expect(getHeadingLevel(null)).toBe(6);
    });
});

describe("useScrollRailHeadings", () => {
    it("publishes the headings outside included notes while shown, once more for each note",
        () => {
            const root = document.body.appendChild(document.createElement("div"));
            root.innerHTML = "<h2>Plan</h2><p>Text</p>"
                + "<section class=\"include-note\"><h2>Included</h2></section>"
                + "<div><h4>Detail</h4></div><h1>End</h1>";
            const noteContext = recordingContext();
            const container = document.body.appendChild(document.createElement("div"));
            const show = (noteId: string, isShown: boolean) => act(() => {
                render(h(HeadingsProbe, { noteContext, noteId, isShown, root }), container);
            });

            show("a", false);
            expect(noteContext.setContextData).not.toHaveBeenCalled();
            show("a", true);
            const layer = noteContext.data.get("scrollRailHeadings");
            expect(layer).toBeInstanceOf(ScrollRailLayer);
            expect(layer?.source.readTargets()
                .map((heading) => (heading instanceof Element ? heading.textContent : null)))
                .toEqual([ "Plan", "Detail", "End" ]);

            // A new note clears the context data.
            noteContext.data.clear();
            show("b", true);
            expect(noteContext.data.get("scrollRailHeadings")).toBe(layer);

            // The other text view of the split published its own layer.
            const other = new ScrollRailLayer({ readTargets: () => [] });
            noteContext.data.set("scrollRailHeadings", other);
            show("b", false);
            expect(noteContext.data.get("scrollRailHeadings")).toBe(other);

            show("b", true);
            act(() => render(null, container));
            expect(noteContext.data.has("scrollRailHeadings")).toBe(false);
        });
});

interface HeadingsProbeProps {
    noteContext: ReturnType<typeof recordingContext>;
    noteId: string;
    isShown: boolean;
    root: Element;
}

function HeadingsProbe({ noteContext, noteId, isShown, root }: HeadingsProbeProps) {
    useScrollRailHeadings(noteContext as unknown as NoteContext, noteId, isShown, () => root);
    return null;
}

/** A note context that keeps its context data in `data`. */
function recordingContext() {
    const data = new Map<string, ScrollRailLayer>();
    return {
        data,
        setContextData: vi.fn((key: string, value: ScrollRailLayer) => {
            data.set(key, value);
        }),
        clearContextData: vi.fn((key: string) => {
            data.delete(key);
        }),
        getContextData: (key: string) => data.get(key)
    };
}

/** A canvas context that draws nothing. */
function fakeContext() {
    return {
        fillStyle: "",
        clearRect: vi.fn(),
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn()
    };
}

describe("mapIntoClip", () => {
    it("places a position in a pane by its offset in the pane's content", () => {
        const pane = { top: 100, scrollTop: 0, clientHeight: 300, scrollHeight: 900 };
        const before = mapIntoClip(800, pane);
        expect(before).toBeCloseTo(100 + 700 / 3);
        // The pane scrolled by 120 px moves the match up as much.
        expect(mapIntoClip(680, { ...pane, scrollTop: 120 })).toBeCloseTo(before);
        expect(mapIntoClip(1640, { top: 200, scrollTop: 0, clientHeight: 0, scrollHeight: 60 }))
            .toBe(200);
    });
});

describe("ScrollRailLocator", () => {
    let scroller: HTMLElement;
    let content: HTMLElement;

    beforeEach(() => {
        scroller = document.body.appendChild(document.createElement("div"));
        stubBox(scroller, { top: 0, height: 400, clientHeight: 400, scrollHeight: 4000 });
        content = scroller.appendChild(document.createElement("div"));
        stubBox(content, { top: 50, height: 3900 });
    });

    it("puts a target hidden as a sibling on the previous visible sibling, not the root", () => {
        const heading = append(content, "h2", { top: 300, height: 20 });
        append(content, "p", { top: 0 }).style.display = "none";
        const hidden = append(content, "p", { top: 0 });
        hidden.style.display = "none";
        const match = append(hidden, "span", { top: 0 });

        const locator = new ScrollRailLocator(scroller);
        expect(locator.locate(match)).toBe(300);
        expect(locator.locate(heading)).toBe(300);
    });

    it("puts a hidden target with no sibling that shows on the nearest ancestor with a box", () => {
        const details = append(content, "div", { top: 600, height: 20 });
        const body = append(details, "div", { top: 0 });
        body.style.display = "none";
        expect(new ScrollRailLocator(scroller).locate(append(body, "p", {}))).toBe(600);
    });

    it("places nothing for a detached target, one outside the scroller, or no target", () => {
        const locator = new ScrollRailLocator(scroller);
        expect(locator.locate(document.createElement("p"))).toBeNull();
        expect(locator.locate(document.body.appendChild(document.createElement("p")))).toBeNull();
        expect(locator.locate(null)).toBeNull();
        expect(locator.locate({ within: document.createElement("div"), offset: 10 })).toBeNull();
    });

    it("places nothing for a collapsed range, and reads no rectangle for it", () => {
        const paragraph = append(content, "p", { top: 700, height: 20 });
        paragraph.textContent = "a needle";
        const rangeRect = vi.spyOn(Range.prototype, "getBoundingClientRect");
        const collapsed = document.createRange();
        collapsed.setStart(content, 0);
        collapsed.collapse(true);
        resetLayoutRecords();

        expect(new ScrollRailLocator(scroller).locate(collapsed)).toBeNull();
        expect(rangeRect).not.toHaveBeenCalled();
        expect([ ...rectReads.keys() ]).toEqual([ scroller ]);

        // New HTML in the root leaves the range of an old match collapsed or detached.
        const match = rangeOf(paragraph, 2, 8);
        content.innerHTML = "<p>a needle</p>";
        expect(new ScrollRailLocator(scroller).locate(match)).toBeNull();
    });

    it("maps a target in a scrolling pane by its offset in the pane, whatever the scrolls", () => {
        const pane = append(content, "div", {
            top: () => 100 - scroller.scrollTop, clientHeight: 300, scrollHeight: 900
        });
        pane.style.overflowY = "auto";
        const match = append(pane, "span", {
            top: () => 800 - pane.scrollTop - scroller.scrollTop, height: 16
        });

        const place = new ScrollRailLocator(scroller).locate(match) ?? NaN;
        expect(place).toBeCloseTo(100 + 700 / 3);
        pane.scrollTop = 120;
        scroller.scrollTop = 1000;
        expect(new ScrollRailLocator(scroller).locate(match)).toBeCloseTo(place);

        // An offset in the content of the pane, as a code editor names its lines.
        expect(new ScrollRailLocator(scroller).locate({ within: pane, offset: 700 }))
            .toBeCloseTo(place);
        pane.scrollTop = 0;
        scroller.scrollTop = 0;
        expect(new ScrollRailLocator(scroller).locate({ within: pane, offset: 700 }))
            .toBeCloseTo(place);
        const plain = append(content, "div", { top: 2000, height: 300 });
        expect(new ScrollRailLocator(scroller).locate({ within: plain, offset: 50 })).toBe(2050);
    });

    it("puts a target in a block of no height that clips at the top of that block", () => {
        const block = append(content, "div", {
            top: 200, height: 0, clientHeight: 0, scrollHeight: 60
        });
        block.style.overflowY = "hidden";
        const match = append(block, "span", { top: 1640, height: 16 });
        expect(new ScrollRailLocator(scroller).locate(match)).toBe(200);
    });

    it("measures each range up to 500 targets, and the element that holds it above", () => {
        const paragraphs = [ 0, 1, 2 ].map((index) => {
            const paragraph = append(content, "p", { top: 100 * index, height: 20 });
            paragraph.textContent = "x".repeat(200);
            return paragraph;
        });
        const ranges = (count: number) => Array.from({ length: count },
            (_, index) => rangeOf(paragraphs[index % 3], index % 200, index % 200 + 1));
        const rangeRect = vi.spyOn(Range.prototype, "getBoundingClientRect")
            .mockReturnValue(new DOMRect(0, 10, 1, 1));

        const byRange = new ScrollRailLocator(scroller, false);
        for (const range of ranges(500)) byRange.locate(range);
        expect(rangeRect).toHaveBeenCalledTimes(500);

        rangeRect.mockClear();
        resetLayoutRecords();
        const byElement = new ScrollRailLocator(scroller, true);
        const places = ranges(501).map((range) => byElement.locate(range));
        expect(rangeRect).not.toHaveBeenCalled();
        for (const paragraph of paragraphs) {
            expect(rectReads.get(paragraph)).toBe(1);
        }
        expect(places.slice(0, 3)).toEqual([ 0, 100, 200 ]);
    });
});

describe("ScrollRailLayer", () => {
    it("tells its subscribers of each change, and never reads its targets by itself", () => {
        const readTargets = vi.fn(() => []);
        const layer = new ScrollRailLayer({ readTargets });
        const changes: string[] = [];
        const unsubscribe = layer.subscribe((change) => changes.push(
            `${change}:${layer.generation}:${layer.isPaused}`));

        layer.retire();
        layer.refreshLater();
        layer.refresh();
        layer.emphasize(3);
        layer.emphasize(3);
        layer.refreshLater();
        unsubscribe();
        layer.refresh();

        expect(changes).toEqual([
            "retire:1:true", "refreshLater:2:true", "refresh:3:false", "emphasize:3:false",
            "refreshLater:4:false"
        ]);
        expect(layer.emphasized).toBe(3);
        expect(readTargets).not.toHaveBeenCalled();
    });
});

describe("goToTarget", () => {
    let scroller: HTMLElement;
    let content: HTMLElement;
    let log: string[];

    beforeEach(() => {
        log = [];
        scroller = document.body.appendChild(document.createElement("div"));
        scroller.style.overflowY = "auto";
        stubBox(scroller, { top: 0, height: 400, clientHeight: 400, scrollHeight: 4000 });
        content = scroller.appendChild(document.createElement("div"));
        stubBox(content, { top: 0, height: 4000 });
        vi.mocked(revealElement).mockImplementation((element) => {
            log.push(`reveal ${element.localName}`);
        });
    });

    it("reveals the target, then centers it in its pane and in the scroller, at once", () => {
        const pane = append(content, "div", {
            top: 2000, height: 100, clientHeight: 100, scrollHeight: 900
        });
        pane.style.overflowY = "auto";
        const paragraph = append(pane, "p", { top: 2700, height: 20 });
        paragraph.textContent = "a needle";
        const match = rangeOf(paragraph, 2, 8);
        vi.spyOn(match, "getBoundingClientRect").mockImplementation(() => {
            log.push("measure");
            return new DOMRect(0, 2700, 10, 16);
        });

        goToTarget(match, scroller);
        expect(log[0]).toBe("reveal p");
        expect(revealElement).toHaveBeenCalledWith(paragraph, scroller);
        expect(scrollCalls.map(
            ({ element, method, options }) => [ element, method, options.behavior ]
        )).toEqual([ [ pane, "scrollBy", "instant" ], [ scroller, "scrollBy", "instant" ] ]);
    });

    it("scrolls the content of a pane to an offset before the boxes around it", () => {
        const pane = append(content, "div", {
            top: 2000, height: 100, clientHeight: 100, scrollHeight: 900
        });
        pane.style.overflowY = "auto";

        goToTarget({ within: pane, offset: 700 }, scroller);
        expect(scrollCalls[0]).toEqual({
            element: pane, method: "scrollTo", options: { top: 650, behavior: "instant" }
        });
        expect(scrollCalls[1]).toMatchObject({
            element: scroller, method: "scrollBy", options: { behavior: "instant" }
        });
    });

    it("centers the line's place for targets hidden or cut off by a box that cannot scroll", () => {
        append(content, "h2", { top: 1500, height: 20 });
        const hidden = append(content, "p", {});
        hidden.style.display = "none";
        goToTarget(hidden, scroller);
        expect(scrollCalls).toEqual([ {
            element: scroller, method: "scrollTo", options: { top: 1300, behavior: "instant" }
        } ]);

        scrollCalls.length = 0;
        scroller.scrollTop = 0;
        const block = append(content, "div", {
            top: 3000, height: 0, clientHeight: 0, scrollHeight: 60
        });
        block.style.overflowY = "hidden";
        goToTarget(append(block, "span", { top: 4440, height: 16 }), scroller);
        expect(scrollCalls).toEqual([ {
            element: scroller, method: "scrollTo", options: { top: 2800, behavior: "instant" }
        } ]);
    });

    it("reveals and scrolls nothing for a target that names nothing", () => {
        const paragraph = append(content, "p", { top: 700, height: 20 });
        paragraph.textContent = "a needle";
        const collapsed = rangeOf(paragraph, 2, 2);

        goToTarget(collapsed, scroller);
        goToTarget(document.createElement("p"), scroller);
        goToTarget(null, scroller);
        expect(revealElement).not.toHaveBeenCalled();
        expect(scrollCalls).toEqual([]);
    });
});

function append(parent: Element, tag: string, box: Parameters<typeof stubBox>[1]) {
    const element = parent.appendChild(document.createElement(tag));
    stubBox(element, box);
    return element;
}

function rangeOf(element: Element, start: number, end: number) {
    const text = element.firstChild;
    if (!text) throw new Error("the element has no text");
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, end);
    return range;
}
