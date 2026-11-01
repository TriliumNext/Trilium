import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { canScroll, createEdgeScroller, edgePull, type Insets } from "./edge_scroll";

describe("edgePull", () => {
    /** A box from 100 to 500, with the pull reaching 50 in from each edge. */
    const pull = (position: number) => edgePull(100, 500, position, 50);

    it("pulls at nothing while the point stands clear of both edges", () => {
        expect(pull(300)).toBe(0);
        expect(pull(151)).toBe(0);
        expect(pull(449)).toBe(0);
    });

    it("pulls harder the nearer the point comes to an edge", () => {
        expect(pull(125)).toBeCloseTo(-0.5);
        expect(pull(475)).toBeCloseTo(0.5);
        expect(Math.abs(pull(110))).toBeGreaterThan(Math.abs(pull(140)));
    });

    it("pulls at full strength from the edge outwards", () => {
        expect(pull(100)).toBe(-1);
        expect(pull(-500)).toBe(-1);
        expect(pull(500)).toBe(1);
        expect(pull(5000)).toBe(1);
    });

    /** Both margins would meet, and every point would be pulled two ways at once. */
    it("pulls at nothing in a box no wider than its own margins", () => {
        expect(edgePull(0, 100, 10, 50)).toBe(0);
        expect(edgePull(0, 100, 50, 50)).toBe(0);
    });
});

describe("canScroll", () => {
    function box({ offset = 50, size = 100, content = 400 } = {}) {
        const element = document.createElement("div");
        for (const [ name, value ] of Object.entries({
            scrollLeft: offset, clientWidth: size, scrollWidth: content,
            scrollTop: offset, clientHeight: size, scrollHeight: content
        })) {
            Object.defineProperty(element, name, { value, configurable: true, writable: true });
        }
        return element;
    }

    it("knows there is more to reach in either direction", () => {
        expect(canScroll(box(), "x", -1)).toBe(true);
        expect(canScroll(box(), "x", 1)).toBe(true);
        expect(canScroll(box(), "y", -1)).toBe(true);
    });

    it("knows an end when it reaches one", () => {
        expect(canScroll(box({ offset: 0 }), "x", -1)).toBe(false);
        expect(canScroll(box({ offset: 0 }), "x", 1)).toBe(true);
        expect(canScroll(box({ offset: 300 }), "y", 1)).toBe(false);
        expect(canScroll(box({ offset: 300 }), "y", -1)).toBe(true);
    });

    it("knows a container with nothing to scroll", () => {
        const fits = box({ offset: 0, size: 400, content: 400 });
        expect(canScroll(fits, "x", 1)).toBe(false);
        expect(canScroll(fits, "x", -1)).toBe(false);
    });
});

describe("createEdgeScroller", () => {
    let scroller: ReturnType<typeof createEdgeScroller> | undefined;

    beforeEach(() => vi.useFakeTimers());

    afterEach(() => {
        scroller?.stop();
        scroller = undefined;
        vi.useRealTimers();
    });

    /** A 400x400 box on screen at 0,0 holding content four times its size. */
    function container() {
        const element = document.createElement("div");
        element.getBoundingClientRect = () => ({
            left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400
        }) as DOMRect;
        for (const [ name, value ] of Object.entries({
            clientWidth: 400, scrollWidth: 1600, clientHeight: 400, scrollHeight: 1600
        })) {
            Object.defineProperty(element, name, { value, configurable: true });
        }
        element.scrollLeft = 200;
        element.scrollTop = 200;
        return element;
    }

    it("walks a container along while the pointer is held at its edge", () => {
        const element = container();
        scroller = createEdgeScroller();

        scroller.update([ { element, axis: "x" } ], 395, 200);
        vi.advanceTimersByTime(200);

        expect(element.scrollLeft).toBeGreaterThan(200);
        expect(element.scrollTop).toBe(200);
    });

    it("walks it the other way at the other edge", () => {
        const element = container();
        scroller = createEdgeScroller();

        scroller.update([ { element, axis: "x" } ], 5, 200);
        vi.advanceTimersByTime(200);

        expect(element.scrollLeft).toBeLessThan(200);
    });

    it("leaves it alone while the pointer stands clear of the edges", () => {
        const element = container();
        scroller = createEdgeScroller();

        scroller.update([ { element, axis: "x" } ], 200, 200);
        vi.advanceTimersByTime(500);

        expect(element.scrollLeft).toBe(200);
    });

    /** A card carried into a corner walks the board along and the column down at once. */
    it("walks every container it is given", () => {
        const board = container();
        const column = container();
        scroller = createEdgeScroller();

        scroller.update([ { element: board, axis: "x" }, { element: column, axis: "y" } ], 395, 395);
        vi.advanceTimersByTime(200);

        expect(board.scrollLeft).toBeGreaterThan(200);
        expect(column.scrollTop).toBeGreaterThan(200);
    });

    /**
     * A container reaching under a fixed toolbar has an edge no finger can be carried to: the pull
     * is measured against what is left of the screen, so resting against the bar pulls as hard as
     * resting on the edge would.
     */
    it("measures the pull from the edge of what is left of the screen", () => {
        const bar = 56;
        // As far down as a finger goes with a bar that deep over the foot of the screen.
        const finger = window.innerHeight - bar - 2;

        const walked = (reach?: () => Insets) => {
            // A pane filling the screen, and so reaching under the bar itself.
            const element = container();
            element.getBoundingClientRect = () => new DOMRect(0, 0, 400, window.innerHeight);

            scroller = createEdgeScroller({ margin: 100, speed: 1000, reach });
            scroller.update([ { element, axis: "y" } ], 200, finger);
            vi.advanceTimersByTime(300);
            const walkedBy = element.scrollTop - 200;
            scroller.stop();
            return walkedBy;
        };

        const past = walked();
        const upTo = walked(() => ({ top: 0, bottom: bar, left: 0, right: 0 }));

        expect(past).toBeGreaterThan(0);
        // Nearly the whole pull rather than the little left over past the bar.
        expect(upTo).toBeGreaterThan(past * 1.8);
    });

    /**
     * The app's own scrolling containers are styled `scroll-behavior: smooth`, which would make an
     * animation of every frame's step: each one replaces the last before it has arrived, and the
     * walk crawls at a fraction of the speed it was asked for.
     */
    it("asks for each step instantly, however the container is styled", () => {
        const element = container();
        const asked: unknown[] = [];
        element.scrollTo = (options: unknown) => { asked.push(options); };
        scroller = createEdgeScroller();

        scroller.update([ { element, axis: "y" } ], 200, 395);
        vi.advanceTimersByTime(100);

        expect(asked.length).toBeGreaterThan(0);
        expect(asked.every((options) => (options as ScrollToOptions).behavior === "instant"))
            .toBe(true);
    });

    it("says so after each frame that moved something", () => {
        const element = container();
        const onScroll = vi.fn();
        scroller = createEdgeScroller({ onScroll });

        scroller.update([ { element, axis: "x" } ], 395, 200);
        vi.advanceTimersByTime(100);
        expect(onScroll).toHaveBeenCalled();

        // Back to the middle: nothing moves, so nothing is reported.
        onScroll.mockClear();
        scroller.update([ { element, axis: "x" } ], 200, 200);
        vi.advanceTimersByTime(100);
        expect(onScroll).not.toHaveBeenCalled();
    });

    it("stops when it is told to, and stays stopped", () => {
        const element = container();
        scroller = createEdgeScroller();

        scroller.update([ { element, axis: "x" } ], 395, 200);
        vi.advanceTimersByTime(100);
        const reached = element.scrollLeft;

        scroller.stop();
        vi.advanceTimersByTime(500);
        expect(element.scrollLeft).toBe(reached);
    });

    it("stops at the end rather than counting past it", () => {
        const element = container();
        element.scrollLeft = 1200;
        Object.defineProperty(element, "scrollLeft", { value: 1200, configurable: true });
        scroller = createEdgeScroller();

        scroller.update([ { element, axis: "x" } ], 395, 200);
        vi.advanceTimersByTime(300);

        expect(element.scrollLeft).toBe(1200);
    });
});
