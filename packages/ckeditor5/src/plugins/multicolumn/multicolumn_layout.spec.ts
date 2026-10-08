import { Essentials, Paragraph, Table } from "ckeditor5";
import editorStylesheetUrl from "ckeditor5/ckeditor5.css?url";
import { beforeAll, describe, expect, it, onTestFinished } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { COLUMN_RATIOS, getColumnCount } from "./constants.js";
import Multicolumn from "./multicolumn.js";

const GAP = 12;

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

function expectWidthsToFollow(layout: HTMLElement, ratios: string) {
    const columns = columnsOf(layout);
    const weights = ratios.split("-").map(Number);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const available = layout.getBoundingClientRect().width - GAP * (weights.length - 1);

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

            expectWidthsToFollow(layout as HTMLElement, ratios);
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

            expectWidthsToFollow(layout as HTMLElement, ratios);
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

        const container = renderContent(layoutHtml("1-1", ["<p>A</p>", "<p>B</p>"]), 800);
        container.dir = "rtl";
        const columns = columnsOf(container.querySelector(".trilium-multicolumn-layout"));
        expect(columns.map(cornersOf)).toEqual(["0px 8px 8px 0px", "8px 0px 0px 8px"]);
    });

    it("stacks the columns with alternating backgrounds and no borders below 500px", () => {
        const html = layoutHtml("1-2-1", ["<p>A</p>", "<p>B</p>", "<p>C</p>"]);
        const container = renderContent(html, 480);
        const layout = container.querySelector(".trilium-multicolumn-layout");
        const columns = columnsOf(layout);
        const boxes = columns.map(column => column.getBoundingClientRect());

        for (const [index, box] of boxes.entries()) {
            expect(box.width).toBeCloseTo(480, 0);
            expect(getComputedStyle(columns[index]).borderTopWidth).toBe("0px");
            if (index > 0) {
                expect(box.top).toBeCloseTo(boxes[index - 1].bottom, 0);
            }
        }
        const backgrounds = columns.map(column => getComputedStyle(column).backgroundColor);
        expect(backgrounds[0]).toBe(backgrounds[2]);
        expect(backgrounds[1]).not.toBe(backgrounds[0]);
    });

    it("stacks a nested layout by its own width", () => {
        const inner = layoutHtml("1-1", ["<p>A</p>", "<p>B</p>"]);
        const container = renderContent(layoutHtml("1-3", [inner, "<p>Wide</p>"]), 700);
        const outer = container.querySelector<HTMLElement>(".trilium-multicolumn-layout");
        const innerColumns = columnsOf(outer?.querySelector(".trilium-multicolumn-layout"));

        expectWidthsToFollow(outer as HTMLElement, "1-3");
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
