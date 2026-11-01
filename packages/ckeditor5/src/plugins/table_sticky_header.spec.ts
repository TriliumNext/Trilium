import "../theme/table_sticky_header.css";

import { _setModelData as setModelData, Essentials, Paragraph, Table } from "ckeditor5";
import type { ClassicEditor, ModelElement } from "ckeditor5";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import { modelTable } from "../../test/table-kit.js";
import TableStickyHeader from "./table_sticky_header.js";
import { START_PROPERTY, TRAVEL_PROPERTY } from "./table_sticky_header_read_only.js";

describe("TableStickyHeader", () => {
    let editor: ClassicEditor;
    let scroller: HTMLDivElement;

    beforeEach(async () => {
        editor = await createTestEditor([ Essentials, Paragraph, Table, TableStickyHeader ]);
        scroller = document.createElement("div");
        scroller.style.cssText = "position:fixed;top:0;left:0;height:200px;width:400px;"
            + "overflow:auto;";
        document.body.appendChild(scroller);
        if (editor.ui.element) {
            scroller.appendChild(editor.ui.element);
        }
    });

    afterEach(() => {
        scroller.remove();
    });

    it("keeps the header rows in view and measures them again when they change", async () => {
        setModelData(editor.model, modelTable(rows(30), 'headingRows="1"'));
        await settle();

        const thead = domHead(editor);
        const travel = parseFloat(thead.style.getPropertyValue(TRAVEL_PROPERTY));
        expect(thead.style.getPropertyValue(START_PROPERTY)).not.toBe("");
        expect(travel).toBeGreaterThan(500);

        const scrollerTop = scroller.getBoundingClientRect().top;
        scroller.scrollTop = thead.getBoundingClientRect().top - scrollerTop + 200;
        await settle();
        expect(thead.getBoundingClientRect().top - scrollerTop).toBeCloseTo(0, 0);

        scroller.scrollTop = 0;
        editor.model.change((writer) => writer.setAttribute("headingRows", 2, firstTable(editor)));
        await settle();
        const newHead = domHead(editor);
        const tableBottom = newHead.closest("table")?.getBoundingClientRect().bottom ?? 0;
        expect(parseFloat(newHead.style.getPropertyValue(TRAVEL_PROPERTY)))
            .toBeCloseTo(tableBottom - newHead.getBoundingClientRect().bottom - 1, 1);
        expect(parseFloat(newHead.style.getPropertyValue(TRAVEL_PROPERTY))).toBeLessThan(travel);
    });

    it("stops measuring removed tables, and all of them on destroy", () => {
        const unobserve = vi.spyOn(ResizeObserver.prototype, "unobserve");
        const disconnect = vi.spyOn(ResizeObserver.prototype, "disconnect");
        onTestFinished(() => {
            unobserve.mockRestore();
            disconnect.mockRestore();
        });
        setModelData(editor.model, modelTable(rows(3), 'headingRows="1"'));
        const thead = domHead(editor);
        const figure = thead.closest("figure");

        setModelData(editor.model, "<paragraph>[]</paragraph>");
        expect(unobserve.mock.calls).toEqual([ [ figure ], [ thead ] ]);

        editor.plugins.get(TableStickyHeader).destroy();
        expect(disconnect).toHaveBeenCalledOnce();
    });
});

function rows(count: number) {
    return Array.from({ length: count }, (_, index) => [ `Row ${index}`, "Second" ]);
}

function firstTable(editor: ClassicEditor): ModelElement {
    const table = editor.model.document.getRoot()?.getChild(0);
    if (!table?.is("element", "table")) {
        throw new Error("The first root child is not a table.");
    }
    return table;
}

function domHead(editor: ClassicEditor) {
    const thead = editor.editing.view.getDomRoot()
        ?.querySelector<HTMLTableSectionElement>("figure.table > table > thead");
    if (!thead) {
        throw new Error("The editor has no table with header rows.");
    }
    return thead;
}

/** Waits for a resize to be observed, and for the frame in which the header rows are measured. */
async function settle() {
    for (let frame = 0; frame < 3; frame++) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
    }
}
