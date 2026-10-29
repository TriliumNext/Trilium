/**
 * Stands in for the CSS Custom Highlight API, which happy-dom does not implement: `Highlight` is a
 * `Set` of ranges and `CSS.highlights` a `Map` of them.
 */
export function stubHighlightApi() {
    class Highlight extends Set<AbstractRange> {
        priority = 0;
        type = "highlight";

        constructor(...ranges: AbstractRange[]) {
            super(ranges);
        }
    }

    Object.assign(globalThis, { Highlight });
    // happy-dom's `CSS` getter builds a new object on each read, so the registry goes on its prototype.
    Object.defineProperty(Object.getPrototypeOf(globalThis.CSS), "highlights", { value: new Map() });
}

/** The ranges of the highlight `name` that start under `root`, in the order they were added. */
export function highlightedRanges(name: string, root: Node = document.body) {
    return [ ...CSS.highlights.get(name) ?? [] ]
        .filter((range): range is Range => range instanceof Range && root.contains(range.startContainer));
}

/** The text of {@link highlightedRanges}. */
export function highlightedTexts(name: string, root: Node = document.body) {
    return highlightedRanges(name, root).map((range) => range.toString());
}
