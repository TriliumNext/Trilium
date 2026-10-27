import {
    _getTableColumnsWidths as getTableColumnsWidths,
    _setModelData as setModelData,
    BalloonEditor,
    ClassicEditor,
    DecoupledEditor,
    Essentials,
    Paragraph,
    Table,
    TableColumnResize,
    TableProperties
} from "ckeditor5";
import type { Editor, ModelElement } from "ckeditor5";
import editorStylesheetUrl from "ckeditor5/ckeditor5.css?url";
import {
    afterAll,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    type MockInstance,
    onTestFinished,
    vi
} from "vitest";

import { createTestEditor, createTestEditorOf } from "../../../test/editor-kit.js";
import { cellAt, modelTable, selectCells } from "../../../test/table-kit.js";
import type { CellSpec } from "../../../test/table-kit.js";
import { REFERENCE_WIDTH_PROPERTY } from "../table_scroll.js";
import TableColumnBar, { findSnapPoint, getCenteredGrowth } from "./table_column_bar.js";

const PLUGINS = [Essentials, Paragraph, Table, TableColumnResize, TableColumnBar];

describe("findSnapPoint", () => {
    it("takes the closest point within the snap distance", () => {
        expect(findSnapPoint(105, [100, 200])).toBe(100);
        expect(findSnapPoint(195, [100, 200, 197])).toBe(197);
        expect(findSnapPoint(150, [100, 200])).toBeNull();
        expect(findSnapPoint(108, [100])).toBe(100);
        expect(findSnapPoint(109, [100])).toBeNull();
    });
});

describe("getCenteredGrowth", () => {
    it("doubles the distance while the table fits and adds the rest of the gap after", () => {
        expect(getCenteredGrowth(30, 76)).toBe(60);
        expect(getCenteredGrowth(-20, 76)).toBe(-40);
        expect(getCenteredGrowth(38, 76)).toBe(76);
        expect(getCenteredGrowth(50, 76)).toBe(88);
    });

    it("follows the distance while the table is wider than its container", () => {
        expect(getCenteredGrowth(10, -24)).toBe(10);
        expect(getCenteredGrowth(-24, -24)).toBe(-24);
        expect(getCenteredGrowth(-30, -24)).toBe(-36);
        expect(getCenteredGrowth(5, 0)).toBe(5);
    });
});

describe("TableColumnBar", () => {
    const link = document.createElement("link");
    let editor: ClassicEditor;
    let vibrate: MockInstance<Navigator["vibrate"]>;

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

    beforeEach(async () => {
        const capture = vi.spyOn(Element.prototype, "setPointerCapture").mockImplementation(() => {});
        vibrate = vi.spyOn(navigator, "vibrate").mockReturnValue(true);
        onTestFinished(() => {
            capture.mockRestore();
            vibrate.mockRestore();
        });
        editor = await createTestEditor(PLUGINS);
        setEditableWidth(editor, 400);
    });

    describe("visibility", () => {
        it("shows the bar for the table at the selection after a touch", async () => {
            setModelData(editor.model, modelTable([["a[]", "b"]]));
            editor.editing.view.focus();
            await expect.poll(() => editor.ui.focusTracker.isFocused).toBe(true);
            await frames();
            expect(barView(editor).isVisible).toBe(false);

            touch();
            await expect.poll(() => barView(editor).isVisible).toBe(true);
            expect(barView(editor).element?.getAttribute("aria-label")).toBe("Table columns");

            touch("mouse");
            await expect.poll(() => barView(editor).isVisible).toBe(false);
        });

        it("hides the bar outside a table, in read-only mode and while blurred", async () => {
            await showBar(editor, `${modelTable([["a[]", "b"]])}<paragraph>x</paragraph>`);

            setSelectionIn(editor, "paragraph");
            await expect.poll(() => barView(editor).isVisible).toBe(false);
            editor.model.change((writer) => writer.setSelection(cellAt(editor, 0, 1), 0));
            await expect.poll(() => barView(editor).isVisible).toBe(true);

            editor.enableReadOnlyMode("spec");
            await expect.poll(() => barView(editor).isVisible).toBe(false);
            editor.disableReadOnlyMode("spec");
            await expect.poll(() => barView(editor).isVisible).toBe(true);

            // The caret is in the nested editable of a cell, which takes the focus.
            (document.activeElement as HTMLElement | null)?.blur();
            await expect.poll(() => barView(editor).isVisible).toBe(false);
        });

        it("stays shown when a mouse presses the bar, and opens no context menu", async () => {
            await showBar(editor, modelTable([["a[]", "b"]]));

            const track = barView(editor).track;
            track.dispatchEvent(new PointerEvent("pointerdown", {
                bubbles: true,
                pointerType: "mouse",
                isPrimary: true
            }));
            await frames();
            expect(barView(editor).isVisible).toBe(true);

            const contextMenu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
            segments(editor)[0].dispatchEvent(contextMenu);
            expect(contextMenu.defaultPrevented).toBe(true);
        });

        it("hides the bar while the table is out of view", async () => {
            await showBar(editor, modelTable([["a[]", "b"]]));
            const editorElement = editor.ui.element as HTMLElement;

            editorElement.style.marginTop = "200vh";
            window.dispatchEvent(new Event("resize"));
            await expect.poll(() => barView(editor).isVisible).toBe(false);

            editorElement.style.marginTop = "";
            editorElement.style.marginLeft = "-200vw";
            window.dispatchEvent(new Event("resize"));
            await frames();
            expect(barView(editor).isVisible).toBe(false);

            editorElement.style.marginLeft = "";
            window.dispatchEvent(new Event("resize"));
            await expect.poll(() => barView(editor).isVisible).toBe(true);
        });
    });

    describe("layout", () => {
        it("lines the segments and dividers up with the columns as the table scrolls", async () => {
            await showBar(editor, modelTable([["a[]", "b"]], 'tableWidth="200%"'));
            const figure = domFigure(editor);
            expect(figure.classList.contains("ck-table-overflowing")).toBe(true);
            expectAligned(editor);
            expect(dividers(editor).map((divider) => divider.getAttribute("aria-label")))
                .toEqual(["Column 1 width: 50%", "Column 2 width: 50%"]);

            figure.scrollLeft = 150;
            await frames();
            expectAligned(editor);
            const trackRect = barView(editor).track.getBoundingClientRect();
            const figureRect = figure.getBoundingClientRect();
            expectNear(trackRect.left, figureRect.left + figure.clientLeft);
            expectNear(trackRect.right, figureRect.left + figure.clientLeft + figure.clientWidth);
        });

        it("spans the bottom of the scroll container of the editable", async () => {
            const scroller = document.createElement("div");
            scroller.style.cssText = "height: 300px; width: 500px; margin-left: 20px; overflow: auto";
            document.body.append(scroller);
            scroller.append(editor.ui.element as HTMLElement);
            onTestFinished(() => scroller.remove());

            const paragraphs = "<paragraph>x</paragraph>".repeat(30);
            await showBar(editor, `<paragraph>x</paragraph>${modelTable([["a[]", "b"]])}${paragraphs}`);
            const barRect = barRectOf(editor);
            const scrollerRect = scroller.getBoundingClientRect();
            expectNear(barRect.left, scrollerRect.left);
            expectNear(barRect.width, scroller.clientWidth);
            expectNear(barRect.bottom, scrollerRect.top + scroller.clientHeight);

            scroller.scrollTop = 20;
            await frames();
            expectAligned(editor);
        });

        it("sits above a toolbar at the bottom and keeps the balloons above itself", async () => {
            const withToolbar = await createTestEditor(PLUGINS, { toolbar: ["undo", "redo"] });
            const toolbar = withToolbar.ui.view.toolbar.element as HTMLElement;
            toolbar.style.cssText = "position: fixed; bottom: 0; left: 0; right: 0";
            const initialOffset = withToolbar.ui.viewportOffset.bottom;

            await showBar(withToolbar, `${modelTable([["a[]", "b"]])}<paragraph>x</paragraph>`);
            const barRect = barRectOf(withToolbar);
            const toolbarRect = toolbar.getBoundingClientRect();
            expect(toolbarRect.height).toBeGreaterThan(0);
            expectNear(barRect.bottom, toolbarRect.top);
            expect(withToolbar.ui.viewportOffset.bottom)
                .toBe(Math.round(window.innerHeight - barRect.top));

            setSelectionIn(withToolbar, "paragraph");
            await expect.poll(() => barView(withToolbar).isVisible).toBe(false);
            expect(withToolbar.ui.viewportOffset.bottom ?? 0).toBe(initialOffset ?? 0);
        });

        it("sits above the element of `tableColumnBar.bottomObstacle`, wherever it floats", async () => {
            const card = document.createElement("div");
            card.style.cssText = "position: fixed; bottom: 6px; left: 6px; right: 6px; height: 44px";
            document.body.appendChild(card);
            let obstacle: HTMLElement | null = card;
            const floating = await createTestEditor(PLUGINS, {
                tableColumnBar: { bottomObstacle: () => obstacle }
            });

            await showBar(floating, modelTable([["a[]", "b"]]));
            expectNear(barRectOf(floating).bottom, card.getBoundingClientRect().top);

            // Without one, the bar goes back to the bottom of the viewport.
            obstacle = null;
            window.dispatchEvent(new Event("resize"));
            await expect.poll(() => Math.abs(barRectOf(floating).bottom - document.documentElement.clientHeight))
                .toBeLessThan(1.5);
            card.remove();
        });

        it("corrects for `position: fixed` placing it off the measured viewport", async () => {
            const card = document.createElement("div");
            card.style.cssText = "position: fixed; bottom: 6px; left: 6px; right: 6px; height: 44px";
            document.body.appendChild(card);
            const shifted = await createTestEditor(PLUGINS, {
                tableColumnBar: { bottomObstacle: () => card }
            });
            // iOS places fixed elements against the layout viewport while the keyboard scrolls
            // the visual viewport, which a transformed container reproduces.
            const container = barView(shifted).element?.parentElement;
            expect(container).toBeInstanceOf(HTMLElement);
            container?.style.setProperty("transform", "translate(-30px, -40px)");

            try {
                await showBar(shifted, modelTable([["a[]", "b"]], 'tableWidth="80%"'));
                expectNear(barRectOf(shifted).bottom, card.getBoundingClientRect().top);
                expectAligned(shifted);

                const { x, y } = press(dividers(shifted)[0]);
                moveTo(x + 50, y);
                await expect.poll(() => isEdgeShown(shifted)).toBe(true);
                expectNear(edgeRectOf(shifted).left + 1, endEdgeOf(shifted, 0));
                release();
            } finally {
                container?.style.removeProperty("transform");
                card.remove();
            }
        });

        it("works with an editor without a toolbar and with a detached one", async () => {
            const balloon = await createTestEditorOf(BalloonEditor, PLUGINS);
            const decoupled = await createTestEditorOf(DecoupledEditor, PLUGINS);
            for (const other of [balloon, decoupled]) {
                await showBar(other, modelTable([["a[]", "b"]]));
                expectNear(barRectOf(other).bottom, document.documentElement.clientHeight);
            }
        });

        it("leaves room after the end of a scrolling table while touch is in use", async () => {
            const rtl = await createTestEditor(PLUGINS, { language: { content: "ar" } });
            setEditableWidth(rtl, 400);
            for (const each of [editor, rtl]) {
                await showBar(each, modelTable([["a", "b[]"]], 'tableWidth="200%"'));
                scrollToEnd(each);
                await frames();
                expectNear(roomAfterTable(each), 64);

                // The last divider takes a press across its whole width.
                const divider = dividers(each)[1];
                const { x, y } = centerOf(divider);
                expect(document.elementFromPoint(x + 10 * directionOf(each), y)).toBe(divider);
            }

            touch("mouse");
            for (const each of [editor, rtl]) {
                await expect.poll(() => roomAfterTable(each)).toBeLessThan(1);
            }
        });
    });

    describe("segments", () => {
        it("selects the column on a tap", async () => {
            await showBar(editor, modelTable([["a[]", "b"], ["c", "d"]]));

            press(segments(editor)[1]);
            release();
            expect(selectedCells(editor)).toEqual([cellAt(editor, 0, 1), cellAt(editor, 1, 1)]);
        });

        it("opens the column menu on a long press", async () => {
            await showBar(editor, `${modelTable([["a[]", "b"], ["c", "d"]])}<paragraph>x</paragraph>`);
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            onTestFinished(() => {
                vi.useRealTimers();
            });

            const { x, y } = press(segments(editor)[0]);
            vi.advanceTimersByTime(500);
            const menu = barView(editor).menus.first;
            expect(menu?.isOpen).toBe(true);
            expect(vibrate).toHaveBeenCalledWith(10);
            expect(selectedCells(editor)).toEqual([cellAt(editor, 0, 0), cellAt(editor, 1, 0)]);
            const button = menu?.buttonView.element?.getBoundingClientRect();
            const segment = segments(editor)[0].getBoundingClientRect();
            expectNear((button?.left ?? 0) + (button?.width ?? 0) / 2, segment.left + segment.width / 2);

            moveTo(x + 50, y);
            release();
            expect(selectedCells(editor)).toEqual([cellAt(editor, 0, 0), cellAt(editor, 1, 0)]);

            press(segments(editor)[1]);
            expect(menu?.isOpen).toBe(false);
            vi.advanceTimersByTime(500);
            release();
            expect(barView(editor).menus.length).toBe(1);
            expect(menu?.isOpen).toBe(true);

            vi.useRealTimers();
            setSelectionIn(editor, "paragraph");
            await expect.poll(() => menu?.isOpen).toBe(false);
        });

        it("scrolls the table on a swipe", async () => {
            await showBar(editor, modelTable([["a[]", "b"]], 'tableWidth="300%"'));
            const figure = domFigure(editor);

            const { x, y } = press(segments(editor)[0]);
            moveTo(x - 100, y);
            expect(figure.scrollLeft).toBe(100);
            moveTo(x - 40, y);
            expect(figure.scrollLeft).toBe(40);
            release();
            expect(selectedCells(editor)).toEqual([]);
        });

        it("ignores a press of a second finger and cancels the first one's tap", async () => {
            await showBar(editor, modelTable([["a[]", "b"]]));

            press(segments(editor)[0]);
            press(segments(editor)[1], { pointerId: 2, isPrimary: false });
            release(2);
            release();
            expect(selectedCells(editor)).toEqual([]);
        });
    });

    describe("dividers", () => {
        it("shows a resize on the table and saves it to the model on release", async () => {
            await showBar(editor, modelTable([["a[]", "b"]], 'tableWidth="80%"'));
            const table = firstTable(editor);
            const before = columnWidths(editor);
            const edge = endEdgeOf(editor, 0);

            const { x, y } = press(dividers(editor)[0]);
            moveTo(x + 50, y);
            expectNear(endEdgeOf(editor, 0), edge + 50);
            expect(columnWidths(editor)[0]).toBeGreaterThan(before[0] + 50);
            expectNear(columnWidths(editor)[1], before[1]);
            expect(table.getAttribute("tableWidth")).toBe("80%");
            expect(getTableColumnsWidths(table)).toEqual([]);
            await expect.poll(() => isEdgeShown(editor)).toBe(true);
            expectNear(edgeRectOf(editor).left + 1, endEdgeOf(editor, 0));
            expect(dividers(editor)[0].classList.contains("ck-table-column-bar__divider_active"))
                .toBe(true);

            release();
            expectNear(endEdgeOf(editor, 0), edge + 50);
            expectNear(columnWidths(editor)[1], before[1]);
            expect(table.getAttribute("tableWidth")).toMatch(/%$/);
            expect(getTableColumnsWidths(table)).toHaveLength(2);
            expect(domFigure(editor).querySelectorAll("colgroup")).toHaveLength(1);
            await expect.poll(() => isEdgeShown(editor)).toBe(false);

            editor.execute("undo");
            expect(table.getAttribute("tableWidth")).toBe("80%");
            expect(getTableColumnsWidths(table)).toEqual([]);
        });

        it("resizes only the columns of the cells at the selection", async () => {
            const rows = [["a", "b[]", "c"], ["d", "e", "f"]];
            await showBar(editor, modelTable(rows, 'tableWidth="80%"'));
            const table = firstTable(editor);
            expect(resizableColumns(editor)).toEqual([1]);

            // Another divider lets a press through to the segments, and ignores one sent to it.
            const { x, y } = centerOf(dividers(editor)[0]);
            const pressed = document.elementFromPoint(x, y);
            expect(pressed?.classList.contains("ck-table-column-bar__segment")).toBe(true);
            const resizable = centerOf(dividers(editor)[1]);
            expect(document.elementFromPoint(resizable.x, resizable.y)).toBe(dividers(editor)[1]);
            press(dividers(editor)[0]);
            moveTo(x + 40, y);
            release();
            expect(getTableColumnsWidths(table)).toEqual([]);

            press(segments(editor)[0]);
            release();
            await expect.poll(() => resizableColumns(editor)).toEqual([0]);

            selectCells(editor, [0, 1], [1, 2]);
            await expect.poll(() => resizableColumns(editor)).toEqual([1, 2]);

            editor.model.change((writer) => writer.setSelection(table, "on"));
            await expect.poll(() => resizableColumns(editor)).toEqual([]);

            const merged = [[{ contents: "a[]", colspan: 2 }, "b"], ["c", "d", "e"]];
            await showBar(editor, modelTable(merged));
            await expect.poll(() => resizableColumns(editor)).toEqual([0, 1]);
        });

        it("keeps pixels for a table sized in pixels", async () => {
            const widths = ["100px", "200px"];
            await showBar(editor, resizedTable([["a", "b[]"]], widths, 'tableWidth="300px"'));
            const table = firstTable(editor);
            const edge = endEdgeOf(editor, 1);

            const { x, y } = press(dividers(editor)[1]);
            moveTo(x + 30, y);
            release();
            expectNear(endEdgeOf(editor, 1), edge + 30);
            const tableWidth = parseFloat(String(table.getAttribute("tableWidth")));
            expect(table.getAttribute("tableWidth")).toBe(`${tableWidth}px`);
            const savedWidths = getTableColumnsWidths(table);
            expectNear(parseFloat(savedWidths[0]), 100);
            expectNear(parseFloat(savedWidths[1]), tableWidth - 100);
        });

        it("grows a column by the distance dragged in a table aligned to a side", async () => {
            const aligned = await createTestEditor([...PLUGINS, TableProperties]);
            setEditableWidth(aligned, 400);
            const widths = ["100px", "200px"];
            await showBar(aligned, resizedTable([["a[]", "b"]], widths,
                'tableWidth="300px" tableAlignment="blockLeft"'));
            const edge = endEdgeOf(aligned, 0);

            const { x, y } = press(dividers(aligned)[0]);
            moveTo(x + 30, y);
            release();
            expectNear(endEdgeOf(aligned, 0), edge + 30);
            expect(getTableColumnsWidths(firstTable(aligned)).map(parseFloat)).toEqual([130, 200]);
        });

        it("measures a percentage against the reference width", async () => {
            document.body.style.setProperty(REFERENCE_WIDTH_PROPERTY, "1200px");
            onTestFinished(() => {
                document.body.style.removeProperty(REFERENCE_WIDTH_PROPERTY);
            });
            const referenced = await createTestEditor(PLUGINS);
            setEditableWidth(referenced, 400);
            await showBar(referenced, modelTable([["a", "b[]"]], 'tableWidth="25%"'));
            const edge = endEdgeOf(referenced, 1);

            const { x, y } = press(dividers(referenced)[1]);
            moveTo(x + 60, y);
            release();
            expectNear(endEdgeOf(referenced, 1), edge + 60);
            const share = columnWidths(referenced).reduce((sum, width) => sum + width) / 1200 * 100;
            const tableWidth = String(firstTable(referenced).getAttribute("tableWidth"));
            expect(tableWidth).toMatch(/%$/);
            expectNear(parseFloat(tableWidth), share);
        });

        it("snaps to the start width and the widths beside it", async () => {
            const widths = ["100px", "200px", "100px"];
            await showBar(editor, resizedTable([["a[]", "b", "c"]], widths, 'tableWidth="400px"'));
            const table = firstTable(editor);

            const { x, y } = press(dividers(editor)[0]);
            moveTo(x + 95, y);
            expectNear(columnWidths(editor)[0], 200);
            expect(vibrate).toHaveBeenCalledTimes(1);
            moveTo(x + 96, y);
            expect(vibrate).toHaveBeenCalledTimes(1);
            moveTo(x + 40, y);
            expectNear(columnWidths(editor)[0], 140);
            moveTo(x + 4, y);
            expectNear(columnWidths(editor)[0], 100);
            expect(vibrate).toHaveBeenCalledTimes(2);

            release();
            expect(getTableColumnsWidths(table)).toEqual(widths);
            expect(table.getAttribute("tableWidth")).toBe("400px");
        });

        it("vibrates only where the device can", async () => {
            vibrate.mockRestore();
            Object.defineProperty(navigator, "vibrate", { value: undefined, configurable: true });
            onTestFinished(() => {
                Reflect.deleteProperty(navigator, "vibrate");
            });
            await showBar(editor, resizedTable([["a[]", "b"]], ["100px", "100px"], 'tableWidth="200px"'));

            const { x, y } = press(dividers(editor)[0]);
            moveTo(x - 30, y);
            moveTo(x + 2, y);
            release();
            expect(getTableColumnsWidths(firstTable(editor))).toEqual(["100px", "100px"]);
        });

        it("keeps a narrow column at its width or wider", async () => {
            await showBar(editor, resizedTable([["a[]", "b"]], ["20px", "200px"], 'tableWidth="220px"'));

            const { x, y } = press(dividers(editor)[0]);
            moveTo(x - 50, y);
            expectNear(columnWidths(editor)[0], 20);
            release();
        });

        it("cancels on a second finger, Escape and a pointercancel", async () => {
            await showBar(editor, modelTable([["a[]", "b"]], 'tableWidth="80%"'));
            const table = firstTable(editor);
            const before = columnWidths(editor);
            const cancellations = [
                () => press(segments(editor)[1], { pointerId: 2, isPrimary: false }),
                () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
                () => window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1 }))
            ];

            for (const cancel of cancellations) {
                const { x, y } = press(dividers(editor)[0]);
                moveTo(x + 40, y);
                cancel();
                release();
                expectNear(columnWidths(editor)[0], before[0]);
                expect(table.getAttribute("tableWidth")).toBe("80%");
                expect(domFigure(editor).querySelector("colgroup")).toBeNull();
                expect(domFigure(editor).querySelector("table.ck-table-resized")).toBeNull();
            }
        });

        it("restores the saved widths of a resized table on a cancel", async () => {
            const widths = ["100px", "200px"];
            await showBar(editor, resizedTable([["a[]", "b"]], widths, 'tableWidth="300px"'));

            const { x, y } = press(dividers(editor)[0]);
            moveTo(x + 40, y);
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            expectNear(columnWidths(editor)[0], 100);
            expect(getTableColumnsWidths(firstTable(editor))).toEqual(widths);
            expect(domFigure(editor).querySelector("table.ck-table-resized")).not.toBeNull();
        });

        it("cancels a resize when the bar hides", async () => {
            await showBar(editor, modelTable([["a[]", "b"]], 'tableWidth="80%"'));

            const { x, y } = press(dividers(editor)[0]);
            moveTo(x + 40, y);
            editor.enableReadOnlyMode("spec");
            await expect.poll(() => barView(editor).isVisible).toBe(false);
            release();
            expect(firstTable(editor).getAttribute("tableWidth")).toBe("80%");
            expect(domFigure(editor).querySelector("colgroup")).toBeNull();
        });

        it("scrolls the table near the ends of its visible part", async () => {
            await showBar(editor, modelTable([["a[]", "b", "c"]], 'tableWidth="200%"'));
            const figure = domFigure(editor);
            const before = columnWidths(editor);

            const start = press(dividers(editor)[0]);
            const trackRect = barView(editor).track.getBoundingClientRect();
            moveTo(trackRect.right - 5, start.y);
            await expect.poll(() => figure.scrollLeft).toBeGreaterThan(100);
            release();
            const grown = columnWidths(editor)[0];
            expect(grown).toBeGreaterThan(before[0] + (trackRect.right - 5 - start.x) + 50);

            const end = press(dividers(editor)[0]);
            const scrolled = figure.scrollLeft;
            moveTo(trackRect.left + 5, end.y);
            await expect.poll(() => figure.scrollLeft).toBeLessThan(scrolled - 50);
            release();
            expect(columnWidths(editor)[0]).toBeLessThan(grown);
        });

        it("keeps a scrolled table still while the last divider moves into the room", async () => {
            await showBar(editor, modelTable([["a", "b[]"]], 'tableWidth="200%"'));
            const figure = domFigure(editor);
            scrollToEnd(editor);
            await frames();
            const scrolled = figure.scrollLeft;
            const edge = endEdgeOf(editor, 1);

            const { x, y } = press(dividers(editor)[1]);
            moveTo(x + 16, y);
            await frames();
            await frames();
            expect(figure.scrollLeft).toBe(scrolled);
            expectNear(endEdgeOf(editor, 1), edge + 16);
            release();
        });

        it("evens out the two columns beside a divider on a double tap", async () => {
            const widths = ["100px", "200px", "100px"];
            await showBar(editor, resizedTable([["a[]", "b", "c"]], widths, 'tableWidth="400px"'));
            const table = firstTable(editor);
            selectCells(editor, [0, 0], [0, 2]);
            await expect.poll(() => resizableColumns(editor)).toEqual([0, 1, 2]);

            tapDivider(editor, 0);
            tapDivider(editor, 1);
            tapDivider(editor, 2);
            tapDivider(editor, 2);
            expect(getTableColumnsWidths(table)).toEqual(widths);

            const now = vi.spyOn(performance, "now");
            onTestFinished(() => now.mockRestore());
            now.mockReturnValue(1000);
            tapDivider(editor, 0);
            now.mockReturnValue(2000);
            tapDivider(editor, 0);
            expect(getTableColumnsWidths(table)).toEqual(widths);

            now.mockReturnValue(2100);
            tapDivider(editor, 0);
            expect(getTableColumnsWidths(table)).toEqual(["150px", "150px", "100px"]);
        });

        it("takes a tap after a drag, a press or on another table as a first tap", async () => {
            const widths = ["100px", "200px", "100px"];
            const tables = [["a[]", "b", "c"], ["d", "e", "f"]]
                .map((row) => resizedTable([row], widths, 'tableWidth="400px"'));
            await showBar(editor, tables.join(""));
            const first = firstTable(editor);
            const second = editor.model.document.getRoot()?.getChild(1);
            if (!second?.is("element", "table")) {
                throw new Error("The second root child is not a table.");
            }
            const now = vi.spyOn(performance, "now").mockReturnValue(1000);
            onTestFinished(() => now.mockRestore());

            tapDivider(editor, 0);
            const { x, y } = press(dividers(editor)[0]);
            moveTo(x + 30, y);
            release();
            const dragged = getTableColumnsWidths(first);
            tapDivider(editor, 0);
            const afterDrag = getTableColumnsWidths(first);

            // Each section starts long after the last tap of the one before.
            now.mockReturnValue(2000);
            tapDivider(editor, 0);
            press(segments(editor)[0]);
            release();
            tapDivider(editor, 0);
            const afterPress = getTableColumnsWidths(first);

            now.mockReturnValue(3000);
            tapDivider(editor, 0);
            editor.model.change((writer) => writer.setSelection(second.getNodeByPath([0, 0]), 0));
            await frames();
            tapDivider(editor, 0);

            const afterSwitch = [getTableColumnsWidths(first), getTableColumnsWidths(second)];
            expect([afterDrag, afterPress, ...afterSwitch])
                .toEqual([dragged, dragged, dragged, widths]);
        });

        it("resizes towards the left in right-to-left content", async () => {
            const rtl = await createTestEditor(PLUGINS, { language: { content: "ar" } });
            setEditableWidth(rtl, 400);
            await showBar(rtl, resizedTable([["a[]", "b"]], ["100px", "200px"], 'tableWidth="300px"'));
            expectAligned(rtl);
            const edge = endEdgeOf(rtl, 0);

            const { x, y } = press(dividers(rtl)[0]);
            moveTo(x - 30, y);
            release();
            expectNear(endEdgeOf(rtl, 0), edge - 30);
            const widths = getTableColumnsWidths(firstTable(rtl));
            expect(parseFloat(widths[0])).toBeGreaterThan(130);
            expectNear(parseFloat(widths[1]), 200);
        });

        it("stops the resize when the editor is destroyed", async () => {
            const element = document.createElement("div");
            document.body.append(element);
            const own = await ClassicEditor.create(element, { licenseKey: "GPL", plugins: PLUGINS });
            await showBar(own, modelTable([["a[]", "b"]]));

            const { x, y } = press(dividers(own)[0]);
            moveTo(x + 20, y);
            await own.destroy();
            element.remove();
            moveTo(x + 40, y);
            release();
        });
    });
});

/** Waits for two animation frames, for the updates the plugin schedules. */
async function frames() {
    for (let frame = 0; frame < 2; frame++) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
    }
}

async function showBar(editor: Editor, data: string) {
    setModelData(editor.model, data);
    editor.editing.view.focus();
    touch();
    await expect.poll(() => barView(editor).isVisible).toBe(true);
}

function touch(pointerType = "touch") {
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType }));
}

function centerOf(element: Element) {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function press(element: Element, init: PointerEventInit = {}) {
    const { x, y } = centerOf(element);
    element.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        isPrimary: true,
        pointerType: "touch",
        clientX: x,
        clientY: y,
        ...init
    }));
    return { x, y };
}

function moveTo(clientX: number, clientY: number) {
    window.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX, clientY }));
}

function release(pointerId = 1) {
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId }));
}

function tapDivider(editor: Editor, column: number) {
    press(dividers(editor)[column]);
    release();
}

function barView(editor: Editor) {
    return editor.plugins.get(TableColumnBar).view;
}

function barRectOf(editor: Editor) {
    return barView(editor).element?.getBoundingClientRect() ?? new DOMRect();
}

function segments(editor: Editor) {
    return [...barView(editor).track.querySelectorAll<HTMLElement>(".ck-table-column-bar__segment")];
}

function dividers(editor: Editor) {
    return [...barView(editor).track.querySelectorAll<HTMLElement>(".ck-table-column-bar__divider")];
}

function resizableColumns(editor: Editor) {
    return dividers(editor)
        .filter((divider) => divider.classList.contains("ck-table-column-bar__divider_resizable"))
        .map((divider) => Number(divider.dataset.column));
}

function edgeElementOf(editor: Editor) {
    const edge = barView(editor).element?.querySelector(".ck-table-column-bar__edge");
    if (!(edge instanceof HTMLElement)) {
        throw new Error("The bar has no edge line.");
    }
    return edge;
}

function isEdgeShown(editor: Editor) {
    return !edgeElementOf(editor).classList.contains("ck-hidden");
}

function edgeRectOf(editor: Editor) {
    return edgeElementOf(editor).getBoundingClientRect();
}

/** Expects each segment over its column and each divider at the inline end of its column. */
function expectAligned(editor: Editor) {
    const isRtl = editor.locale.contentLanguageDirection === "rtl";
    for (const [index, cell] of domCells(editor).entries()) {
        const cellRect = cell.getBoundingClientRect();
        const segmentRect = segments(editor)[index].getBoundingClientRect();
        const dividerRect = dividers(editor)[index].getBoundingClientRect();
        expectNear(segmentRect.left, cellRect.left);
        expectNear(segmentRect.right, cellRect.right);
        expectNear(dividerRect.left + dividerRect.width / 2, isRtl ? cellRect.left : cellRect.right);
    }
}

function expectNear(actual: number, expected: number) {
    expect(Math.abs(actual - expected)).toBeLessThan(1.5);
}

function setEditableWidth(editor: Editor, width: number) {
    editor.ui.element?.style.setProperty("width", `${width}px`);
}

function setSelectionIn(editor: Editor, name: string) {
    const root = editor.model.document.getRoot();
    const element = root && [...root.getChildren()].find((child) => child.is("element", name));
    if (!element) {
        throw new Error(`The root has no ${name}.`);
    }
    editor.model.change((writer) => writer.setSelection(element, 0));
}

function firstTable(editor: Editor): ModelElement {
    const table = editor.model.document.getRoot()?.getChild(0);
    if (!table?.is("element", "table")) {
        throw new Error("The first root child is not a table.");
    }
    return table;
}

function domFigure(editor: Editor) {
    const figure = editor.editing.view.getDomRoot()?.querySelector(":scope > figure.table");
    if (!(figure instanceof HTMLElement)) {
        throw new Error("The editable has no table.");
    }
    return figure;
}

function domCells(editor: Editor) {
    return [...domFigure(editor).querySelectorAll<HTMLElement>("tr:first-child > td")];
}

/** 1 when the inline end of a row is on the right, -1 when it is on the left. */
function directionOf(editor: Editor) {
    return editor.locale.contentLanguageDirection === "rtl" ? -1 : 1;
}

function scrollToEnd(editor: Editor) {
    const figure = domFigure(editor);
    figure.scrollLeft = figure.scrollWidth * directionOf(editor);
}

/** The distance from the inline end of the table to the inline end of its visible part. */
function roomAfterTable(editor: Editor) {
    const figure = domFigure(editor);
    const table = figure.querySelector(":scope > table");
    if (!table) {
        throw new Error("The figure has no table.");
    }

    const left = figure.getBoundingClientRect().left + figure.clientLeft;
    const tableRect = table.getBoundingClientRect();
    return directionOf(editor) > 0
        ? left + figure.clientWidth - tableRect.right
        : tableRect.left - left;
}

function columnWidths(editor: Editor) {
    return domCells(editor).map((cell) => cell.getBoundingClientRect().width);
}

/** The client x of the inline end of `column`. */
function endEdgeOf(editor: Editor, column: number) {
    const rect = domCells(editor)[column].getBoundingClientRect();
    return editor.locale.contentLanguageDirection === "rtl" ? rect.left : rect.right;
}

function selectedCells(editor: Editor) {
    return [...editor.model.document.selection.getRanges()]
        .map((range) => range.start.nodeAfter)
        .filter((node) => node?.is("element", "tableCell"));
}

function resizedTable(rows: CellSpec[][], widths: string[], attributes: string) {
    const columns = widths.map((width) => `<tableColumn columnWidth="${width}"></tableColumn>`);
    return modelTable(rows, attributes)
        .replace(/<\/table>$/, `<tableColumnGroup>${columns.join("")}</tableColumnGroup></table>`);
}
