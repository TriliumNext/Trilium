/**
 * Drags with synthetic `DragEvent`s through CKEditor's real drag and drop pipeline, in the order a
 * pointer sends them.
 */

interface Point {
    clientX: number;
    clientY: number;
}

/** Starts a drag at `source`, with a `DataTransfer` that the drop reuses. */
export function startDrag(source: HTMLElement) {
    // A constructed `DataTransfer` ignores `effectAllowed` writes, and every drop becomes a copy.
    const dataTransfer = new DataTransfer();
    Object.defineProperty(dataTransfer, "effectAllowed", { value: "none", writable: true });
    source.dispatchEvent(new DragEvent("dragstart", {
        bubbles: true, cancelable: true, dataTransfer
    }));
    return dataTransfer;
}

/** Drags over `point`, drops there and ends the drag at `source`, as a move. */
export function drop(source: HTMLElement, dataTransfer: DataTransfer, point: Point) {
    const target = document.elementFromPoint(point.clientX, point.clientY) ?? document;
    const init = { bubbles: true, cancelable: true, dataTransfer, ...point };
    target.dispatchEvent(new DragEvent("dragover", init));
    target.dispatchEvent(new DragEvent("drop", init));
    // A constructed `DataTransfer` ignores `dropEffect` writes.
    Object.defineProperty(dataTransfer, "dropEffect", { value: "move" });
    source.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer }));
}

/** A point inside `element`, `fraction` of its height from its top. */
export function pointIn(element: Element, fraction: number): Point {
    const rect = element.getBoundingClientRect();
    return { clientX: rect.left + 5, clientY: rect.top + rect.height * fraction };
}
