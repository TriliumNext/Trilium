/**
 * Measures the header rows of content tables for `table_sticky_header.css`, which keeps them at
 * the top of the scrolled area while the rest of their table passes under them.
 *
 * The module imports nothing from CKEditor, so pages that only display content can load it.
 */

/** The distance from the top of the figure to the header rows, set on the `thead`. */
export const START_PROPERTY = "--table-header-start";

/** The distance that the header rows move while they stick, set on the `thead`. */
export const TRAVEL_PROPERTY = "--table-header-travel";

/** The timing function of the header rows, set on the `thead` where `snapsScrollOffsets()`. */
export const EASING_PROPERTY = "--table-header-easing";

/**
 * In device pixels; wider than the rounding of the lengths to 0.01px and of Gecko's 1/60px layout
 * unit together, up to a device pixel ratio of 2.
 */
const TIE_MARGIN = 1 / 32;

/**
 * Keeps the header rows of the tables in `container` in view while it scrolls. Returns a function
 * that stops measuring them.
 */
export function applyStickyTableHeaders(container: Element) {
    const headers = new StickyTableHeaders();
    headers.observe(container);
    return () => headers.disconnect();
}

/**
 * Measures header rows again whenever their figure or the rows themselves change size, and, where
 * `snapsScrollOffsets()`, whenever their scroll container starts to scroll.
 */
export class StickyTableHeaders {

    private observer: ResizeObserver | undefined;

    private readonly observed = new Set<Element>();

    /** The figures to measure in the next animation frame. */
    private readonly pending = new Set<Element>();

    /** The scroll containers between their first `scroll` event and their `scrollend` event. */
    private readonly scrolling = new Set<Node>();

    private frame: number | undefined;

    /**
     * Starts measuring the header rows in `container` that are not measured yet, and stops
     * measuring the ones removed from the document.
     */
    observe(container: Element) {
        for (const element of this.observed) {
            if (!element.isConnected) {
                this.observer?.unobserve(element);
                this.observed.delete(element);
            }
        }

        const figures = container.querySelectorAll("figure.table:not(.layout-table)");
        for (const figure of figures) {
            const thead = figure.querySelector(":scope > table > thead");
            if (thead) {
                this.watch(figure);
                this.watch(thead);
            }
        }
    }

    disconnect() {
        this.observer?.disconnect();
        this.observer = undefined;
        document.removeEventListener("scroll", this.onScroll, { capture: true });
        document.removeEventListener("scrollend", this.onScrollEnd, { capture: true });
        this.observed.clear();
        this.pending.clear();
        this.scrolling.clear();
    }

    private watch(element: Element) {
        if (this.observed.has(element)) {
            return;
        }

        if (!this.observer) {
            this.observer = new ResizeObserver((entries) => {
                this.schedule(entries.map(({ target }) => target));
            });
            if (snapsScrollOffsets()) {
                const options = { capture: true, passive: true };
                document.addEventListener("scroll", this.onScroll, options);
                document.addEventListener("scrollend", this.onScrollEnd, options);
            }
        }
        this.observer.observe(element);
        this.observed.add(element);
    }

    /**
     * `measure()` aligns the steps to where the table sits, which can change without a resize. A
     * listener on `document` receives the events of its nodes only.
     */
    private readonly onScroll = (event: Event) => {
        const target = event.target as Node;
        if (!this.scrolling.has(target)) {
            this.scrolling.add(target);
            this.schedule([ ...this.observed ].filter((element) => target.contains(element)));
        }
    };

    private readonly onScrollEnd = (event: Event) => {
        this.scrolling.delete(event.target as Node);
    };

    /** Measures the figures of `elements` in the next animation frame. */
    private schedule(elements: Element[]) {
        for (const element of elements) {
            const figure = element.closest("figure");
            if (figure) {
                this.pending.add(figure);
            }
        }

        // Chromium drops a range change made in the frame that creates the animation.
        if (this.pending.size) {
            this.frame ??= requestAnimationFrame(() => this.measurePending());
        }
    }

    private measurePending() {
        this.frame = undefined;
        for (const figure of this.pending) {
            if (figure.isConnected) {
                measure(figure);
            }
        }
        this.pending.clear();
    }

}

/**
 * The bottom of the header rows of `table` in the viewport while they stick, or `null` while they
 * rest at the top of the table.
 */
export function getStuckHeaderBottom(table: Element) {
    const thead = table.querySelector<HTMLElement>(":scope > thead");
    return thead && getShift(thead) > 0 ? thead.getBoundingClientRect().bottom : null;
}

/**
 * Sets the start, the travel and, where `snapsScrollOffsets()`, the steps of the header rows,
 * measured without the shift of sticking.
 */
function measure(figure: Element) {
    const table = figure.querySelector(":scope > table");
    const thead = table?.querySelector<HTMLElement>(":scope > thead");
    if (!table || !thead) {
        return;
    }

    const shift = getShift(thead);
    const header = thead.getBoundingClientRect();
    const top = header.top - shift;
    let start = top - figure.getBoundingClientRect().top;
    // Leaves room for the 1px that the borders of `th::before` reach past the cells.
    let travel = table.getBoundingClientRect().bottom - (header.bottom - shift) - 1;
    if (snapsScrollOffsets()) {
        // Steps where WebRender's rounded scroll offset changes, half a device pixel past a whole
        // one, less `TIE_MARGIN` so that an offset right on the half rounds up in both.
        const scale = devicePixelRatio;
        const offset = getStickOffset(figure, top);
        start += (Math.round(offset * scale) - 0.5 - TIE_MARGIN) / scale - offset;
        const steps = Math.floor(travel * scale);
        travel = steps / scale;
        setValue(thead, EASING_PROPERTY, `steps(${Math.max(steps, 1)})`);
    }
    setValue(thead, START_PROPERTY, toPixels(start));
    setValue(thead, TRAVEL_PROPERTY, toPixels(travel));
}

/**
 * Whether the browser rounds scroll offsets to device pixels but moves a scroll-driven `translate`
 * by the exact offset, as WebRender does, so the header rows must move by whole device pixels.
 */
function snapsScrollOffsets() {
    return CSS.supports("-moz-appearance", "none");
}

/**
 * The scroll offset at which `top`, a position in the viewport, reaches the scroll padding of the
 * scroll container of `figure`, which is where `view-timeline-inset: auto` puts the timeline.
 */
function getStickOffset(figure: Element, top: number) {
    const scroller = getScrollContainer(figure);
    const style = getComputedStyle(scroller ?? document.documentElement);
    const padding = parseFloat(style.scrollPaddingTop) || 0;
    if (!scroller) {
        return window.scrollY + top - padding;
    }

    const scrollport = scroller.getBoundingClientRect().top + scroller.clientTop;
    return scroller.scrollTop + top - scrollport - padding;
}

/** The nearest ancestor of `element` that is a scroll container, or `null` for the viewport. */
function getScrollContainer(element: Element) {
    let parent = element.parentElement;
    while (parent && parent !== document.body) {
        const { overflowY } = getComputedStyle(parent);
        if (overflowY !== "visible" && overflowY !== "clip") {
            return parent;
        }
        parent = parent.parentElement;
    }
    return null;
}

/** The vertical `translate` that the running animation gives `element`. */
function getShift(element: HTMLElement) {
    const [ , y = "0" ] = getComputedStyle(element).translate.split(" ");
    return parseFloat(y);
}

function toPixels(length: number) {
    return `${Math.round(length * 100) / 100}px`;
}

/** Sets a custom property, leaving the style alone when the value is the same. */
function setValue(element: HTMLElement, property: string, value: string) {
    if (element.style.getPropertyValue(property) !== value) {
        element.style.setProperty(property, value);
    }
}
