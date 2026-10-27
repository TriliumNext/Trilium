import "@triliumnext/commons/src/lib/scroll_fade.css";
import "../theme/table_scroll.css";

import {
    _setModelData as setModelData,
    BlockQuote,
    Essentials,
    List,
    Paragraph,
    Table,
    TableCaption,
    TableColumnResize
} from "ckeditor5";
import type { ClassicEditor, ModelElement } from "ckeditor5";
import editorStylesheetUrl from "ckeditor5/ckeditor5.css?url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import { fadeClasses, modelTable, scrollFigure } from "../../test/table-kit.js";
import TriliumTableScroll, {
    REFERENCE_WIDTH_PROPERTY, VIEWPORT_WIDTH_PROPERTY
} from "./table_scroll.js";

const PLUGINS = [Essentials, Paragraph, BlockQuote, Table, TableColumnResize, TriliumTableScroll];
const LONG_WORD = "x".repeat(400);

describe("TriliumTableScroll", () => {
    describe("without a reference width", () => {
        let editor: ClassicEditor;

        beforeEach(async () => {
            editor = await createTestEditor(PLUGINS);
            setEditableWidth(editor, 400);
        });

        it("keeps the upstream plugin name and column resizing", () => {
            expect(editor.plugins.get("TableScrollEditing")).toBeInstanceOf(TriliumTableScroll);
            expect(editor.plugins.get("TableColumnResize").isEnabled).toBe(true);
        });

        it("scrolls a table wider than the editable and sizes it by its percentage", () => {
            setModelData(editor.model, modelTable([["a", "b"]], 'tableWidth="150%"'));
            expectScrolling(editor, "150%");

            setModelData(editor.model, modelTable([["a", "b"]], 'tableWidth="50%"'));
            expectFitting(editor, "50%");
        });

        it("has no reference width for any table", () => {
            setModelData(editor.model, modelTable([["a", "b"]]));
            expect(tableScroll(editor).getReferenceWidth(firstTable(editor))).toBeNull();
        });
    });

    describe("with a reference width", () => {
        let editor: ClassicEditor;

        beforeEach(async () => {
            setReferenceWidth("1200px");
            editor = await createTestEditor(PLUGINS);
            setEditableWidth(editor, 400);
        });

        it("sizes a table with no width at the reference width", () => {
            setModelData(editor.model, modelTable([["a", "b"]]));
            expectScrolling(editor, "1200px");
            expect(tableScroll(editor).getReferenceWidth(firstTable(editor))).toBe(1200);
        });

        it("sizes a percentage width as a share of the reference width", () => {
            setModelData(editor.model, modelTable([["a", "b"]], 'tableWidth="50%"'));
            expectScrolling(editor, "600px");
        });

        it("keeps a width in other units", () => {
            setModelData(editor.model, modelTable([["a", "b"]], 'tableWidth="300px"'));
            expectFitting(editor, "300px");
        });

        it("fits a table into an editable wider than the reference width", () => {
            setEditableWidth(editor, 1500);
            setModelData(editor.model, modelTable([["a", "b"]]));
            expectFitting(editor, "1200px");
        });

        it("converts the widths of a column resize", () => {
            setModelData(editor.model, modelTable([["a", "b"]], 'tableWidth="50%"'));
            const table = firstTable(editor);

            tableScroll(editor)._updateTableScrollOverflowState(table, "75%");
            expectScrolling(editor, "900px");

            tableScroll(editor)._updateTableScrollOverflowState(table, null);
            expectScrolling(editor, "1200px");
        });

        it("sizes a table in a list", async () => {
            const listEditor = await createTestEditor([...PLUGINS, List]);
            setEditableWidth(listEditor, 400);
            setModelData(listEditor.model, '<table listIndent="0" listItemId="a00" '
                + 'listType="bulleted"><tableRow><tableCell><paragraph>a</paragraph></tableCell>'
                + "</tableRow></table>");
            const figure = listEditor.editing.view.getDomRoot()?.querySelector("li > figure.table");
            expect(figure).toBeInstanceOf(HTMLElement);
            expect(figure?.classList.contains("ck-table-overflowing")).toBe(true);
            expect(figure?.querySelector("table")?.style.width).toBe("1200px");
        });

        it("leaves a table that cannot scroll alone", () => {
            setModelData(editor.model, `<blockQuote>${modelTable([["a", "b"]])}</blockQuote>`);
            const figure = editor.editing.view.getDomRoot()?.querySelector("figure.table");
            expect(figure).toBeInstanceOf(HTMLElement);
            expect(figure?.classList.contains("ck-table-overflowing")).toBe(false);
            expect((figure as HTMLElement | null)?.style.width).toBe("");
        });

        it("has no reference width while the editable is detached", () => {
            setModelData(editor.model, modelTable([["a", "b"]]));
            vi.spyOn(editor.editing.view, "getDomRoot").mockReturnValueOnce(undefined);
            expect(tableScroll(editor).getReferenceWidth(firstTable(editor))).toBeNull();
        });

        it("turns column resizing off", () => {
            expect(editor.plugins.get("TableColumnResize").isEnabled).toBe(false);
        });

        it("works without column resizing", async () => {
            const plain = await createTestEditor([
                Essentials, Paragraph, Table, TriliumTableScroll
            ]);
            setEditableWidth(plain, 400);
            setModelData(plain.model, modelTable([["a", "b"]]));
            expect(plain.plugins.has("TableColumnResize")).toBe(false);
            expectScrolling(plain, "1200px");
        });
    });
});

describe("a table with content wider than the editable", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor(PLUGINS);
        setEditableWidth(editor, 400);
    });

    it("scrolls, at the width of its content, until the content fits", () => {
        setModelData(editor.model, modelTable([["a", LONG_WORD]]));
        expectContentScrolling(editor);

        replaceLastCellText(editor, "b");
        const figure = domFigure(editor);
        expect(figure.classList.contains("ck-table-overflowing")).toBe(false);
        expect(figure.style.width).toBe("");
    });

    it("gets its saved width back once the content fits", () => {
        setModelData(editor.model, modelTable([["a", LONG_WORD]], 'tableWidth="50%"'));
        expectContentScrolling(editor);

        replaceLastCellText(editor, "b");
        expectFitting(editor, "50%");
    });

    it("keeps scrolling through an update of the upstream state", () => {
        setModelData(editor.model, modelTable([["a", LONG_WORD]]));
        const table = firstTable(editor);

        tableScroll(editor)._updateTableScrollOverflowState(table);
        expectContentScrolling(editor);

        tableScroll(editor)._updateTableScrollOverflowState(table, "140%");
        expectScrolling(editor, "140%");
    });

    it("checks again when an image in the editable loads", () => {
        setModelData(editor.model, modelTable([["a", "b"]]));
        const figure = domFigure(editor);
        expect(figure.classList.contains("ck-table-overflowing")).toBe(false);

        const cell = figure.querySelector("td");
        cell?.style.setProperty("min-width", "2000px");
        cell?.dispatchEvent(new Event("load"));
        expect(figure.classList.contains("ck-table-overflowing")).toBe(true);
    });

    it("leaves a table that cannot scroll alone", async () => {
        const fixed = await createTestEditor(PLUGINS, {
            table: { tableScroll: { tableTypes: [] } }
        });
        setEditableWidth(fixed, 400);
        setModelData(fixed.model, `<paragraph>a</paragraph>${modelTable([["a", LONG_WORD]])}`);
        expect(domFigure(fixed).classList.contains("ck-table-overflowing")).toBe(false);
    });

    it("gets the reference width back once the content fits", () => {
        setReferenceWidth("1200px");
        setEditableWidth(editor, 1500);
        setModelData(editor.model, modelTable([["a", LONG_WORD]]));
        expectContentScrolling(editor);

        replaceLastCellText(editor, "b");
        expectFitting(editor, "1200px");
    });
});

describe("the controls of a scrolling table", () => {
    useEditorStylesheet();

    it("keeps the controls whole and in view, above and below the caption and table", async () => {
        const editor = await createTestEditor([...PLUGINS, TableCaption]);
        setEditableWidth(editor, 400);
        setModelData(editor.model, '<table tableWidth="150%"><tableRow><tableCell>'
            + "<paragraph>a</paragraph></tableCell></tableRow><caption>Caption</caption></table>");
        const figure = domFigure(editor);
        expect(figure.classList.contains("ck-table-overflowing")).toBe(true);
        const controls = [
            "figcaption",
            ".ck-widget__selection-handle",
            ".ck-widget__type-around__button_before",
            ".ck-widget__type-around__button_after"
        ].map((selector) => figure.querySelector(selector));
        for (const control of controls) {
            expect(control).toBeInstanceOf(HTMLElement);
        }

        const lefts = controls.map((control) => expectInside(figure, control));
        figure.scrollLeft = 100;
        expect(figure.scrollLeft).toBe(100);
        const scrolledLefts = controls.map((control) => expectInside(figure, control));
        for (const [index, left] of lefts.entries()) {
            expect(scrolledLefts[index]).toBeCloseTo(left, 0);
        }

        const [caption, handle, before, after] = controls.map(rectOf);
        const table = rectOf(figure.querySelector("table"));
        expect(handle.top).toBeCloseTo(before.top, 0);
        expect(handle.bottom).toBeLessThanOrEqual(caption.top + 0.5);
        expect(caption.top).toBeCloseTo(before.bottom, 0);
        expect(table.top).toBeCloseTo(caption.bottom, 0);
        expect(after.top).toBeCloseTo(table.bottom, 0);
        const beforeButton = controls[2];
        expect(beforeButton && getComputedStyle(beforeButton).borderBottomLeftRadius)
            .toBe(beforeButton && getComputedStyle(beforeButton).borderTopLeftRadius);
    });
});

describe("the edge fades of a scrolling table", () => {
    useEditorStylesheet();

    it("masks the visible part of the table as it scrolls, and stops once it fits", async () => {
        const editor = await createTestEditor(PLUGINS);
        setEditableWidth(editor, 400);
        setModelData(editor.model, modelTable([ [ "a", "b" ] ], 'tableWidth="150%"'));
        const figure = domFigure(editor);
        const table = domTable(figure);
        expect(figure.classList.contains("ck-table-overflowing")).toBe(true);
        expect(fadeClasses(figure)).toEqual([]);
        expect(fadeClasses(table))
            .toEqual([ "scroll-fade", "scroll-fade-horizontal", "scroll-fade-end" ]);
        expect(table.style.getPropertyValue(VIEWPORT_WIDTH_PROPERTY))
            .toBe(`${figure.clientWidth}px`);
        expect(getComputedStyle(table).maskImage).toContain("linear-gradient");
        await expect.poll(() => getComputedStyle(table).getPropertyValue("--scroll-fade-end"))
            .toBe("2.5%");

        await scrollFigure(figure, 100);
        expect(fadeClasses(table)).toContain("scroll-fade-start");
        expect(fadeClasses(table)).toContain("scroll-fade-end");
        const maskLeft = table.getBoundingClientRect().left
            + parseFloat(getComputedStyle(table).maskPosition);
        expect(maskLeft).toBeCloseTo(figure.getBoundingClientRect().left + figure.clientLeft, 0);

        await scrollFigure(figure, figure.scrollWidth - figure.clientWidth);
        expect(fadeClasses(table)).toContain("scroll-fade-start");
        expect(fadeClasses(table)).not.toContain("scroll-fade-end");

        editor.model.change((writer) => {
            writer.setAttribute("tableWidth", "50%", firstTable(editor));
        });
        const fitting = domTable(domFigure(editor));
        expect(domFigure(editor).classList.contains("ck-table-overflowing")).toBe(false);
        expect(fadeClasses(fitting)).toEqual([]);
        expect(fitting.style.getPropertyValue(VIEWPORT_WIDTH_PROPERTY)).toBe("");

        // A table that replaces a scrolling one gets a fade of its own.
        editor.model.change((writer) => {
            writer.setAttribute("tableWidth", "150%", firstTable(editor));
        });
        setModelData(editor.model, modelTable([ [ "c", "d" ] ], 'tableWidth="200%"'));
        expect(fadeClasses(domTable(domFigure(editor)))).toContain("scroll-fade-end");
    });

    it("anchors the mask on the right of a right-to-left table", async () => {
        const editor = await createTestEditor(PLUGINS, { language: { content: "ar" } });
        setEditableWidth(editor, 400);
        setModelData(editor.model, modelTable([ [ "a", "b" ] ], 'tableWidth="150%"'));
        const figure = domFigure(editor);
        const table = domTable(figure);
        expect(getComputedStyle(figure).direction).toBe("rtl");
        expect(fadeClasses(table)).toEqual([
            "scroll-fade", "scroll-fade-horizontal", "scroll-fade-end", "scroll-fade-rtl"
        ]);
        expect(getComputedStyle(table).getPropertyValue("--scroll-fade-direction")).toBe("to left");
        expect(getComputedStyle(table).maskPosition).toContain("100%");

        // `table_scroll.css` puts the mask at the full overflow plus the negative `scrollLeft`.
        await scrollFigure(figure, -100);
        const visibleLeft = figure.getBoundingClientRect().left + figure.clientLeft;
        expect(visibleLeft - table.getBoundingClientRect().left)
            .toBeCloseTo(table.offsetWidth - figure.clientWidth - 100, 0);
        expect(fadeClasses(table)).toContain("scroll-fade-start");
    });
});

/** Loads the stylesheet of the editor for the tests of the enclosing `describe`. */
function useEditorStylesheet() {
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
}

function domTable(figure: HTMLElement) {
    const table = figure.querySelector(":scope > table");
    if (!(table instanceof HTMLTableElement)) {
        throw new Error("The figure has no table.");
    }
    return table;
}

/** Expects `control` within the visible part of `figure` and returns its left edge. */
function expectInside(figure: HTMLElement, control: Element | null) {
    const bounds = figure.getBoundingClientRect();
    const top = bounds.top + figure.clientTop;
    const left = bounds.left + figure.clientLeft;
    const rect = control?.getBoundingClientRect();
    expect(rect?.top).toBeGreaterThanOrEqual(top - 0.5);
    expect(rect?.bottom).toBeLessThanOrEqual(top + figure.clientHeight + 0.5);
    expect(rect?.left).toBeGreaterThanOrEqual(left - 0.5);
    expect(rect?.right).toBeLessThanOrEqual(left + figure.clientWidth + 0.5);
    return rect?.left ?? NaN;
}

function rectOf(element: Element | null) {
    return element?.getBoundingClientRect() ?? new DOMRect(NaN, NaN, NaN, NaN);
}

function setReferenceWidth(width: string) {
    document.body.style.setProperty(REFERENCE_WIDTH_PROPERTY, width);
    onTestFinished(() => {
        document.body.style.removeProperty(REFERENCE_WIDTH_PROPERTY);
    });
}

function setEditableWidth(editor: ClassicEditor, width: number) {
    editor.ui.element?.style.setProperty("width", `${width}px`);
}

function tableScroll(editor: ClassicEditor) {
    return editor.plugins.get(TriliumTableScroll);
}

function firstTable(editor: ClassicEditor): ModelElement {
    const table = editor.model.document.getRoot()?.getChild(0);
    if (!table?.is("element", "table")) {
        throw new Error("The first root child is not a table.");
    }
    return table;
}

function domFigure(editor: ClassicEditor) {
    const figure = editor.editing.view.getDomRoot()?.querySelector(":scope > figure.table");
    if (!(figure instanceof HTMLElement)) {
        throw new Error("The editable has no table.");
    }
    return figure;
}

/** Expects the table to scroll inside its figure, `width` wide. */
function expectScrolling(editor: ClassicEditor, width: string) {
    const figure = domFigure(editor);
    expect(figure.classList.contains("ck-table-overflowing")).toBe(true);
    expect(figure.style.width).toBe("");
    expect(figure.querySelector("table")?.style.width).toBe(width);
}

/** Expects the table to scroll inside its figure at the width of its content. */
function expectContentScrolling(editor: ClassicEditor) {
    const figure = domFigure(editor);
    const table = figure.querySelector("table");
    expect(figure.classList.contains("ck-table-overflowing")).toBe(true);
    expect(figure.style.width).toBe("");
    expect(table?.style.width).toBe("");
    expect(table?.getBoundingClientRect().width).toBeGreaterThan(figure.clientWidth);
}

/** Replaces the text of the last cell of the first table. */
function replaceLastCellText(editor: ClassicEditor, text: string) {
    const cells = [...editor.model.createRangeIn(firstTable(editor)).getItems()]
        .filter((item) => item.is("element", "tableCell"));
    const paragraph = cells.at(-1)?.getChild(0);
    if (!paragraph?.is("element", "paragraph")) {
        throw new Error("The last cell has no paragraph.");
    }
    editor.model.change((writer) => {
        writer.remove(writer.createRangeIn(paragraph));
        writer.insertText(text, paragraph, 0);
    });
}

/** Expects the table to fit, its figure `width` wide. */
function expectFitting(editor: ClassicEditor, width: string) {
    const figure = domFigure(editor);
    expect(figure.classList.contains("ck-table-overflowing")).toBe(false);
    expect(figure.style.width).toBe(width);
    expect(figure.querySelector("table")?.style.width).toBe("");
}
