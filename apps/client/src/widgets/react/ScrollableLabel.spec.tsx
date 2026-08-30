import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import ScrollableLabel from "./ScrollableLabel";

let container: HTMLDivElement | undefined;

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
});

/**
 * happy-dom lays nothing out, so the metrics the component reads are given directly. `scrollLeft` is
 * writable already; the two widths are not, and stand for a line of the given length in a 100px box.
 */
function renderLabel(text: string, scrollWidth: number, clientWidth = 100, autoScroll = false) {
    container = document.body.appendChild(document.createElement("div"));
    render(<ScrollableLabel autoScroll={autoScroll}>{text}</ScrollableLabel>, container);

    const label = container.querySelector<HTMLDivElement>(".scrollable-label");

    if (!label) {
        throw new Error("the label did not render");
    }

    Object.defineProperty(label, "scrollWidth", { value: scrollWidth, configurable: true });
    Object.defineProperty(label, "clientWidth", { value: clientWidth, configurable: true });

    return label;
}

/**
 * The component measures on mount and on every scroll; a scroll is how the test asks it to re-read.
 * Awaited because the classes are state set from the handler, which Preact renders on a microtask.
 */
async function scrollTo(label: HTMLDivElement, scrollLeft: number) {
    label.scrollLeft = scrollLeft;
    label.dispatchEvent(new Event("scroll"));

    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ScrollableLabel", () => {
    it("fades whichever end the line carries on past, and neither where it fits", async () => {
        const label = renderLabel("a name far longer than its box", 300);

        // Sitting at the start: the end continues, nothing is cut off behind.
        await scrollTo(label, 0);
        expect(label.classList.contains("scrollable-label-fade-start")).toBe(false);
        expect(label.classList.contains("scrollable-label-fade-end")).toBe(true);

        // Part way along: cut off at both ends.
        await scrollTo(label, 100);
        expect(label.classList.contains("scrollable-label-fade-start")).toBe(true);
        expect(label.classList.contains("scrollable-label-fade-end")).toBe(true);

        // Scrolled to the end: only what is behind is cut off.
        await scrollTo(label, 200);
        expect(label.classList.contains("scrollable-label-fade-start")).toBe(true);
        expect(label.classList.contains("scrollable-label-fade-end")).toBe(false);
    });

    it("takes a right-to-left line's negative offsets as the same distance travelled", async () => {
        const label = renderLabel("a right-to-left name", 300);

        await scrollTo(label, -100);
        expect(label.classList.contains("scrollable-label-fade-start")).toBe(true);
        expect(label.classList.contains("scrollable-label-fade-end")).toBe(true);

        await scrollTo(label, -200);
        expect(label.classList.contains("scrollable-label-fade-start")).toBe(true);
        expect(label.classList.contains("scrollable-label-fade-end")).toBe(false);
    });

    it("walks an auto-scrolling label at its own pace, and stops it at the end", () => {
        vi.useFakeTimers();

        try {
            // 200px to travel at 30px a second: a second in, a fraction of the way along; a minute
            // in, sitting at the end rather than anywhere past it.
            const label = renderLabel("a name that reads itself out", 300, 100, true);

            vi.advanceTimersByTime(1000);
            expect(label.scrollLeft).toBeGreaterThan(20);
            expect(label.scrollLeft).toBeLessThan(40);

            vi.advanceTimersByTime(60_000);
            expect(label.scrollLeft).toBe(200);
        } finally {
            vi.useRealTimers();
        }
    });

    it("hands an auto-scrolling label over for good once the reader touches it", () => {
        vi.useFakeTimers();

        try {
            const label = renderLabel("a name the reader takes over", 300, 100, true);

            vi.advanceTimersByTime(1000);
            label.dispatchEvent(new Event("pointerdown", { bubbles: true }));

            const handedOverAt = label.scrollLeft;

            // Left exactly where the reader took it: the walk does not resume, and does not finish
            // the line off from under them.
            vi.advanceTimersByTime(10_000);
            expect(label.scrollLeft).toBe(handedOverAt);
        } finally {
            vi.useRealTimers();
        }
    });

    it("keeps the line where the reader left it when the box is resized under them", async () => {
        vi.useFakeTimers();

        try {
            const label = renderLabel("a name the reader takes over", 300, 100, true);

            vi.advanceTimersByTime(1000);
            label.dispatchEvent(new Event("pointerdown", { bubbles: true }));

            const handedOverAt = label.scrollLeft;

            // The box narrows, as it does on a rotation or when a keyboard opens: the line is longer
            // against it than it was, which is what the walk watches for. It must not take it back.
            Object.defineProperty(label, "clientWidth", { value: 60, configurable: true });
            label.dispatchEvent(new Event("scroll"));
            await vi.advanceTimersByTimeAsync(1000);

            expect(label.scrollLeft).toBe(handedOverAt);
        } finally {
            vi.useRealTimers();
        }
    });

    it("does not walk a label at all where motion has been asked against", () => {
        const reduced = vi.spyOn(window, "matchMedia").mockReturnValue(
            { matches: true } as unknown as MediaQueryList);

        vi.useFakeTimers();

        try {
            const label = renderLabel("a name that would otherwise read itself out", 300, 100, true);

            vi.advanceTimersByTime(5000);

            expect(label.scrollLeft).toBe(0);
        } finally {
            vi.useRealTimers();
            reduced.mockRestore();
        }
    });

    it("leaves a label that fits alone, fading nothing", async () => {
        const label = renderLabel("short", 100);

        await scrollTo(label, 0);
        expect(label.classList.contains("scrollable-label-fade-start")).toBe(false);
        expect(label.classList.contains("scrollable-label-fade-end")).toBe(false);
    });
});
