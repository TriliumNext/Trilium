/**
 * happy-dom lays nothing out, so every child's box is declared and moved by hand: what these check
 * is that a change of place becomes a slide, that an arrival opens out, and that nothing else does.
 */
import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FLIP_DURATION_MS, type FlipOptions, useFlip } from "./flip";

/** Past the window a growth holds open, which is the duration and a little. */
const SETTLE_AFTER_MS = FLIP_DURATION_MS + 100;

describe("useFlip", () => {
    let container: HTMLElement | undefined;
    let frames: (() => void)[] = [];
    let keys: string[] = [];
    let rerender: () => Promise<void>;

    const boxes = {
        offsetParent(this: HTMLElement) { return this.parentElement; },
        offsetHeight() { return 34; },
        offsetWidth() { return 180; },
        offsetTop() { return 0; },
        offsetLeft() { return 0; }
    };

    beforeEach(() => {
        frames = [];
        vi.stubGlobal("requestAnimationFrame", (callback: () => void) => frames.push(callback));
        vi.stubGlobal("matchMedia", () => ({ matches: false }));

        // A child has to have a box on the commit that inserts it, before a test can reach it, so
        // the defaults belong to every element and a test overrides the ones it cares about.
        for (const [ property, read ] of Object.entries(boxes)) {
            Object.defineProperty(HTMLElement.prototype, property, {
                configurable: true, get: read as () => unknown
            });
        }
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        for (const property of Object.keys(boxes)) {
            delete (HTMLElement.prototype as unknown as Record<string, unknown>)[property];
        }
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    it("carries a child back to where it was, and lets go on the next frame", async () => {
        const items = await draw([ "a", "b" ]);

        // The second one is pushed down by something appearing above it.
        place(items(), [ 0, 50 ]);
        await settle();

        const [ first, second ] = items();
        expect(first.style.transform).toBe("");
        expect(second.style.transform).toBe("translateY(-50px)");
        expect(second.style.transition).toBe("none");

        run();
        expect(second.style.transform).toBe("");
        expect(second.style.transition).toBe("");
    });

    it("leaves alone a child that has not moved", async () => {
        const items = await draw([ "a", "b" ]);

        place(items(), [ 0, 0 ]);
        await settle();

        expect(items().every(item => item.style.transform === "")).toBe(true);
    });

    it("carries a child sideways where that is the way they move", async () => {
        const items = await draw([ "a", "b" ], { axis: "horizontal" });

        place(items(), [ 0, 180 ], "offsetLeft");
        await settle();

        expect(items()[1].style.transform).toBe("translateX(-180px)");
    });

    /**
     * An offset is measured from whatever is positioned above the child, so a change of that is a
     * different number for the very same place: a column's cards read one way against the column
     * and another against the box holding them, and the difference is a header's height.
     */
    it("leaves alone a child whose offsets are measured from somewhere else", async () => {
        const items = await draw([ "a", "b" ]);
        const second = items()[1];

        Object.defineProperty(second, "offsetParent", {
            value: document.createElement("div"), configurable: true
        });
        place(items(), [ 0, 75 ]);
        await settle();
        expect(second.style.transform).toBe("");

        // Read against the same thing twice over, it moves as any other child does.
        place(items(), [ 0, 120 ]);
        await settle();
        expect(second.style.transform).toBe("translateY(-45px)");
    });

    it("says nothing while it is switched off, and reads no places either", async () => {
        let reads = 0;
        Object.defineProperty(HTMLElement.prototype, "offsetParent", {
            configurable: true,
            get(this: HTMLElement) { reads++; return this.parentElement; }
        });

        const options = { disabled: true };
        const items = await draw([ "a", "b" ], options);
        reads = 0;

        place(items(), [ 0, 90 ]);
        await settle();
        expect(reads).toBe(0);
        expect(items()[1].style.transform).toBe("");

        // Switched back on, the first commit only records: where the children stood while nobody
        // was watching is not where they came from.
        options.disabled = false;
        await settle();
        expect(reads).toBeGreaterThan(0);
        expect(items()[1].style.transform).toBe("");

        place(items(), [ 0, 140 ]);
        await settle();
        expect(items()[1].style.transform).toBe("translateY(-50px)");
    });

    it("keeps the places it knows while it is paused, and slides from them when it resumes", async () => {
        let reads = 0;
        Object.defineProperty(HTMLElement.prototype, "offsetParent", {
            configurable: true,
            get(this: HTMLElement) { reads++; return this.parentElement; }
        });

        const options: Partial<FlipOptions> = {};
        const items = await draw([ "a", "b" ], options);

        options.paused = true;
        await settle();
        reads = 0;

        // Moved while nobody is measuring, then followed again: the place recorded before the
        // pause is where the child came from, so the move it made is the one that is drawn.
        place(items(), [ 0, 90 ]);
        await settle();
        expect(reads).toBe(0);
        expect(items()[1].style.transform).toBe("");

        options.paused = false;
        await settle();
        expect(items()[1].style.transform).toBe("translateY(-90px)");
    });

    it("calls off a growth it can no longer follow", async () => {
        vi.useFakeTimers();
        const options: Partial<FlipOptions> = { grow: true };
        const items = await draw([ "a" ], options);

        keys.push("b");
        await settle();
        expect(items()[1].style.height).toBe("0px");

        // Switched off part-way through: the frame the growth ends on would otherwise measure the
        // children, which is what being switched off is there to stop.
        options.disabled = true;
        await settle();
        let reads = 0;
        Object.defineProperty(HTMLElement.prototype, "offsetParent", {
            configurable: true,
            get(this: HTMLElement) { reads++; return this.parentElement; }
        });
        vi.advanceTimersByTime(SETTLE_AFTER_MS);
        expect(reads).toBe(0);

        // The growth is over as far as the hook is concerned, so a move made once it is followed
        // again is drawn rather than held back as part of a settling that never ends.
        options.disabled = false;
        await settle();
        place(items(), [ 0, 60 ]);
        await settle();
        expect(items()[1].style.transform).toBe("translateY(-60px)");
    });

    describe("opening out what was not there", () => {
        it("takes a new child down to nothing and lets it out to its own size", async () => {
            const items = await draw([ "a" ], { grow: true });

            keys.push("b");
            await settle();

            const arrived = items()[1];
            expect(arrived.style.height).toBe("0px");
            expect(arrived.style.marginBlock).toBe("0px");
            expect(arrived.style.overflow).toBe("hidden");

            run();
            expect(arrived.style.height).toBe("34px");
            expect(arrived.style.marginBlock).toBe("");
            expect(arrived.style.transition).toContain("height");
        });

        it("opens a new child out sideways where that is the way they move", async () => {
            const items = await draw([ "a" ], { grow: true, axis: "horizontal" });

            keys.push("b");
            await settle();
            run();

            expect(items()[1].style.width).toBe("180px");
        });

        /**
         * A growth moves the children below it over the frames that follow, so a commit landing in
         * that window reads them somewhere on their way. Following that fights the growth: one
         * insertion used to draw five slides against it.
         */
        it("leaves the children a growth is moving alone until it has settled", async () => {
            vi.useFakeTimers();
            const items = await draw([ "a", "b" ], { grow: true });

            keys.push("c");
            await settle();
            run();

            // Caught on its way by a commit while the growth is still running.
            place(items(), [ 0, 20 ]);
            await settle();
            expect(items()[1].style.transform).toBe("");

            // Once it is over, the places are read again and a move is a move.
            await act(async () => { vi.advanceTimersByTime(SETTLE_AFTER_MS); });
            place(items(), [ 0, 60 ]);
            await settle();
            expect(items()[1].style.transform).toBe("translateY(-40px)");
        });

        it("leaves an arrival alone where the caller answers for it", async () => {
            const items = await draw([ "a" ], { grow: (child) => child.textContent !== "b" });

            keys.push("b");
            await settle();
            run();

            expect(items()[1].style.height).toBe("");
            expect(items()[1].style.overflow).toBe("");
        });

        it("leaves the children the container was drawn with alone", async () => {
            const items = await draw([ "a", "b" ], { grow: true });

            expect(items().every(item => item.style.height === "")).toBe(true);
        });

        it("treats a child coming back into the flow as a return, not an arrival", async () => {
            const items = await draw([ "a", "b" ], { grow: true });
            const carried = items()[1];

            // Taken out of the flow, the way a card is while it is carried.
            Object.defineProperty(carried, "offsetParent", { value: null, configurable: true });
            await settle();

            Object.defineProperty(carried, "offsetParent", {
                value: carried.parentElement, configurable: true
            });
            await settle();

            expect(carried.style.height).toBe("");
            expect(carried.style.transform).toBe("");
        });
    });

    async function draw(initial: string[], options: Partial<FlipOptions> = {}) {
        keys = [ ...initial ];
        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);

        function Harness() {
            const ref = useRef<HTMLDivElement>(null);
            useFlip(ref, { selector: ".item", ...options });
            return (
                <div ref={ref}>
                    {keys.map(key => <div key={key} className="item">{key}</div>)}
                </div>
            );
        }

        rerender = async () => {
            await act(async () => { render(<Harness />, mountPoint); });
        };
        await rerender();

        return () => [ ...mountPoint.querySelectorAll<HTMLElement>(".item") ];
    }

    /** Draws again, which is what the hook reads its befores and afters from. */
    async function settle() {
        await rerender();
    }

    /** Runs the frames the hook asked for, which is where it lets go of what it moved. */
    function run() {
        act(() => { for (const frame of frames.splice(0)) frame(); });
    }

    /** happy-dom reports no offsets of its own, so each child is told where it stands. */
    function place(
        items: HTMLElement[], at: number[], property: "offsetTop" | "offsetLeft" = "offsetTop"
    ) {
        for (const [ index, item ] of items.entries()) {
            Object.defineProperty(item, property, {
                value: at[index], configurable: true, writable: true
            });
        }
    }
});
