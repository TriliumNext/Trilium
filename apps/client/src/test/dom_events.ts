/**
 * Teaches happy-dom the mouse `on*` properties every real browser exposes.
 *
 * Preact picks the event name to listen for by probing the element for the matching IDL property.
 * happy-dom's SVG (and some HTML) prototypes lack the mouse ones, so without this a `onMouseEnter`
 * prop registers a listener under a case-mangled name and dispatched events never reach it — the
 * component works in the browser but appears inert under test.
 *
 * Call from a spec's `beforeAll` when it dispatches mouse events at components.
 */
export function enableMouseEventProperties() {
    for (const prototype of [ SVGElement.prototype, HTMLElement.prototype ]) {
        for (const name of [ "onmouseenter", "onmouseleave", "onmousemove", "onclick" ]) {
            if (!(name in prototype)) {
                Object.defineProperty(prototype, name, { value: null, writable: true });
            }
        }
    }
}
