import { Essentials, Paragraph, Table } from "ckeditor5";
import editorStylesheetUrl from "ckeditor5/ckeditor5.css?url";
import { beforeAll, describe, expect, it, onTestFinished } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { COLUMN_RATIOS, getColumnCount } from "./constants.js";
import Multicolumn from "./multicolumn.js";

const EDITOR_GAP = 12;

/** The gap between the columns of saved content, which is 2em. */
function savedGapOf(layout: Element) {
    return 2 * parseFloat(getComputedStyle(layout).fontSize);
}

function layoutHtml(ratios: string, columns: string[]) {
    const content = columns.map(column => `<section>${column}</section>`).join("");
    return `<section class="trilium-multicolumn-layout" data-trilium-column-ratios="${ratios}">` +
        `${content}</section>`;
}

/** Renders saved HTML the way the read-only view and shared pages do. */
function renderContent(html: string, width: number) {
    const container = document.createElement("div");
    container.className = "ck-content";
    container.style.width = `${width}px`;
    container.innerHTML = html;
    document.body.appendChild(container);
    onTestFinished(() => container.remove());
    return container;
}

function columnsOf(layout: Element | null | undefined) {
    return [...layout?.querySelectorAll<HTMLElement>(":scope > section") ?? []];
}

/** The radii of the top-left, top-right, bottom-right and bottom-left corners. */
function cornersOf(element: Element | null | undefined) {
    if (!element) {
        return null;
    }
    const style = getComputedStyle(element);
    return [
        style.borderTopLeftRadius,
        style.borderTopRightRadius,
        style.borderBottomRightRadius,
        style.borderBottomLeftRadius
    ].join(" ");
}

function expectWidthsToFollow(layout: HTMLElement, ratios: string, gap: number) {
    const columns = columnsOf(layout);
    const weights = ratios.split("-").map(Number);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const available = layout.getBoundingClientRect().width - gap * (weights.length - 1);

    expect(columns).toHaveLength(weights.length);
    for (const [index, column] of columns.entries()) {
        const expected = available * weights[index] / total;
        expect(column.getBoundingClientRect().width).toBeCloseTo(expected, 0);
    }
    const tops = columns.map(column => column.getBoundingClientRect().top);
    expect(new Set(tops).size).toBe(1);
}

describe("multicolumn layout styles", () => {
    beforeAll(() => new Promise<void>((resolve, reject) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = editorStylesheetUrl;
        link.onload = () => resolve();
        link.onerror = () => reject(new Error("the editor stylesheet did not load"));
        document.head.appendChild(link);
    }));

    it("sizes the columns by their weights in saved content", () => {
        for (const ratios of COLUMN_RATIOS) {
            const columns = Array.from({ length: getColumnCount(ratios) }, () => "<p>Text</p>");
            const container = renderContent(layoutHtml(ratios, columns), 800);
            const layout = container.querySelector<HTMLElement>(".trilium-multicolumn-layout");
            expect(layout, ratios).not.toBeNull();

            const element = layout as HTMLElement;
            expectWidthsToFollow(element, ratios, savedGapOf(element));
            container.remove();
        }
    });

    it("sizes the columns by their weights in the editor, beside the widget elements", async () => {
        const editor = await createTestEditor([Essentials, Paragraph, Multicolumn]);
        const editable = editor.ui.view.editable.element as HTMLElement;
        editable.style.width = "800px";

        for (const ratios of COLUMN_RATIOS) {
            const columns = Array.from({ length: getColumnCount(ratios) }, () => "<p>Text</p>");
            editor.setData(layoutHtml(ratios, columns));
            const layout =
                editable.querySelector<HTMLElement>(".trilium-multicolumn-layout.ck-widget");
            expect(layout, ratios).not.toBeNull();

            expectWidthsToFollow(layout as HTMLElement, ratios, EDITOR_GAP);
        }
    });

    it("rounds the widget and the outer corners of the columns, in either direction", async () => {
        const editor = await createTestEditor([Essentials, Paragraph, Multicolumn]);
        const editable = editor.ui.view.editable.element as HTMLElement;
        editable.style.width = "800px";
        editor.setData(layoutHtml("1-1-1-1", ["<p>A</p>", "<p>B</p>", "<p>C</p>", "<p>D</p>"]));
        const widget = editable.querySelector(".trilium-multicolumn-layout");

        expect([widget, ...columnsOf(widget)].map(cornersOf)).toEqual([
            "8px 8px 8px 8px",
            "8px 0px 0px 8px",
            "0px 0px 0px 0px",
            "0px 0px 0px 0px",
            "0px 8px 8px 0px"
        ]);

        const rtlEditor = await createTestEditor([Essentials, Paragraph, Multicolumn], {
            language: { content: "ar" }
        });
        const rtlEditable = rtlEditor.ui.view.editable.element as HTMLElement;
        rtlEditable.style.width = "800px";
        rtlEditor.setData(layoutHtml("1-1", ["<p>A</p>", "<p>B</p>"]));
        expect(rtlEditable.dir).toBe("rtl");
        const columns = columnsOf(rtlEditable.querySelector(".trilium-multicolumn-layout"));
        expect(columns.map(cornersOf)).toEqual(["0px 8px 8px 0px", "8px 0px 0px 8px"]);
    });

    it("borders and pads the columns only in the editor", async () => {
        const editor = await createTestEditor([Essentials, Paragraph, Multicolumn]);
        const editable = editor.ui.view.editable.element as HTMLElement;
        editable.style.width = "800px";
        editor.setData(layoutHtml("1-1", ["<p>A</p>", "<p>B</p>"]));
        const editingColumns = columnsOf(editable.querySelector(".trilium-multicolumn-layout"));

        const container = renderContent(layoutHtml("1-1", ["<p>A</p>", "<p>B</p>"]), 800);
        const savedColumns = columnsOf(container.querySelector(".trilium-multicolumn-layout"));

        expect(editingColumns).toHaveLength(2);
        expect(savedColumns).toHaveLength(2);
        for (const column of editingColumns) {
            const style = getComputedStyle(column);
            expect([style.borderTopWidth, style.paddingLeft, style.paddingRight])
                .toEqual(["1px", "16px", "16px"]);
        }
        for (const column of savedColumns) {
            const style = getComputedStyle(column);
            expect([style.borderTopWidth, style.borderLeftWidth, style.paddingLeft])
                .toEqual(["0px", "0px", "0px"]);
            expect([style.paddingRight, cornersOf(column)]).toEqual(["0px", "0px 0px 0px 0px"]);
        }
    });

    it("lines the text of saved content up with the content around it, 2em apart", () => {
        const html = "<p>Outside</p>" +
            layoutHtml("1-2-1", ["<p>A</p>", "<p>B</p>", "<p>C</p>"]);
        const container = renderContent(html, 800);
        const outside = container.querySelector("p")?.getBoundingClientRect();
        const layout = container.querySelector(".trilium-multicolumn-layout");
        const columns = columnsOf(layout);
        const texts = columns.map(column =>
            column.querySelector("p")?.getBoundingClientRect());
        const gap = layout ? savedGapOf(layout) : NaN;

        expect(outside).toBeDefined();
        expect(texts).toHaveLength(3);
        expect(gap).toBeGreaterThan(EDITOR_GAP);
        expect(texts[0]?.left).toBeCloseTo(outside?.left ?? NaN, 0);
        expect(texts[2]?.right).toBeCloseTo(outside?.right ?? NaN, 0);
        expect((texts[1]?.left ?? NaN) - (texts[0]?.right ?? NaN)).toBeCloseTo(gap, 0);
        expect((texts[2]?.left ?? NaN) - (texts[1]?.right ?? NaN)).toBeCloseTo(gap, 0);
    });

    /** Shows the layout toolbar the way the editor does and opens its dropdown. */
    async function openLayoutDropdown() {
        const editor = await createTestEditor([Essentials, Paragraph, Multicolumn]);
        editor.setData(layoutHtml("1-3", ["<p>A</p>", "<p>B</p>"]));
        editor.ui.focusTracker.isFocused = true;
        editor.ui.update();
        const toolbar = document.querySelector("[aria-label='Multicolumn layout toolbar']");
        const button = toolbar?.querySelector<HTMLElement>(".ck-dropdown__button");
        button?.click();
        return { toolbar, button };
    }

    it("separates the tiles of each column count by 20px in the open dropdown", async () => {
        const { toolbar } = await openLayoutDropdown();
        const tiles = [...toolbar?.querySelectorAll(".ck-list-styles-list > .ck-button") ?? []];
        const boxes = tiles.map(tile => tile.getBoundingClientRect());
        const gaps = boxes.slice(1).map((box, index) => box.left - boxes[index].right);

        expect(gaps).toHaveLength(5);
        expect(gaps[2]).toBeCloseTo(20, 1);
        expect(gaps[4]).toBeCloseTo(20, 1);
        expect(gaps[0]).toBeLessThan(20);
        expect(gaps[1]).toBeCloseTo(gaps[0], 1);
        expect(gaps[3]).toBeCloseTo(gaps[0], 1);
    });

    it("draws the layout figures as outlines at the size of the editor's icons", async () => {
        const { toolbar, button } = await openLayoutDropdown();
        const icons = [
            button?.querySelector("svg.ck-icon"),
            toolbar?.querySelector(".ck-list-styles-list svg.ck-icon")
        ];
        for (const [index, size] of [20, 44].entries()) {
            const icon = icons[index];
            const rect = icon?.querySelector("rect");
            const dots = [...icon?.querySelectorAll("circle") ?? []];
            expect(icon?.getBoundingClientRect().width).toBeCloseTo(size, 0);
            expect(rect && getComputedStyle(rect).fill).toBe("none");

            // The outline is centered on the box, so 0.75px of it lies inside, then the 1px gap.
            const box = (rect as Element).getBoundingClientRect();
            const first = dots[0].getBoundingClientRect();
            const last = dots[dots.length - 1].getBoundingClientRect();
            expect(first.top - box.top).toBeCloseTo(1.75, 1);
            expect(box.bottom - last.bottom).toBeCloseTo(1.75, 1);
        }
    });

    /** Returns the columns of a layout below 500px, after checking that they are stacked. */
    function expectStacked(layout: Element | null | undefined) {
        const columns = columnsOf(layout);
        const width = layout?.getBoundingClientRect().width ?? NaN;
        const boxes = columns.map(column => column.getBoundingClientRect());

        expect(columns).toHaveLength(3);
        expect(width).toBeLessThan(500);
        for (const [index, box] of boxes.entries()) {
            expect(box.width).toBeCloseTo(width, 0);
            expect(getComputedStyle(columns[index]).borderTopWidth).toBe("0px");
            if (index > 0) {
                expect(box.top).toBeCloseTo(boxes[index - 1].bottom, 0);
            }
        }
        return columns.map(column => getComputedStyle(column).backgroundColor);
    }

    it("stacks the columns below 500px, alternating backgrounds only in the editor", async () => {
        const html = layoutHtml("1-2-1", ["<p>A</p>", "<p>B</p>", "<p>C</p>"]);
        const editor = await createTestEditor([Essentials, Paragraph, Multicolumn]);
        const editable = editor.ui.view.editable.element as HTMLElement;
        editable.style.width = "480px";
        editor.setData(html);

        const editing = expectStacked(editable.querySelector(".trilium-multicolumn-layout"));
        expect(editing[0]).toBe(editing[2]);
        expect(editing[1]).not.toBe(editing[0]);

        const container = renderContent(html, 480);
        const saved = expectStacked(container.querySelector(".trilium-multicolumn-layout"));
        expect(saved).toEqual(["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0)"]);
    });

    it("stacks a nested layout by its own width", () => {
        const inner = layoutHtml("1-1", ["<p>A</p>", "<p>B</p>"]);
        const container = renderContent(layoutHtml("1-3", [inner, "<p>Wide</p>"]), 700);
        const outer = container.querySelector<HTMLElement>(".trilium-multicolumn-layout");
        const innerColumns = columnsOf(outer?.querySelector(".trilium-multicolumn-layout"));

        const element = outer as HTMLElement;
        expectWidthsToFollow(element, "1-3", savedGapOf(element));
        expect(innerColumns[1].getBoundingClientRect().top)
            .toBeCloseTo(innerColumns[0].getBoundingClientRect().bottom, 0);
    });

    it("keeps its width in a table cell beside long text", async () => {
        const editor = await createTestEditor([Essentials, Paragraph, Table, Multicolumn]);
        const editable = editor.ui.view.editable.element as HTMLElement;
        editable.style.width = "800px";
        const longText = "word ".repeat(200);

        editor.setData(
            "<figure class=\"table\"><table><tbody><tr>" +
                `<td>${layoutHtml("1-1", ["<p>Left</p>", "<p>Right</p>"])}</td>` +
                `<td><p>${longText}</p></td>` +
            "</tr></tbody></table></figure>"
        );

        const layout = editable.querySelector(".trilium-multicolumn-layout");
        expect(layout?.getBoundingClientRect().width).toBeGreaterThan(150);
    });
});
