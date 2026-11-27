import { vi } from "vitest";

/**
 * Stands in for the layout that happy-dom lacks: each character is 8px wide and 16px tall, lines
 * are 20px apart, and `breaks` holds the offset in the whole text at which each new line starts.
 */
export function stubTextLayout(element: HTMLElement, breaks: number[] = []) {
    const rangePrototype = Range.prototype as Partial<Range>;
    const offsetOf = (range: Range) => {
        let offset = range.startOffset;
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node && node !== range.startContainer; node = walker.nextNode()) {
            offset += (node as Text).data.length;
        }
        return offset;
    };
    const charRect = (offset: number) => {
        const line = breaks.filter((start) => start <= offset).length;
        const lineStart = line ? breaks[line - 1] : 0;
        return new DOMRect((offset - lineStart) * 8, line * 20, 8, 16);
    };
    rangePrototype.getBoundingClientRect = function (this: Range) {
        return charRect(offsetOf(this));
    };
    rangePrototype.getClientRects = function (this: Range) {
        const rects = [ 0, ...breaks ].map((start) => charRect(start));
        return Object.assign(rects, { item: (index: number) => rects[index] }) as unknown as DOMRectList;
    };
    const elementRect = vi.spyOn(element, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 80, 40));
    return () => {
        elementRect.mockRestore();
        delete rangePrototype.getBoundingClientRect;
        delete rangePrototype.getClientRects;
    };
}
