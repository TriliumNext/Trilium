import "../theme/table_scroll.css";
import "../theme/table_sticky_header.css";

import editorStylesheetUrl from "ckeditor5/ckeditor5.css?url";
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";

import { applyTableScroll } from "./table_scroll_read_only.js";
import {
    applyStickyTableHeaders, EASING_PROPERTY, START_PROPERTY, StickyTableHeaders, TRAVEL_PROPERTY
} from "./table_sticky_header_read_only.js";

const SCROLLER_HEIGHT = 200;

describe("applyStickyTableHeaders", () => {
    const link = document.createElement("link");

    beforeAll(() => new Promise<void>((resolve, reject) => {
        link.rel = "stylesheet";
        link.href = editorStylesheetUrl;
        link.onload = () => resolve();
        link.onerror = () => reject(new Error("the editor stylesheet did not load"));
        document.head.appendChild(link);
    }));

    afterAll(() => {
        link.remove();
    });

    it("keeps the header rows at the top of the scrolled area until the table ends", async () => {
        const { scroller, content } = renderContent(tableFigure(2, 20, "Caption"));
        applyStickyTableHeaders(content);
        await settle();

        const { figure, table, thead } = parts(content);
        const header = thead.getBoundingClientRect();
        const tableBox = table.getBoundingClientRect();
        const start = header.top - figure.getBoundingClientRect().top;
        expect(start).toBeGreaterThan(10);
        expect(lengthOf(thead, START_PROPERTY)).toBeCloseTo(start, 1);
        expect(lengthOf(thead, TRAVEL_PROPERTY))
            .toBeCloseTo(tableBox.bottom - header.bottom - 1, 1);
        expect(thead.style.getPropertyValue(EASING_PROPERTY)).toBe("");
        expect(bordersOf(thead)).toBe("none");

        await scrollTo(scroller, offsetIn(scroller, thead) + 150);
        expect(topIn(scroller, thead)).toBeCloseTo(0, 0);
        expect(bordersOf(thead)).toBe("block");
        expect(getComputedStyle(thead).overflowAnchor).toBe("none");
        const hit = document.elementFromPoint(
            thead.getBoundingClientRect().left + 10, scroller.getBoundingClientRect().top + 5);
        expect(hit?.closest("thead")).toBe(thead);

        await scrollTo(scroller, offsetIn(scroller, table) + table.offsetHeight - 10);
        expect(thead.getBoundingClientRect().bottom)
            .toBeCloseTo(table.getBoundingClientRect().bottom - 1, 0);

        await scrollTo(scroller, 0);
        expect(getComputedStyle(thead).translate).toBe("none");
        expect(bordersOf(thead)).toBe("none");
    });

    it("leaves the header rows in place while `sticky-table-headers-disabled` is set", async () => {
        document.body.classList.add("sticky-table-headers-disabled");
        onTestFinished(() => document.body.classList.remove("sticky-table-headers-disabled"));
        const { scroller, content } = renderContent(tableFigure(1, 20));
        applyStickyTableHeaders(content);
        await settle();

        const { thead } = parts(content);
        await scrollTo(scroller, offsetIn(scroller, thead) + 150);
        expect(topIn(scroller, thead)).toBeCloseTo(-150, 0);
        expect(getComputedStyle(thead).translate).toBe("none");

        // Content already on screen follows the class.
        document.body.classList.remove("sticky-table-headers-disabled");
        await settle();
        expect(topIn(scroller, thead)).toBeCloseTo(0, 0);
    });

    it("measures the header rows again when the table grows while they stick", async () => {
        const { scroller, content } = renderContent(tableFigure(1, 20));
        applyStickyTableHeaders(content);
        await settle();

        const { table, thead } = parts(content);
        const start = thead.style.getPropertyValue(START_PROPERTY);
        const travel = lengthOf(thead, TRAVEL_PROPERTY);
        await scrollTo(scroller, offsetIn(scroller, thead) + 100);
        expect(getComputedStyle(thead).translate).not.toBe("none");

        const row = table.tBodies[0].rows[0];
        row.after(row.cloneNode(true));
        await settle();
        expect(thead.style.getPropertyValue(START_PROPERTY)).toBe(start);
        expect(lengthOf(thead, TRAVEL_PROPERTY)).toBeCloseTo(travel + row.offsetHeight, 0);
        expect(topIn(scroller, thead)).toBeCloseTo(0, 0);
    });

    it("stops measuring the header rows once disposed", async () => {
        const { content } = renderContent(tableFigure(1, 20));
        const dispose = applyStickyTableHeaders(content);
        await settle();

        const { table, thead } = parts(content);
        const travel = lengthOf(thead, TRAVEL_PROPERTY);
        dispose();
        const row = table.tBodies[0].rows[0];
        row.after(row.cloneNode(true));
        await settle();
        expect(lengthOf(thead, TRAVEL_PROPERTY)).toBe(travel);
    });

    it("sticks below the scroll padding of the scrolled area", async () => {
        const { scroller, content } = renderContent(tableFigure(1, 20));
        scroller.style.scrollPaddingTop = "30px";
        applyStickyTableHeaders(content);
        await settle();

        const { thead } = parts(content);
        await scrollTo(scroller, offsetIn(scroller, thead) + 100);
        expect(topIn(scroller, thead)).toBeCloseTo(30, 0);
    });

    it("moves the header rows by device pixels where scroll offsets are rounded", async () => {
        snapScrollOffsets();
        const { scroller, content, spacer } = renderContent(tableFigure(1, 20));
        scroller.style.scrollPaddingTop = "10px";
        spacer.style.height = "100.4px";
        applyStickyTableHeaders(content);
        await settle();

        const { figure, thead } = parts(content);
        const steps = lengthOf(thead, TRAVEL_PROPERTY) * SCALE;
        expect(steps).toBeCloseTo(Math.round(steps), 1);
        expect(thead.style.getPropertyValue(EASING_PROPERTY)).toBe(`steps(${Math.round(steps)})`);
        expect(stickOffsetOf(scroller, figure, 10) * SCALE % 1).toBeCloseTo(0.5, 1);

        for (const offset of [ 120, 121, 122 ]) {
            await scrollTo(scroller, offset);
            const shift = shiftOf(thead) * SCALE;
            expect(shift).toBeGreaterThan(0);
            expect(shift).toBeCloseTo(Math.round(shift), 1);
            expect(topIn(scroller, thead)).toBeCloseTo(10, 0);
        }
    });

    it("aligns the header rows again as their scroll container starts to scroll", async () => {
        snapScrollOffsets();
        const { scroller, content, spacer } = renderContent(tableFigure(1, 20));
        const dispose = applyStickyTableHeaders(content);
        await settle();

        const { figure, thead } = parts(content);
        const start = thead.style.getPropertyValue(START_PROPERTY);
        spacer.style.height = "100.4px";
        await settle();
        expect(thead.style.getPropertyValue(START_PROPERTY)).toBe(start);

        await scrollTo(scroller, 120);
        expect(thead.style.getPropertyValue(START_PROPERTY)).not.toBe(start);
        expect(stickOffsetOf(scroller, figure, 0) * SCALE % 1).toBeCloseTo(0.5, 1);

        dispose();
        const aligned = thead.style.getPropertyValue(START_PROPERTY);
        spacer.style.height = "100px";
        await scrollTo(scroller, 0);
        expect(thead.style.getPropertyValue(START_PROPERTY)).toBe(aligned);
    });

    it("aligns the header rows once per scroll of their scroll container", async () => {
        snapScrollOffsets();
        const { scroller, content, spacer } = renderContent(tableFigure(1, 20));
        onTestFinished(applyStickyTableHeaders(content));
        await settle();
        const { thead } = parts(content);
        const start = () => thead.style.getPropertyValue(START_PROPERTY);

        spacer.style.height = "100.4px";
        scroller.dispatchEvent(new Event("scroll"));
        await settle();
        const aligned = start();
        spacer.style.height = "100px";
        scroller.dispatchEvent(new Event("scroll"));
        await settle();
        expect(start()).toBe(aligned);

        scroller.dispatchEvent(new Event("scrollend"));
        scroller.dispatchEvent(new Event("scroll"));
        await settle();
        expect(start()).not.toBe(aligned);
    });

    it("aligns the header rows of a table that scrolls with the page", async () => {
        snapScrollOffsets();
        const content = document.createElement("div");
        content.className = "ck-content";
        content.innerHTML = `<div style="height:100.4px"></div>${tableFigure(1, 20)}`
            + "<div style=\"height:2000px\"></div>";
        document.body.appendChild(content);
        document.documentElement.style.scrollPaddingTop = "10.5px";
        window.scrollTo(0, 31);
        onTestFinished(() => {
            content.remove();
            document.documentElement.style.scrollPaddingTop = "";
            window.scrollTo(0, 0);
        });
        onTestFinished(applyStickyTableHeaders(content));
        await settle();

        const { figure, thead } = parts(content);
        expect(window.scrollY).toBe(31);
        const offset = figure.getBoundingClientRect().top + window.scrollY - 10.5
            + lengthOf(thead, START_PROPERTY);
        expect(offset * SCALE % 1).toBeCloseTo(0.5, 1);
    });

    it("keeps the header rows of a table that scrolls sideways in view", async () => {
        const html = tableFigure(1, 20, "Caption", "width:300%;");
        const { scroller, content } = renderContent(html);
        applyTableScroll(content);
        applyStickyTableHeaders(content);
        await settle();

        const { figure, thead } = parts(content);
        expect(getComputedStyle(figure).overflowX).toBe("auto");
        expect(lengthOf(thead, START_PROPERTY)).toBeCloseTo(
            thead.getBoundingClientRect().top - figure.getBoundingClientRect().top, 1);
        await scrollTo(scroller, offsetIn(scroller, thead) + 100);
        expect(topIn(scroller, thead)).toBeCloseTo(0, 0);
    });

    it("measures content attached after the call", async () => {
        const { scroller, content } = renderContent(tableFigure(1, 20));
        content.remove();
        applyStickyTableHeaders(content);
        await settle();
        const { thead } = parts(content);
        expect(thead.style.getPropertyValue(START_PROPERTY)).toBe("");

        scroller.appendChild(content);
        await settle();
        expect(thead.style.getPropertyValue(START_PROPERTY)).not.toBe("");
    });

    it("leaves out tables without header rows and layout tables", () => {
        const observe = vi.spyOn(ResizeObserver.prototype, "observe");
        onTestFinished(() => observe.mockRestore());
        const layout = tableFigure(1, 2).replace("class=\"table\"", "class=\"table layout-table\"");
        const { content } = renderContent(tableFigure(0, 2) + layout);

        applyStickyTableHeaders(content);
        expect(observe).not.toHaveBeenCalled();
    });

    it("stops measuring the tables removed from the container", async () => {
        const unobserve = vi.spyOn(ResizeObserver.prototype, "unobserve");
        const disconnect = vi.spyOn(ResizeObserver.prototype, "disconnect");
        onTestFinished(() => {
            unobserve.mockRestore();
            disconnect.mockRestore();
        });
        const { content } = renderContent(tableFigure(1, 2) + tableFigure(1, 2));
        const headers = new StickyTableHeaders();
        headers.observe(content);
        headers.observe(content);
        expect(unobserve).not.toHaveBeenCalled();

        const [ removed, kept ] = content.querySelectorAll("figure");
        const removedHead = parts(removed).thead;
        removed.remove();
        headers.observe(content);
        expect(unobserve.mock.calls).toEqual([ [ removed ], [ removedHead ] ]);

        parts(kept).thead.remove();
        await settle();
        headers.disconnect();
        expect(disconnect).toHaveBeenCalledOnce();
    });
});

const SCALE = 1.5;

/** Measures as Firefox needs, at a device pixel ratio of `SCALE`. */
function snapScrollOffsets() {
    vi.spyOn(CSS, "supports").mockReturnValue(true);
    vi.stubGlobal("devicePixelRatio", SCALE);
    onTestFinished(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });
}

/** A table figure with header rows and body rows, and a caption when `caption` is set. */
function tableFigure(headerRows: number, bodyRows: number, caption = "", style = "") {
    const row = (cell: string, index: number) => `<tr><${cell}>${cell} ${index}</${cell}>`
        + `<${cell}>Second</${cell}><${cell}>Third</${cell}></tr>`;
    const headRows = Array.from({ length: headerRows }, (_, index) => row("th", index)).join("");
    const head = headerRows ? `<thead>${headRows}</thead>` : "";
    const body = Array.from({ length: bodyRows }, (_, index) => row("td", index)).join("");
    const figcaption = caption ? `<figcaption>${caption}</figcaption>` : "";
    return `<figure class="table" style="${style}"><table>${head}<tbody>${body}</tbody></table>`
        + `${figcaption}</figure>`;
}

/** Renders `html` as content in a scrolled area with room above and below it. */
function renderContent(html: string) {
    const scroller = document.createElement("div");
    scroller.style.cssText = "position:fixed;top:0;left:0;"
        + `height:${SCROLLER_HEIGHT}px;width:400px;overflow:auto;`;
    const content = document.createElement("div");
    content.className = "ck-content";
    const spacer = document.createElement("div");
    spacer.style.height = "100px";
    content.innerHTML = `${html}<div style="height:${SCROLLER_HEIGHT * 2}px"></div>`;
    content.prepend(spacer);
    scroller.appendChild(content);
    document.body.appendChild(scroller);
    onTestFinished(() => scroller.remove());
    return { scroller, content, spacer };
}

function parts(container: Element) {
    const figure = container.matches("figure") ? container : container.querySelector("figure");
    const table = figure?.querySelector<HTMLTableElement>(":scope > table");
    const thead = table?.querySelector<HTMLElement>(":scope > thead");
    if (!(figure instanceof HTMLElement) || !table || !thead) {
        throw new Error("The content has no table with header rows.");
    }
    return { figure, table, thead };
}

function lengthOf(element: HTMLElement, property: string) {
    return parseFloat(element.style.getPropertyValue(property));
}

function bordersOf(thead: HTMLElement) {
    const cell = thead.querySelector("th");
    if (!cell) {
        throw new Error("The header rows have no cell.");
    }
    return getComputedStyle(cell, "::before").display;
}

/** The distance from the top of `scroller` to `element`, as laid out without scrolling. */
function offsetIn(scroller: HTMLElement, element: HTMLElement) {
    return element.getBoundingClientRect().top - scroller.getBoundingClientRect().top
        + scroller.scrollTop;
}

/** The scroll offset at which the header rows of `figure` start to move. */
function stickOffsetOf(scroller: HTMLElement, figure: HTMLElement, padding: number) {
    return offsetIn(scroller, figure) - padding + lengthOf(parts(figure).thead, START_PROPERTY);
}

function shiftOf(element: HTMLElement) {
    return parseFloat(getComputedStyle(element).translate.split(" ")[1] ?? "0");
}

/** The distance from the top of `scroller` to where `element` is drawn. */
function topIn(scroller: HTMLElement, element: HTMLElement) {
    return element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
}

async function scrollTo(scroller: HTMLElement, top: number) {
    scroller.scrollTop = top;
    await settle();
}

/** Waits for a resize to be observed, and for the frame in which the header rows are measured. */
async function settle() {
    for (let frame = 0; frame < 3; frame++) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
    }
}
