/** Geometry that happy-dom does not lay out, set on elements by hand. */
export interface StubbedBox {
    /** Client Y of the top of the border box, read anew each time when given as a function. */
    top?: number | (() => number);
    height?: number;
    width?: number;
    clientHeight?: number;
    scrollHeight?: number;
    scrollTop?: number;
}

/**
 * Gives `element` a bounding rectangle and scroll sizes. Each read of the rectangle is counted in
 * `rectReads`, by element. `scrollTop` stays writable, and `scrollTo()` and `scrollBy()` move it
 * and record the call in `scrollCalls`.
 */
export function stubBox(element: Element, box: StubbedBox) {
    const { top = 0, height = 0, width = 100 } = box;
    element.getBoundingClientRect = () => {
        rectReads.set(element, (rectReads.get(element) ?? 0) + 1);
        return new DOMRect(0, typeof top === "function" ? top() : top, width, height);
    };
    let scrollTop = box.scrollTop ?? 0;
    define(element, "clientHeight", () => box.clientHeight ?? height);
    define(element, "scrollHeight", () => box.scrollHeight ?? box.clientHeight ?? height);
    Object.defineProperty(element, "scrollTop", {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
            scrollTop = value;
        }
    });
    element.scrollTo = ((options: ScrollToOptions) => {
        scrollCalls.push({ element, method: "scrollTo", options });
        scrollTop = options.top ?? scrollTop;
    }) as Element["scrollTo"];
    element.scrollBy = ((options: ScrollToOptions) => {
        scrollCalls.push({ element, method: "scrollBy", options });
        scrollTop += options.top ?? 0;
    }) as Element["scrollBy"];
}

export const rectReads = new Map<Element, number>();
export const scrollCalls: {
    element: Element;
    method: "scrollTo" | "scrollBy";
    options: ScrollToOptions;
}[] = [];

/** Forgets the reads and the scrolls recorded so far. */
export function resetLayoutRecords() {
    rectReads.clear();
    scrollCalls.length = 0;
}

function define(element: Element, name: string, get: () => number) {
    Object.defineProperty(element, name, { configurable: true, get });
}
