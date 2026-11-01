import "../theme/scrollable_bar.css";

import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { attachScrollableBar, createScrollableBar } from "./scrollable_bar.js";

const LABELS = { start: "Back", end: "Next" };

/** A bar 300px wide with `count` items 100px wide, attached to the document. */
function renderBar(count: number, dir: "ltr" | "rtl" = "ltr") {
    const { bar, viewport } = createScrollableBar(document, LABELS);
    bar.dir = dir;
    bar.style.width = "300px";
    for (let index = 0; index < count; index++) {
        viewport.append(createItem(`Item ${index}`, 100));
    }
    document.body.append(bar);
    const scrollableBar = attachScrollableBar(bar, viewport);
    onTestFinished(() => {
        scrollableBar.disconnect();
        bar.remove();
    });

    const [ start, end ] = bar.querySelectorAll("button");
    const items = [ ...viewport.children ] as HTMLElement[];
    return { bar, viewport, start, end, items, scrollableBar };
}

function createItem(text: string, width: number) {
    const item = document.createElement("span");
    item.textContent = text;
    item.style.flex = "none";
    item.style.width = `${width}px`;
    return item;
}

/** Presses `target` with the mouse button `button` and keeps it down. */
function hold(target: Element, button = 0) {
    const press = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button });
    target.dispatchEvent(press);
    onTestFinished(() => document.dispatchEvent(new PointerEvent("pointerup")));
    return press;
}

function wait(milliseconds: number) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function edgeOf(button: HTMLElement) {
    return button.parentElement as HTMLElement;
}

function isOverflowing(bar: HTMLElement) {
    return bar.classList.contains("scrollable-bar--overflowing");
}

/** How far `item` lies past the left and the right edge of `viewport`, rounded. */
function edgesOf(item: Element, viewport: Element) {
    const rect = item.getBoundingClientRect();
    const box = viewport.getBoundingClientRect();
    return [ Math.round(rect.left - box.left), Math.round(rect.right - box.right) ];
}

describe("scrollable bar", () => {
    afterEach(() => {
        document.body.classList.remove("motion-disabled");
        vi.restoreAllMocks();
    });

    it("builds a viewport between two edges, each with a button out of the tab order", () => {
        const { bar } = createScrollableBar(document, LABELS);

        expect([ ...bar.children ].map(child => child.className)).toEqual([
            "scrollable-bar-edge scrollable-bar-edge--start",
            "scrollable-bar-viewport",
            "scrollable-bar-edge scrollable-bar-edge--end"
        ]);
        const buttons = [ ...bar.querySelectorAll(":scope > .scrollable-bar-edge > button") ];
        expect(buttons).toHaveLength(2);
        for (const [ index, button ] of buttons.entries()) {
            const label = [ "Back", "Next" ][index];
            const icon = [ "bx-chevron-left", "bx-chevron-right" ][index];
            expect(button.className).toBe(`icon-action bx ${icon} scrollable-bar-button`);
            expect(button.type).toBe("button");
            expect(button.tabIndex).toBe(-1);
            expect(button.title).toBe(label);
            expect(button.getAttribute("aria-label")).toBe(label);
        }
    });

    it("shows the buttons while the items overflow, disabling one at a reached edge", async () => {
        const { bar, viewport, start, end } = renderBar(2);
        expect(isOverflowing(bar)).toBe(false);
        expect(getComputedStyle(edgeOf(start)).display).toBe("none");

        viewport.append(createItem("Item 2", 100), createItem("Item 3", 100));
        await expect.poll(() => isOverflowing(bar)).toBe(true);
        expect(getComputedStyle(edgeOf(start)).display).toBe("flex");
        for (const button of [ start, end ]) {
            const edge = edgeOf(button).getBoundingClientRect();
            const rect = button.getBoundingClientRect();
            expect([ edge.width, rect.width, rect.height ]).toEqual([ 36, 28, 28 ]);
            expect(rect.left - edge.left).toBe(edge.right - rect.right);
        }
        expect([ start.disabled, end.disabled ]).toEqual([ true, false ]);
        expect([ start, end ].map(button => button.classList.contains("disabled")))
            .toEqual([ true, false ]);

        viewport.scrollLeft = viewport.scrollWidth;
        await expect.poll(() => [ start.disabled, end.disabled ]).toEqual([ false, true ]);

        viewport.lastElementChild?.remove();
        viewport.lastElementChild?.remove();
        await expect.poll(() => isOverflowing(bar)).toBe(false);
    });

    it("hides the buttons once the items fit the bar without them", async () => {
        const { bar, viewport } = renderBar(4);
        viewport.lastElementChild?.remove();
        viewport.lastElementChild?.remove();
        viewport.append(createItem("Item 2", 80));
        await expect.poll(() => isOverflowing(bar)).toBe(false);

        viewport.append(createItem("Item 3", 120));
        await expect.poll(() => isOverflowing(bar)).toBe(true);
        bar.style.width = "380px";
        await wait(100);
        expect(isOverflowing(bar)).toBe(true);

        bar.style.width = "420px";
        await expect.poll(() => isOverflowing(bar)).toBe(false);
    });

    it("scrolls by most of its width toward the edge clicked, in either direction", async () => {
        document.body.classList.add("motion-disabled");
        for (const [ dir, sign ] of [ [ "ltr", 1 ], [ "rtl", -1 ] ] as const) {
            const { viewport, start, end, items } = renderBar(10, dir);
            const page = viewport.clientWidth * 0.8;

            items[0].click();
            edgeOf(start).click();
            expect(viewport.scrollLeft, dir).toBe(0);

            edgeOf(end).click();
            expect(viewport.scrollLeft, dir).toBeCloseTo(sign * page, 0);

            await expect.poll(() => start.disabled, dir).toBe(false);
            start.click();
            expect(viewport.scrollLeft, dir).toBeCloseTo(0, 0);
        }
    });

    it("scrolls while a button is held down, and skips the click that ends the hold", async () => {
        document.body.classList.add("motion-disabled");
        const { viewport, end } = renderBar(20);
        hold(end);
        await wait(200);
        expect(viewport.scrollLeft).toBe(0);

        await expect.poll(() => viewport.scrollLeft).toBeGreaterThan(0);
        const start = { time: performance.now(), position: viewport.scrollLeft };
        await wait(300);
        const elapsed = performance.now() - start.time;
        const speed = (viewport.scrollLeft - start.position) / elapsed * 1000;
        expect(speed).toBeGreaterThan(700);
        expect(speed).toBeLessThan(1100);

        document.dispatchEvent(new PointerEvent("pointerup"));
        const position = viewport.scrollLeft;
        end.click();
        await wait(100);
        expect(viewport.scrollLeft).toBe(position);

        end.click();
        expect(viewport.scrollLeft).toBeCloseTo(position + viewport.clientWidth * 0.8, 0);
    });

    it("stops a hold at the edge or a canceled pointer, and holds the main button", async () => {
        const { viewport, start, end } = renderBar(4);
        hold(end);
        await expect.poll(() => end.disabled).toBe(true);
        const position = viewport.scrollLeft;
        expect(position).toBe(viewport.scrollWidth - viewport.clientWidth);

        hold(start);
        await expect.poll(() => viewport.scrollLeft).toBeLessThan(position);
        document.dispatchEvent(new PointerEvent("pointercancel"));
        const stopped = viewport.scrollLeft;
        await wait(100);
        expect(viewport.scrollLeft).toBe(stopped);

        hold(start, 2);
        await wait(400);
        expect(viewport.scrollLeft).toBe(stopped);
    });

    it("scrolls smoothly, unless Trilium's animations or the system's motion are off", async () => {
        const { viewport, end } = renderBar(10);
        end.click();
        expect(viewport.scrollLeft).toBe(0);
        await expect.poll(() => Math.round(viewport.scrollLeft))
            .toBe(Math.round(viewport.clientWidth * 0.8));

        vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
        viewport.scrollLeft = 0;
        end.click();
        expect(window.matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
        expect(viewport.scrollLeft).toBeCloseTo(viewport.clientWidth * 0.8, 0);
    });

    it("reveals an item by the least distance, or its start when it is wider", async () => {
        document.body.classList.add("motion-disabled");
        const { viewport, items, scrollableBar } = renderBar(10);
        const wide = createItem("Wide", 400);
        viewport.append(wide);

        scrollableBar.reveal(items[5]);
        expect(edgesOf(items[5], viewport)[1]).toBe(0);

        scrollableBar.reveal(items[4]);
        expect(edgesOf(items[5], viewport)[1]).toBe(0);

        scrollableBar.reveal(items[1]);
        expect(edgesOf(items[1], viewport)[0]).toBe(0);

        scrollableBar.reveal(wide);
        expect(edgesOf(wide, viewport)[0]).toBe(0);

        scrollableBar.reveal(items[0]);
        scrollableBar.reveal(wide);
        expect(edgesOf(wide, viewport)[0]).toBe(0);

        document.body.classList.remove("motion-disabled");
        scrollableBar.reveal(items[0]);
        expect(edgesOf(wide, viewport)[0]).toBe(0);
        await expect.poll(() => edgesOf(items[0], viewport)[0]).toBe(0);

        scrollableBar.reveal(items[9], { isAnimated: false });
        expect(edgesOf(items[9], viewport)[1]).toBe(0);
    });

    it("reveals an item from its start right to left", () => {
        document.body.classList.add("motion-disabled");
        const { viewport, items, scrollableBar } = renderBar(10, "rtl");
        const wide = createItem("Wide", 400);
        viewport.append(wide);

        scrollableBar.reveal(items[5]);
        expect(edgesOf(items[5], viewport)[0]).toBe(0);

        scrollableBar.reveal(items[1]);
        expect(edgesOf(items[1], viewport)[1]).toBe(0);

        scrollableBar.reveal(items[2]);
        expect(edgesOf(items[1], viewport)[1]).toBe(0);

        for (const item of [ wide, items[0], wide ]) {
            scrollableBar.reveal(item);
            expect(edgesOf(item, viewport)[1]).toBe(0);
        }
    });

    it("keeps a press beside the viewport from taking the focus or reaching ancestors", () => {
        const { bar, end, items } = renderBar(10);
        const outside = vi.fn();
        document.body.addEventListener("pointerdown", outside);
        onTestFinished(() => document.body.removeEventListener("pointerdown", outside));

        for (const target of [ end, edgeOf(end), bar ]) {
            expect(hold(target).defaultPrevented).toBe(true);
            document.dispatchEvent(new PointerEvent("pointerup"));
        }
        expect(outside).not.toHaveBeenCalled();

        const itemPress = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
        items[0].dispatchEvent(itemPress);
        expect(itemPress.defaultPrevented).toBe(false);
        expect(outside).toHaveBeenCalledOnce();
        expect(bar.contains(document.activeElement)).toBe(false);
    });

    it("stops scrolling and watching once disconnected", async () => {
        const { bar, viewport, end, scrollableBar } = renderBar(10);
        expect(isOverflowing(bar)).toBe(true);

        scrollableBar.disconnect();
        expect(isOverflowing(bar)).toBe(false);
        end.click();
        expect(viewport.scrollLeft).toBe(0);
        viewport.append(createItem("Item 10", 100));
        await new Promise(resolve => requestAnimationFrame(resolve));
        expect(isOverflowing(bar)).toBe(false);
    });
});
