import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import { applyTabs, getTabTitle } from "../tabs/tabs_read_only.js";
import { getBlockRangeElements, showBlockReference } from "./block_reference_read_only.js";

const SPACER = "<div style=\"height: 1000px\"></div>";

let scrollBy: MockInstance<Element["scrollBy"]>;
let mounted: HTMLElement[] = [];

beforeEach(() => {
    vi.useFakeTimers();
    // Scrolls at once instead of smoothly, so that the specs can measure where the blocks land.
    scrollBy = vi.spyOn(Element.prototype, "scrollBy")
        .mockImplementation(function (this: Element, ...args: unknown[]) {
            this.scrollTop += (args[0] as ScrollToOptions).top ?? 0;
        });
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    for (const element of mounted) {
        element.remove();
    }
    mounted = [];
    document.documentElement.scrollTop = 0;
});

describe("showBlockReference", () => {
    it("opens the collapsed blocks around a block and flashes it for a moment", () => {
        const container = buildContainer(
            "<details><summary>s1</summary><details><summary>s2</summary>"
            + "<p data-trilium-block-id=\"a\">A</p></details></details>"
        );

        expect(showBlockReference(container, "a")).toBe(true);

        expect([ ...container.querySelectorAll("details") ].map((details) => details.open))
            .toEqual([ true, true ]);
        expect(scrollBy).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ behavior: "smooth" }));
        expect(getFlashed(container)).toEqual([ "A" ]);

        vi.advanceTimersByTime(1500);
        expect(getFlashed(container)).toEqual([]);
    });

    it("centers blocks that fit, keeping at least 15% of the scroll container above them", () => {
        const scroller = mountScroller(
            SPACER + block("short", 100)
            + SPACER + block("almost", 350)
            + SPACER + block("tall", 600)
            + SPACER + block("from", 50) + "<div style=\"height: 100px\"></div>" + block("to", 50)
            + SPACER
        );

        showBlockReference(scroller, "short");
        expect(getOffset(scroller, "short")).toBeCloseTo(150);

        showBlockReference(scroller, "almost");
        expect(getOffset(scroller, "almost")).toBeCloseTo(60);

        showBlockReference(scroller, "tall");
        expect(getOffset(scroller, "tall")).toBeCloseTo(60);

        showBlockReference(scroller, "from:to");
        expect(getOffset(scroller, "from")).toBeCloseTo(100);
    });

    it("opens a collapsed block around the end of a range before measuring the range", () => {
        // Some browsers give the content of a closed `<details>` no box at all.
        const scroller = mountScroller(
            "<style>details:not([open]) > :not(summary) { display: none; }</style>"
            + SPACER + block("from", 50) + "<details><summary>s</summary>" + block("to", 50)
            + "</details>" + SPACER
        );
        const details = scroller.querySelector("details");

        showBlockReference(scroller, "from:to");

        expect(details?.open).toBe(true);
        const height = getBlock(scroller, "to").getBoundingClientRect().bottom
            - getBlock(scroller, "from").getBoundingClientRect().top;
        expect(getOffset(scroller, "from")).toBeCloseTo((400 - height) / 2);
    });

    it("scrolls the document when no ancestor of the blocks scrolls", () => {
        const page = mount("<div style=\"overflow-x: auto\">"
            + SPACER + SPACER + block("a", 100) + SPACER + SPACER + "</div>");
        const viewportHeight = document.documentElement.clientHeight;
        document.documentElement.scrollTop = 300;

        showBlockReference(page, "a");

        expect(getBlock(page, "a").getBoundingClientRect().top)
            .toBeCloseTo(Math.max(viewportHeight * 0.15, (viewportHeight - 100) / 2));
    });

    it("shows the tab that holds a block, and centers a linked tab from its title down", () => {
        const scroller = mountScroller(
            SPACER + "<div class=\"trilium-tabs\">"
            + "<section class=\"trilium-tab\"><p class=\"trilium-tab-title\">A</p>"
            + "<div class=\"trilium-tab-panel\"></div></section>"
            + "<section class=\"trilium-tab\" style=\"display: contents\" "
            + "data-trilium-block-id=\"t\"><p class=\"trilium-tab-title\">B</p>"
            + "<div class=\"trilium-tab-panel\" style=\"height: 200px\">"
            + "<p data-trilium-block-id=\"a\">a</p></div></section>"
            + "<section class=\"trilium-tab\" data-trilium-block-id=\"bare\"><p>c</p></section>"
            + "</div>" + SPACER
        );
        applyTabs(scroller, { placeholder: "", scrollLabels: { start: "", end: "" } });
        const activeTitle = () =>
            scroller.querySelector(".trilium-tab-title--active");
        expect(activeTitle()?.textContent).toBe("A");

        showBlockReference(scroller, "a");
        expect(activeTitle()?.textContent).toBe("B");

        showBlockReference(scroller, "t");
        const title = getTabTitle(getBlock(scroller, "t"));
        const panel = getBlock(scroller, "t").querySelector(".trilium-tab-panel");
        const titleTop = title?.getBoundingClientRect().top ?? NaN;
        const height = (panel?.getBoundingClientRect().bottom ?? NaN) - titleTop;
        // The scroll offset is a whole number of pixels.
        const offset = titleTop - scroller.getBoundingClientRect().top;
        expect(Math.abs(offset - (400 - height) / 2)).toBeLessThanOrEqual(0.5);

        showBlockReference(scroller, "bare");
        expect(getOffset(scroller, "bare"))
            .toBeCloseTo((400 - getBlock(scroller, "bare").offsetHeight) / 2);
    });

    it("flashes the outermost elements of a range, in document order", () => {
        const container = buildContainer(
            "<p>before</p><p data-trilium-block-id=\"a\">A</p><blockquote><p>quote</p></blockquote>"
            + "<ul><li><p data-trilium-block-id=\"b\">B</p><p>rest of item</p></li>"
            + "<li>after</li></ul>"
        );

        expect(showBlockReference(container, "b:a")).toBe(true);

        expect(getFlashed(container)).toEqual([ "A", "quote", "B" ]);
    });

    it("shows the block found of a broken range, and nothing for a missing block", () => {
        const container = buildContainer("<p data-trilium-block-id=\"b\">B</p><p>other</p>");

        expect(showBlockReference(container, "gone")).toBe(false);
        expect(showBlockReference(container, "a:b:c")).toBe(false);
        expect(scrollBy).not.toHaveBeenCalled();

        expect(showBlockReference(container, "gone:b")).toBe(false);
        expect(scrollBy).toHaveBeenCalledOnce();
        expect(getFlashed(container)).toEqual([ "B" ]);
    });
});

describe("getBlockRangeElements", () => {
    it("returns a single block, or the blocks between two in a list", () => {
        const container = buildContainer(
            "<ol><li data-trilium-block-id=\"a\">A</li><li>B</li>"
            + "<li data-trilium-block-id=\"c\">C</li><li>D</li></ol>"
        );
        const [ first, , third ] = container.querySelectorAll("li");

        expect(getBlockRangeElements(first, first)).toEqual([ first ]);
        expect(getBlockRangeElements(first, third).map((element) => element.textContent))
            .toEqual([ "A", "B", "C" ]);
    });
});

function buildContainer(html: string) {
    const container = document.createElement("div");
    container.innerHTML = html;
    return container;
}

function mount(html: string) {
    const container = buildContainer(html);
    document.body.append(container);
    mounted.push(container);
    return container;
}

/** Mounts `html` in a scroll container 400px high. */
function mountScroller(html: string) {
    const scroller = mount(html);
    scroller.style.height = "400px";
    scroller.style.overflowY = "auto";
    return scroller;
}

function block(id: string, height: number) {
    return `<div data-trilium-block-id="${id}" style="height: ${height}px"></div>`;
}

function getBlock(container: HTMLElement, id: string) {
    const element = container.querySelector<HTMLElement>(`[data-trilium-block-id="${id}"]`);
    expect(element).not.toBeNull();
    return element as HTMLElement;
}

/** The distance from the top of `scroller` to the block `id`. */
function getOffset(scroller: HTMLElement, id: string) {
    return getBlock(scroller, id).getBoundingClientRect().top
        - scroller.getBoundingClientRect().top;
}

function getFlashed(container: HTMLElement) {
    return [ ...container.querySelectorAll(".block-reference-flash") ]
        .map((element) => element.textContent);
}
