import { type ComponentChildren, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import ScrollableLabel, { mountScrollableLabel } from "./ScrollableLabel";

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
function renderLabel(
    text: ComponentChildren, scrollWidth: number, clientWidth = 100, autoScroll = false
) {
    const mountPoint = document.body.appendChild(document.createElement("div"));
    container = mountPoint;
    // Flushed here: the fade attaches its listeners from an effect, which Preact defers past the
    // render, and a test that scrolled before that would be scrolling at nothing.
    act(() => {
        render(<ScrollableLabel autoScroll={autoScroll}>{text}</ScrollableLabel>, mountPoint);
    });

    const label = mountPoint.querySelector<HTMLDivElement>(".scrollable-label");

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

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

/** Dispatches a pointer event of the primary mouse button, held down, at `clientX`. */
function pointer(target: Element, type: string, clientX: number, init: PointerEventInit = {}) {
    target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, clientX, ...init
    }));
}

/** Dispatches a cancelable `type` event on `target` and tells whether the label canceled it. */
function isPrevented(target: Element, type: string) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
}

describe("ScrollableLabel", () => {
    it("fades whichever end the line carries on past, and neither where it fits", async () => {
        const label = renderLabel("a name far longer than its box", 300);

        // Sitting at the start: the end continues, nothing is cut off behind.
        await scrollTo(label, 0);
        expect(label.classList.contains("scroll-fade-start")).toBe(false);
        expect(label.classList.contains("scroll-fade-end")).toBe(true);

        // Part way along: cut off at both ends.
        await scrollTo(label, 100);
        expect(label.classList.contains("scroll-fade-start")).toBe(true);
        expect(label.classList.contains("scroll-fade-end")).toBe(true);

        // Scrolled to the end: only what is behind is cut off.
        await scrollTo(label, 200);
        expect(label.classList.contains("scroll-fade-start")).toBe(true);
        expect(label.classList.contains("scroll-fade-end")).toBe(false);
    });

    it("takes a right-to-left line's negative offsets as the same distance travelled", async () => {
        const label = renderLabel("a right-to-left name", 300);

        await scrollTo(label, -100);
        expect(label.classList.contains("scroll-fade-start")).toBe(true);
        expect(label.classList.contains("scroll-fade-end")).toBe(true);

        await scrollTo(label, -200);
        expect(label.classList.contains("scroll-fade-start")).toBe(true);
        expect(label.classList.contains("scroll-fade-end")).toBe(false);
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

    it("scrolls with a mouse dragged along it, in place of a native drag or selection", () => {
        const label = renderLabel(<span className="text">a name longer than its box</span>, 300);
        const text = label.querySelector(".text");
        expect(text).not.toBeNull();
        if (!text) return;
        const click = vi.fn();
        label.parentElement?.addEventListener("click", click);

        pointer(text, "pointerdown", 100);
        expect(isPrevented(text, "dragstart")).toBe(true);
        expect(label.hasAttribute("data-pressed")).toBe(true);
        pointer(text, "pointermove", 98);
        expect(label.scrollLeft).toBe(0);
        expect(label.hasPointerCapture(1)).toBe(false);

        pointer(text, "pointermove", 40);
        expect(label.scrollLeft).toBe(60);
        expect(label.hasPointerCapture(1)).toBe(true);
        pointer(label, "pointermove", 70);
        expect(label.scrollLeft).toBe(30);
        pointer(label, "pointerup", 70);
        expect(label.hasAttribute("data-pressed")).toBe(false);
        expect(isPrevented(label, "click")).toBe(true);
        expect(click).not.toHaveBeenCalled();

        // A canceled drag stops there.
        pointer(text, "pointerdown", 70);
        pointer(text, "pointermove", 20);
        pointer(text, "pointercancel", 20);
        pointer(text, "pointermove", 0);
        expect(label.scrollLeft).toBe(80);
        expect(label.hasAttribute("data-pressed")).toBe(false);
        expect(isPrevented(text, "click")).toBe(false);

        // A press that stays put is a click.
        pointer(text, "pointerdown", 0);
        pointer(text, "pointerup", 0);
        expect(isPrevented(text, "click")).toBe(false);

        // So is a tap after a drag whose click never came.
        pointer(text, "pointerdown", 20);
        pointer(text, "pointermove", 0);
        pointer(text, "pointerup", 0);
        pointer(text, "pointerdown", 0, { pointerType: "touch" });
        pointer(text, "pointerup", 0, { pointerType: "touch" });
        expect(isPrevented(text, "click")).toBe(false);
        expect(click).toHaveBeenCalledTimes(3);
        expect(label.scrollLeft).toBe(100);
    });

    it("forgets a press released away from it before it dragged", () => {
        const label = renderLabel("a name longer than its box", 300);

        pointer(label, "pointerdown", 100);
        pointer(label, "pointermove", 40, { buttons: 0 });
        expect(label.scrollLeft).toBe(0);
        expect(isPrevented(label, "dragstart")).toBe(false);
        expect(label.hasAttribute("data-pressed")).toBe(false);
    });

    it("leaves the presses of a touch, another button, or on a label that fits alone", () => {
        const presses: [ number, PointerEventInit ][] = [
            [ 300, { pointerType: "touch" } ],
            [ 300, { button: 1 } ],
            [ 100, {} ]
        ];

        for (const [ scrollWidth, init ] of presses) {
            const label = renderLabel("a name", scrollWidth);
            pointer(label, "pointerdown", 100, init);
            expect(isPrevented(label, "dragstart")).toBe(false);
            expect(label.hasAttribute("data-pressed")).toBe(false);
            pointer(label, "pointermove", 40, init);
            expect(label.scrollLeft).toBe(0);
            pointer(label, "pointerup", 40, init);
            expect(isPrevented(label, "click")).toBe(false);

            const mountPoint = label.parentElement;
            if (mountPoint) {
                act(() => render(null, mountPoint));
                mountPoint.remove();
            }
        }
    });

    it("leaves a label that fits alone, fading nothing", async () => {
        const label = renderLabel("short", 100);

        await scrollTo(label, 0);
        expect(label.classList.contains("scroll-fade-start")).toBe(false);
        expect(label.classList.contains("scroll-fade-end")).toBe(false);
    });
});

describe("mountScrollableLabel", () => {
    it("moves the content of an element into a label, and back once disposed of", () => {
        const element = document.body.appendChild(document.createElement("p"));
        element.innerHTML = "Long <b>title</b>";
        const [ text, bold ] = element.childNodes;

        let dispose = () => {};
        act(() => {
            dispose = mountScrollableLabel(element);
        });
        const content = element.querySelector(":scope > .scrollable-label > span");
        expect(content?.childNodes[0]).toBe(text);
        expect(content?.childNodes[1]).toBe(bold);

        const replacement = document.createElement("i");
        bold.replaceWith(replacement);
        act(() => dispose());
        expect([ ...element.childNodes ]).toEqual([ text, replacement ]);
        element.remove();
    });
});
