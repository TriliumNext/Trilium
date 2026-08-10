import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGrowsUpwards } from "./grows_upwards";

describe("useGrowsUpwards", () => {
    /** A pane that scrolls, the thing being stood on, and the overlay measured against them. */
    let pane: HTMLElement;
    let anchor: HTMLElement;
    let overlay: HTMLElement | null;
    /** The observer's callback, this being how the element says it has changed size. */
    let sizeChanged: (() => void) | undefined;
    let growsUpwards: boolean | undefined;

    function Probe() {
        const ref = useRef<HTMLDivElement>(null);
        growsUpwards = useGrowsUpwards(ref);
        return <div ref={ref} />;
    }

    beforeEach(() => {
        vi.stubGlobal("ResizeObserver", class {
            constructor(callback: () => void) {
                sizeChanged = callback;
            }
            observe() {}
            disconnect() {}
        });

        pane = document.createElement("div");
        // What makes it the pane: the walk upwards stops at the first thing that cuts off overflow.
        pane.style.overflowY = "auto";
        anchor = document.createElement("div");
        pane.appendChild(anchor);
        document.body.appendChild(pane);

        growsUpwards = undefined;
        sizeChanged = undefined;
        overlay = null;
    });

    afterEach(() => {
        render(null, anchor);
        pane.remove();
        vi.unstubAllGlobals();
    });

    // Nothing is laid out under happy-dom, so each test states the geometry it is describing: where
    // the pane and the thing being stood on are, and how tall the overlay has grown.
    function spans(element: HTMLElement, top: number, bottom: number) {
        element.getBoundingClientRect = () => ({ top, bottom, height: bottom - top }) as DOMRect;
    }

    function standsAt({ paneTop = 0, paneBottom = 500, anchorTop = 100, anchorBottom = 130, height = 60 }) {
        spans(pane, paneTop, paneBottom);
        spans(anchor, anchorTop, anchorBottom);
        if (overlay) {
            Object.defineProperty(overlay, "offsetHeight", { value: height, configurable: true });
        }
    }

    async function mount(geometry: Parameters<typeof standsAt>[0]) {
        standsAt(geometry);
        await act(async () => render(<Probe />, anchor));
        overlay = anchor.querySelector("div");
        // The overlay only exists once rendered, so its height is given now and measured again.
        standsAt(geometry);
        await act(async () => sizeChanged?.());
    }

    it("stands as it is while there is room below it, and turns round once there is not", async () => {
        // 60 tall from a cell at 100 reaches 160, well inside a pane ending at 500.
        await mount({ paneBottom: 500 });
        expect(growsUpwards).toBe(false);

        // Scrolled until the pane's foot is above where the overlay would reach: anchored by its own
        // foot instead, it runs from 70 to 130 — over the rows above, inside the pane.
        spans(pane, 0, 140);
        await act(async () => {
            pane.dispatchEvent(new Event("scroll"));
        });
        expect(growsUpwards).toBe(true);
    });

    it("stays as it is where it would fit neither way", async () => {
        // A pane spanning 100..140 is shorter than the overlay, so turning round would only trade
        // one clipped end for the other — and the head is the end worth showing.
        await mount({ paneTop: 100, paneBottom: 140, anchorTop: 100, anchorBottom: 130, height: 60 });
        expect(growsUpwards).toBe(false);
    });

    it("measures again as the overlay grows, a line at a time", async () => {
        await mount({ paneBottom: 200, height: 60 });
        expect(growsUpwards).toBe(false);

        // A chip taken wraps onto another line, and now it reaches past the pane's foot.
        Object.defineProperty(overlay, "offsetHeight", { value: 120, configurable: true });
        await act(async () => sizeChanged?.());
        expect(growsUpwards).toBe(true);
    });

    it("waits for the overlay to be put in the document before deciding anything", async () => {
        // Tabulator builds an editor and hands it over, putting it in a cell only afterwards — so
        // there is a moment where nothing above it says what room there is.
        const detached = document.createElement("div");
        spans(detached, 100, 130);
        await act(async () => render(<Probe />, detached));
        overlay = detached.querySelector("div");
        standsAt({ paneBottom: 140 });
        Object.defineProperty(overlay, "offsetHeight", { value: 60, configurable: true });
        await act(async () => sizeChanged?.());
        expect(growsUpwards).toBe(false);

        // Put in the pane at last, which is a change of size in itself.
        pane.appendChild(detached);
        await act(async () => sizeChanged?.());
        expect(growsUpwards).toBe(true);

        render(null, detached);
    });
});
