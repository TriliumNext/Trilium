import "@triliumnext/commons/src/lib/scroll_fade.css";
import "../theme/table_scroll.css";

import editorStylesheetUrl from "ckeditor5/ckeditor5.css?url";
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";

import { fadeClasses, scrollFigure } from "../../test/table-kit.js";
import { applyTableScroll } from "./table_scroll_read_only.js";

const TABLE = "<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>";

describe("applyTableScroll", () => {
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

    it("sets the width of each content table relative to the reference width", () => {
        const container = renderContent([
            tableFigure("width:150%;"),
            tableFigure(""),
            tableFigure("width:800px;"),
            `<figure class="table layout-table">${TABLE}</figure>`,
            `<blockquote>${tableFigure("width:150%;")}</blockquote>`,
            `<ul><li>${tableFigure("width:50%;")}<ol><li>${tableFigure("")}</li></ol></li></ul>`,
            `<ul><li><blockquote>${tableFigure("")}</blockquote></li></ul>`
        ].join(""), 600);

        const [wide, unsized, pixels, layout, quoted, listed, nestedListed, quotedInList]
            = container.querySelectorAll("figure");
        expect(widthOf(wide)).toBe("calc(var(--table-reference-width, 100%) * 150 / 100)");
        expect(wide.style.width).toBe("150%");
        expect(widthOf(unsized)).toBe("var(--table-reference-width, 100%)");
        expect(widthOf(pixels)).toBe("800px");
        expect(widthOf(layout)).toBe("");
        expect(widthOf(quoted)).toBe("");
        expect(widthOf(listed)).toBe("calc(var(--table-reference-width, 100%) * 50 / 100)");
        expect(widthOf(nestedListed)).toBe("var(--table-reference-width, 100%)");
        expect(widthOf(quotedInList)).toBe("");
    });

    it("scrolls a table wider than the content", () => {
        const container = renderContent(tableFigure("width:150%;"), 600);
        expectLayout(container, { figure: 600, table: 900 });

        container.innerHTML = tableFigure("width:800px;");
        applyTableScroll(container);
        expectLayout(container, { figure: 600, table: 800 });

        const wideContent = TABLE.replace(">b<", `>${"x".repeat(400)}<`);
        container.innerHTML = `<figure class="table">${wideContent}</figure>`;
        applyTableScroll(container);
        const figure = firstFigure(container);
        expect(figure.getBoundingClientRect().width).toBeCloseTo(600, 0);
        expect(figure.scrollWidth).toBeGreaterThan(figure.clientWidth);

        container.innerHTML = `<ul><li>${tableFigure("width:150%;")}</li></ul>`;
        applyTableScroll(container);
        const listed = container.querySelector<HTMLElement>("li > figure");
        const item = container.querySelector("li");
        expect(listed?.getBoundingClientRect().width)
            .toBeCloseTo(item?.getBoundingClientRect().width ?? 0, 0);
        expect(listed?.scrollWidth).toBeGreaterThan(listed?.clientWidth ?? Infinity);
    });

    it("keeps a table narrower than the content as it is", () => {
        const container = renderContent(tableFigure("width:50%;"), 600);
        expectLayout(container, { figure: 300, table: 300 });
        const figure = firstFigure(container);
        expect(figure.offsetLeft - container.offsetLeft).toBeCloseTo(150, 0);

        container.innerHTML = tableFigure("");
        applyTableScroll(container);
        expectLayout(container, { figure: 600, table: 600 });
    });

    it("sizes tables by the reference width where one is set", () => {
        const container = renderContent(tableFigure(""), 400);
        container.style.setProperty("--table-reference-width", "1200px");
        expectLayout(container, { figure: 400, table: 1200 });

        container.innerHTML = tableFigure("width:50%;");
        applyTableScroll(container);
        expectLayout(container, { figure: 400, table: 600 });
    });

    it("keeps the caption above the table and in view while the table scrolls", () => {
        const captionHtml = "<figcaption>Caption</figcaption>";
        const container = renderContent(
            `<figure class="table" style="width:150%;">${TABLE}${captionHtml}</figure>`,
            600
        );
        expectLayout(container, { figure: 600, table: 900 });
        const figure = firstFigure(container);
        const table = figure.querySelector("table");
        const caption = figure.querySelector("figcaption");
        expect(table).toBeInstanceOf(HTMLElement);
        expect(caption).toBeInstanceOf(HTMLElement);
        expect(caption?.getBoundingClientRect().bottom)
            .toBeLessThanOrEqual(table?.getBoundingClientRect().top ?? 0);
        expect(caption?.getBoundingClientRect().width).toBeCloseTo(600, 0);

        figure.scrollLeft = 200;
        expect(caption?.getBoundingClientRect().left)
            .toBeCloseTo(figure.getBoundingClientRect().left, 0);
    });

    it("fades the edges that a scrolling table continues past", async () => {
        const container = renderContent(tableFigure("width:150%;"), 600);
        const figure = firstFigure(container);
        expect(fadeClasses(figure))
            .toEqual([ "scroll-fade", "scroll-fade-horizontal", "scroll-fade-end" ]);
        expect(getComputedStyle(figure).maskImage).toContain("linear-gradient");
        await expect.poll(() => getComputedStyle(figure).getPropertyValue("--scroll-fade-end"))
            .toBe("2.5%");

        // A second pass over the same content keeps one watcher, which writes the classes once.
        applyTableScroll(container);
        let classChanges = 0;
        new MutationObserver((records) => {
            classChanges += records.length;
        }).observe(figure, { attributeFilter: [ "class" ] });
        await scrollFigure(figure, 300);
        expect(classChanges).toBe(2);
        expect(fadeClasses(figure))
            .toEqual([ "scroll-fade", "scroll-fade-horizontal", "scroll-fade-start" ]);

        container.innerHTML = tableFigure("width:50%;");
        applyTableScroll(container);
        expect(fadeClasses(firstFigure(container))).toEqual([]);
    });

    it("fades towards the left in right-to-left content", () => {
        const container = renderContent(tableFigure("width:150%;"), 600, "rtl");
        const figure = firstFigure(container);
        expect(fadeClasses(figure)).toEqual([
            "scroll-fade", "scroll-fade-horizontal", "scroll-fade-end", "scroll-fade-rtl"
        ]);
        expect(getComputedStyle(figure).getPropertyValue("--scroll-fade-direction"))
            .toBe("to left");
    });

    it("stops fading once disposed, and fades again on a later pass", async () => {
        const container = renderContent("", 600);
        container.innerHTML = tableFigure("width:150%;");
        const dispose = applyTableScroll(container);
        const figure = firstFigure(container);
        expect(fadeClasses(figure)).toContain("scroll-fade-end");

        dispose();
        dispose();
        await scrollFigure(figure, 300);
        expect(fadeClasses(figure)).not.toContain("scroll-fade-start");

        applyTableScroll(container);
        expect(fadeClasses(figure)).toContain("scroll-fade-start");
    });

    it("starts fading once detached content is attached", async () => {
        const container = document.createElement("div");
        container.className = "ck-content";
        container.style.width = "600px";
        container.innerHTML = tableFigure("width:150%;");
        applyTableScroll(container);
        const figure = firstFigure(container);
        expect(fadeClasses(figure)).toEqual([]);

        document.body.appendChild(container);
        onTestFinished(() => container.remove());
        await expect.poll(() => fadeClasses(figure)).toContain("scroll-fade-end");
    });

    it("leaves the tables of an editor alone", () => {
        const container = renderContent(
            `<figure class="table ck-widget" style="width:150%;">${TABLE}</figure>`,
            600
        );
        expect(widthOf(firstFigure(container))).not.toBe("");
        expect(getComputedStyle(firstFigure(container)).overflowX).toBe("visible");
    });
});

function tableFigure(style: string) {
    return `<figure class="table"${style ? ` style="${style}"` : ""}>${TABLE}</figure>`;
}

/** Renders saved HTML the way the read-only view does and applies the pass. */
function renderContent(html: string, width: number, dir: "ltr" | "rtl" = "ltr") {
    const container = document.createElement("div");
    container.className = "ck-content";
    container.dir = dir;
    container.style.width = `${width}px`;
    container.innerHTML = html;
    document.body.appendChild(container);
    onTestFinished(() => container.remove());
    applyTableScroll(container);
    return container;
}

function widthOf(figure: HTMLElement) {
    return figure.style.getPropertyValue("--table-width");
}

function firstFigure(container: HTMLElement) {
    const figure = container.querySelector(":scope > figure");
    if (!(figure instanceof HTMLElement)) {
        throw new Error("The content has no table.");
    }
    return figure;
}

/** Expects the figure and its table at the given widths, the figure scrolling when narrower. */
function expectLayout(container: HTMLElement, widths: { figure: number; table: number }) {
    const figure = firstFigure(container);
    const table = figure.querySelector("table");
    expect(table).toBeInstanceOf(HTMLElement);
    expect(figure.getBoundingClientRect().width).toBeCloseTo(widths.figure, 0);
    expect(table?.getBoundingClientRect().width).toBeCloseTo(widths.table, 0);
    expect(figure.scrollWidth).toBeCloseTo(Math.max(widths.figure, widths.table), 0);
}
