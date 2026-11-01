import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import CollapseOnOverflow, { nextCollapsedState } from "./CollapseOnOverflow";

describe("nextCollapsedState", () => {
    /** The folded rendering, which fits wherever it is put and hangs outside nothing. */
    const fitting = { wantedWidth: 90, givenWidth: 90, spilledWidth: 0 };

    it("folds once the row is handed less than it asked for, and notes the width it was short of", () => {
        expect(nextCollapsedState({ collapsed: false, expandAt: 0 }, { wantedWidth: 420, givenWidth: 380, spilledWidth: 0, containerWidth: 700 }))
            .toStrictEqual({ collapsed: true, expandAt: 740 });
    });

    it("folds on a row that is not squeezed but hangs outside the container instead", () => {
        // A bar with no room left may hand its parts nothing less and grow past the pane, which is
        // the same shortage read off the other end.
        expect(nextCollapsedState({ collapsed: false, expandAt: 0 }, { wantedWidth: 420, givenWidth: 420, spilledWidth: 93, containerWidth: 700 }))
            .toStrictEqual({ collapsed: true, expandAt: 793 });
    });

    it("leaves the wide rendering up where it fits, a rounded pixel being no shortage", () => {
        const fits = { collapsed: false, expandAt: 0 };
        expect(nextCollapsedState(fits, { wantedWidth: 380, givenWidth: 380, spilledWidth: 0, containerWidth: 700 })).toStrictEqual(fits);
        // Whole numbers off a fractional layout: a row that fits exactly is as likely to report one
        // over as one under, and folding on that would fold rows that are perfectly well shown.
        expect(nextCollapsedState(fits, { wantedWidth: 381, givenWidth: 380, spilledWidth: 1, containerWidth: 700 })).toStrictEqual(fits);
    });

    it("stays folded until the container has grown by what was missing", () => {
        const folded = { collapsed: true, expandAt: 740 };
        // The folded rendering fits wherever it is put, so its own measurement says nothing: what is
        // waited on is the container.
        expect(nextCollapsedState(folded, { ...fitting, containerWidth: 739 })).toStrictEqual(folded);
        expect(nextCollapsedState(folded, { ...fitting, containerWidth: 740 }))
            .toStrictEqual({ collapsed: false, expandAt: 0 });
    });

    it("settles rather than flipping, where unfolding shows the mark to have been set short", () => {
        // The row may be given only its own share of a shortage the whole bar takes part in, so the
        // mark it sets on folding can be too low. Unfolding at that mark folds straight back — but
        // with a mark above the width just shown not to work, so the same width cannot flip again.
        const first = nextCollapsedState({ collapsed: false, expandAt: 0 }, { wantedWidth: 420, givenWidth: 400, spilledWidth: 0, containerWidth: 700 });
        expect(first).toStrictEqual({ collapsed: true, expandAt: 720 });

        const unfolded = nextCollapsedState(first, { ...fitting, containerWidth: 720 });
        expect(unfolded.collapsed).toBe(false);

        const refolded = nextCollapsedState(unfolded, { wantedWidth: 420, givenWidth: 410, spilledWidth: 0, containerWidth: 720 });
        expect(refolded).toStrictEqual({ collapsed: true, expandAt: 730 });
        expect(nextCollapsedState(refolded, { ...fitting, containerWidth: 720 })).toStrictEqual(refolded);
    });
});

describe("CollapseOnOverflow", () => {
    let root: HTMLDivElement;
    let container: HTMLDivElement;

    beforeEach(() => {
        observers = [];
        globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
        root = document.createElement("div");
        container = document.createElement("div");
        document.body.append(root, container);
    });

    afterEach(() => {
        render(null, root);
        root.remove();
        container.remove();
    });

    it("draws the wide rendering while it fits, and clips it so that what it wants can be read off it", () => {
        renderChoice();

        const wrapper = root.querySelector(".tn-collapse-on-overflow");
        expect(wrapper?.textContent).toBe("wide");
        expect(wrapper?.classList.contains("tn-collapse-on-overflow-wide")).toBe(true);
        // Watched from both ends: what the control is given comes from the row it is in, and what
        // that row has to give comes from the container.
        expect(observers[0]?.observed).toStrictEqual([ wrapper, container ]);
    });

    it("folds when the wide rendering no longer fits, and lifts the clipping off the menu", () => {
        renderChoice();
        resize({ wantedWidth: 420, givenWidth: 380, containerWidth: 700 });

        const wrapper = root.querySelector(".tn-collapse-on-overflow");
        expect(wrapper?.textContent).toBe("folded");
        // The folded rendering is a dropdown, whose menu clipping would cut off at the control's edge.
        expect(wrapper?.classList.contains("tn-collapse-on-overflow-wide")).toBe(false);

        // Held folded at a width the wide rendering has already been shown not to fit, and let back
        // out once the container has grown by what was missing.
        resize({ wantedWidth: 90, givenWidth: 90, containerWidth: 700 });
        expect(root.querySelector(".tn-collapse-on-overflow")?.textContent).toBe("folded");
        resize({ wantedWidth: 90, givenWidth: 90, containerWidth: 740 });
        expect(root.querySelector(".tn-collapse-on-overflow")?.textContent).toBe("wide");
    });

    it("folds a row that its own bar will not squeeze, and so hangs past the container", () => {
        renderChoice();
        resize({ wantedWidth: 282, givenWidth: 282, spilledWidth: 93, containerWidth: 700 });

        expect(root.querySelector(".tn-collapse-on-overflow")?.textContent).toBe("folded");
    });

    it("stays folded without measuring anything where the caller says there is no room at all", () => {
        renderChoice(true);

        expect(root.querySelector(".tn-collapse-on-overflow")?.textContent).toBe("folded");
        expect(observers).toHaveLength(0);
    });

    /** Renders a control naming which of its two renderings is up. */
    function renderChoice(alwaysCollapsed?: boolean) {
        act(() => render(
            <CollapseOnOverflow container={{ current: container }} alwaysCollapsed={alwaysCollapsed}>
                {(collapsed) => <span>{collapsed ? "folded" : "wide"}</span>}
            </CollapseOnOverflow>,
            root));
    }

    /**
     * Hands the component a layout, happy-dom measuring everything as nought. The control is laid
     * against the container's right edge, `spilledWidth` putting it that far past it.
     */
    function resize({ wantedWidth, givenWidth, containerWidth, spilledWidth = 0 }: {
        wantedWidth: number;
        givenWidth: number;
        containerWidth: number;
        spilledWidth?: number;
    }) {
        const wrapper = root.querySelector(".tn-collapse-on-overflow") as HTMLElement;
        stateWidth(wrapper, "scrollWidth", wantedWidth);
        stateWidth(wrapper, "clientWidth", givenWidth);
        stateWidth(container, "clientWidth", containerWidth);
        stateBox(container, 0, containerWidth);
        stateBox(wrapper, containerWidth + spilledWidth - givenWidth, containerWidth + spilledWidth);
        act(() => observers.forEach((observer) => observer.callback()));
    }
});

function stateWidth(element: HTMLElement, property: "scrollWidth" | "clientWidth", value: number) {
    Object.defineProperty(element, property, { value, configurable: true });
}

function stateBox(element: HTMLElement, left: number, right: number) {
    element.getBoundingClientRect = () => ({ left, right }) as DOMRect;
}

let observers: ResizeObserverStub[] = [];

/** happy-dom has no ResizeObserver, and lays nothing out for one to report on. */
class ResizeObserverStub {
    observed: Element[] = [];

    constructor(readonly callback: () => void) {
        observers.push(this);
    }

    observe(element: Element) {
        this.observed.push(element);
    }

    unobserve() {}

    disconnect() {}
}
