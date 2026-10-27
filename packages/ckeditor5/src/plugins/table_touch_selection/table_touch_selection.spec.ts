import "../../theme/table_sticky_header.css";

import {
    _setModelData as setModelData,
    ClassicEditor,
    Essentials,
    Paragraph,
    Table,
    TableColumnResize,
    TableSelection
} from "ckeditor5";
import type { Editor, ModelElement } from "ckeditor5";
import editorStylesheetUrl from "ckeditor5/ckeditor5.css?url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { cdp } from "vitest/browser";

import { createTestEditor } from "../../../test/editor-kit.js";
import { modelTable, scrollFigure } from "../../../test/table-kit.js";
import TriliumTableScroll from "../table_scroll.js";
import TableStickyHeader from "../table_sticky_header.js";
import TableTouchSelection from "./table_touch_selection.js";

const PLUGINS = [
    Essentials,
    Paragraph,
    Table,
    TableColumnResize,
    TriliumTableScroll,
    TableStickyHeader,
    TableTouchSelection
];
const TOUCH_ID = 1;
const TOP_LEFT = 0;
const TOP_RIGHT = 1;
const BOTTOM_LEFT = 2;
const BOTTOM_RIGHT = 3;

const GRID = modelTable(
    [["a[]", "b", "c"], ["d", "e", "f"], ["g", "h", "i"]],
    'tableWidth="100%"'
);

describe("TableTouchSelection", () => {
    const link = document.createElement("link");
    let editor: ClassicEditor;

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
        editor = await createTestEditor(PLUGINS);
        editor.ui.element?.style.setProperty("width", "400px");
    });

    describe("overlay", () => {
        it("outlines the cell with the caret after a touch, until a mouse press", async () => {
            setModelData(editor.model, GRID);
            editor.editing.view.focus();
            await expect.poll(() => editor.ui.focusTracker.isFocused).toBe(true);
            await frames();
            expect(overlay(editor).isVisible).toBe(false);
            expect(touchStartOn(rootOf(editor), 0, 0).defaultPrevented).toBe(false);

            touch();
            touch();
            await expect.poll(() => overlay(editor).isVisible).toBe(true);
            expectAround(editor, [0, 0], [0, 0]);
            expect(overlay(editor).element?.getAttribute("aria-hidden")).toBe("true");

            touch("mouse");
            await expect.poll(() => overlay(editor).isVisible).toBe(false);
        });

        it("outlines the selected cells, and hides for text, outside tables, blurred or disabled",
            async () => {
                await showHandles(editor, `${GRID}<paragraph>x</paragraph>`);
                selectCells(editor, [0, 1], [1, 2]);
                const rightGap = () => outlineRectOf(editor).right - cellRect(editor, 1, 2).right;
                await expect.poll(() => Math.abs(rightGap())).toBeLessThan(1.5);
                expectAround(editor, [0, 1], [1, 2]);

                editor.model.change((writer) => {
                    writer.setSelection(writer.createRangeIn(paragraphIn(cell(editor, 1, 1))));
                });
                await expect.poll(() => overlay(editor).isVisible).toBe(false);

                setCaret(editor, cell(editor, 2, 2));
                await expect.poll(() => overlay(editor).isVisible).toBe(true);
                expectAround(editor, [2, 2], [2, 2]);

                setCaret(editor, rootChild(editor, 1));
                await expect.poll(() => overlay(editor).isVisible).toBe(false);
                setCaret(editor, cell(editor, 0, 0));
                await expect.poll(() => overlay(editor).isVisible).toBe(true);

                const tableSelection = editor.plugins.get(TableSelection);
                tableSelection.forceDisabled("spec");
                await expect.poll(() => overlay(editor).isVisible).toBe(false);
                tableSelection.clearForceDisabled("spec");
                await expect.poll(() => overlay(editor).isVisible).toBe(true);

                // The caret is in the nested editable of a cell, which takes the focus.
                (document.activeElement as HTMLElement | null)?.blur();
                await expect.poll(() => overlay(editor).isVisible).toBe(false);
            });

        it("fades in each time it shows, unless motion is reduced", async () => {
            await showHandles(editor, GRID);
            const element = overlayElement(editor);
            const [fadeIn] = element.getAnimations();
            const style = getComputedStyle(element);
            expect(style.animationName).toBe("ck-table-touch-selection-fade-in");
            expect(style.animationDuration).toBe("0.3s");
            await fadeIn.finished;
            expect(element.getAnimations()).toHaveLength(0);

            touch("mouse");
            await expect.poll(() => overlay(editor).isVisible).toBe(false);
            touch();
            await expect.poll(() => overlay(editor).isVisible).toBe(true);
            expect(element.getAnimations()).toHaveLength(1);

            const session = cdp() as { send(method: string, params: object): Promise<unknown> };
            const setReducedMotion = (value: string) => session.send("Emulation.setEmulatedMedia", {
                features: [{ name: "prefers-reduced-motion", value }]
            });
            await setReducedMotion("reduce");
            onTestFinished(() => setReducedMotion(""));
            expect(getComputedStyle(element).animationName).toBe("none");
        });

        it("hides while the cells are out of view", async () => {
            await showHandles(editor, GRID);
            const editorElement = editor.ui.element as HTMLElement;

            editorElement.style.marginTop = "200vh";
            window.dispatchEvent(new Event("resize"));
            await expect.poll(() => overlay(editor).isVisible).toBe(false);
            expect(touchStartOn(rootOf(editor), 0, 0).defaultPrevented).toBe(false);

            editorElement.style.marginTop = "";
            editorElement.style.marginLeft = "-200vw";
            window.dispatchEvent(new Event("resize"));
            await frames();
            expect(overlay(editor).isVisible).toBe(false);

            editorElement.style.marginLeft = "";
            window.visualViewport?.dispatchEvent(new Event("resize"));
            await expect.poll(() => overlay(editor).isVisible).toBe(true);
        });

        it("hides while the table scrolls and shows again once the scroll settles", async () => {
            const scroller = wrapInScroller(editor, 200);
            await showHandles(editor, `${GRID}${"<paragraph>x</paragraph>".repeat(12)}`);
            const elsewhere = document.createElement("div");
            elsewhere.style.cssText = "height: 50px; overflow: auto";
            elsewhere.append(document.createElement("div"));
            elsewhere.firstElementChild?.setAttribute("style", "height: 200px");
            document.body.append(elsewhere);
            onTestFinished(() => elsewhere.remove());
            await scrollBy(elsewhere, 20);
            expect(overlay(editor).isVisible).toBe(true);

            const handle = handleCenter(editor, BOTTOM_RIGHT);
            touchStart(handle.x, handle.y);
            await scrollBy(scroller, 10);
            expect(overlay(editor).isVisible).toBe(false);
            expect(touchMove(handle.x + 30, handle.y + 30).defaultPrevented).toBe(false);
            touchEnd();

            await scrollBy(scroller, 10);
            expect(overlay(editor).isVisible).toBe(false);
            await expect.poll(() => overlay(editor).isVisible).toBe(true);
            expectAround(editor, [0, 0], [0, 0]);
        });

        it("hides the handles beyond either side of a table that scrolls sideways", async () => {
            await showHandles(editor, modelTable(
                [["a[]", "b", "c", "d"], ["e", "f", "g", "h"]],
                'tableWidth="200%"'
            ));
            selectCells(editor, [0, 0], [1, 3]);
            await expect.poll(() => shownHandles(editor)).toEqual([TOP_LEFT, BOTTOM_LEFT]);

            const figure = domCell(editor, cell(editor, 0, 0)).closest("figure");
            if (!figure) {
                throw new Error("The table has no figure.");
            }
            const hidden = { x: cellRect(editor, 0, 3).right, y: cellRect(editor, 0, 3).top };
            touchStartOn(rootOf(editor), hidden.x, hidden.y);
            expect(touchMove(hidden.x - 50, hidden.y + 50).defaultPrevented).toBe(false);
            touchEnd();

            await scrollFigure(figure, figure.scrollWidth);
            await expect.poll(() => shownHandles(editor)).toEqual([TOP_RIGHT, BOTTOM_RIGHT]);
            expectAround(editor, [0, 0], [1, 3]);
        });

        it("hides the handles above the scroll container and behind the viewport offset",
            async () => {
                const scroller = wrapInScroller(editor, 200);
                const paragraphs = "<paragraph>x</paragraph>".repeat(8);
                await showHandles(editor, `<paragraph>x</paragraph>${GRID}${paragraphs}`);
                const scrollerTop = scroller.getBoundingClientRect().top;
                scroller.scrollTop += cellRect(editor, 0, 0, 1).top - scrollerTop + 10;
                await expect.poll(() => shownHandles(editor)).toEqual([BOTTOM_LEFT, BOTTOM_RIGHT]);
                expectAround(editor, [0, 0], [0, 0], 1);

                const ui = editor.ui;
                const bottom = window.innerHeight - cellRect(editor, 0, 0, 1).bottom + 5;
                ui.viewportOffset = { left: 0, right: 0, bottom };
                ui.update();
                await expect.poll(() => shownHandles(editor)).toEqual([]);
                expect(overlay(editor).isVisible).toBe(true);
            });

        it("hides the cells under the stuck header rows, unless the selection includes them",
            async () => {
                const scroller = wrapInScroller(editor, 200);
                // The client unsets the `overflow` of the editable, so the header rows stick to
                // `scroller` instead of the editable.
                editor.editing.view.change((writer) => {
                    const root = editor.editing.view.document.getRoot();
                    if (root) {
                        writer.setStyle("overflow", "visible", root);
                    }
                });
                const rows = Array.from({ length: 12 }, (_, row) => [`${row}`, "x"]);
                rows[3][0] = "3[]";
                await showHandles(editor, modelTable(rows, 'headingRows="1"'));
                await frames();
                const thead = domCell(editor, cell(editor, 0, 0)).closest("thead");
                if (!thead) {
                    throw new Error("The table has no header rows.");
                }

                const scrollerTop = scroller.getBoundingClientRect().top;
                // Leaves the top 10px of the cell with the caret under the stuck header rows.
                const headerBottom = scrollerTop + thead.getBoundingClientRect().height;
                await scrollBy(scroller, cellRect(editor, 3, 0).top - headerBottom + 10);
                await expect.poll(() => overlay(editor).isVisible).toBe(true);
                expectNear(thead.getBoundingClientRect().top, scrollerTop);
                expect(shownHandles(editor)).toEqual([BOTTOM_LEFT, BOTTOM_RIGHT]);
                expectNear(clipRectOf(editor).top, thead.getBoundingClientRect().bottom);

                selectCells(editor, [0, 0], [0, 1]);
                await expect.poll(() => shownHandles(editor))
                    .toEqual([TOP_LEFT, TOP_RIGHT, BOTTOM_LEFT, BOTTOM_RIGHT]);
                expectAround(editor, [0, 0], [0, 1]);
            });

        it("follows the cells when the table moves and into another table", async () => {
            // A table without a width stays centered, so it moves when the editable resizes.
            const second = modelTable([["c", "d"], ["e", "f"]]);
            const first = modelTable([["a[]", "b"]]);
            await showHandles(editor, `${first}<paragraph>x</paragraph>${second}`);
            editor.ui.element?.style.setProperty("width", "300px");
            const rightGap = () => outlineRectOf(editor).right - cellRect(editor, 0, 0).right;
            await expect.poll(() => Math.abs(rightGap())).toBeLessThan(1.5);

            setCaret(editor, cell(editor, 1, 1, 2));
            const topGap = () => outlineRectOf(editor).top - cellRect(editor, 1, 1, 2).top;
            await expect.poll(() => Math.abs(topGap())).toBeLessThan(1.5);
            expectAround(editor, [1, 1], [1, 1], 2);
        });
    });

    describe("dragging", () => {
        it("grows and shrinks the selection with the handle at the bottom right", async () => {
            await showHandles(editor, GRID);
            const handle = handleCenter(editor, BOTTOM_RIGHT);
            // The finger lands below the handle, which then keeps that distance from it.
            const finger = { x: handle.x - 6, y: handle.y + 20 };
            const moveHandleTo = (row: number, column: number) => {
                const { x, y } = centerOf(cellRect(editor, row, column));
                return touchMove(x - 6, y + 20);
            };

            expect(touchStart(finger.x, finger.y).defaultPrevented).toBe(false);
            expect(overlay(editor).isDragging).toBe(false);

            expect(moveHandleTo(1, 1).defaultPrevented).toBe(true);
            expect(overlay(editor).isDragging).toBe(true);
            expect(overlay(editor).element?.classList.contains("ck-table-touch-selection_dragging"))
                .toBe(true);
            expect(selectedCells(editor)).toEqual(["0,0", "0,1", "1,0", "1,1"]);
            await frames();
            expectAround(editor, [0, 0], [1, 1]);

            moveHandleTo(2, 2);
            expect(selectedCells(editor)).toHaveLength(9);
            moveHandleTo(1, 1);
            expect(selectedCells(editor)).toEqual(["0,0", "0,1", "1,0", "1,1"]);
            moveHandleTo(0, 0);
            expect(selectedCells(editor)).toEqual(["0,0"]);
            moveHandleTo(0, 1);
            expect(selectedCells(editor)).toEqual(["0,0", "0,1"]);

            touchEnd();
            expect(overlay(editor).isDragging).toBe(false);
            await frames();
            expectAround(editor, [0, 0], [0, 1]);
        });

        it("keeps the cell at the opposite corner selected", async () => {
            await showHandles(editor, GRID);
            selectCells(editor, [1, 1], [2, 2]);
            const topGap = () => outlineRectOf(editor).top - cellRect(editor, 1, 1).top;
            await expect.poll(() => Math.abs(topGap())).toBeLessThan(1.5);

            const handle = handleCenter(editor, TOP_LEFT);
            touchStart(handle.x, handle.y);
            moveTo(centerOf(cellRect(editor, 0, 0)));
            expect(selectedCells(editor)).toHaveLength(9);
            moveTo(centerOf(cellRect(editor, 2, 2)));
            expect(selectedCells(editor)).toEqual(["2,2"]);
            moveTo(centerOf(cellRect(editor, 2, 1)));
            expect(selectedCells(editor)).toEqual(["2,1", "2,2"]);
            touchEnd();
        });

        it("drags the closest handle within reach", async () => {
            await showHandles(editor, GRID);
            const rect = cellRect(editor, 0, 0);
            const target = centerOf(cellRect(editor, 1, 0));
            expect(rect.height).toBeLessThan(40);

            // Both handles on the left edge are within reach, and the closer one moves.
            const nearTop = rect.height * 0.4;
            touchStart(rect.left, rect.top + nearTop);
            touchMove(target.x, target.y + nearTop);
            expect(selectedCells(editor)).toEqual(["0,0", "1,0"]);
            touchEnd();

            setCaret(editor, cell(editor, 0, 0));
            await expect.poll(() => selectedCells(editor)).toEqual(["text"]);
            await frames();
            const nearBottom = rect.height * 0.4;
            touchStart(rect.left, rect.bottom - nearBottom);
            touchMove(target.x, target.y - nearBottom);
            expect(selectedCells(editor)).toEqual(["0,0", "1,0"]);
            touchEnd();
        });

        it("leaves taps and touches away from the handles to the browser", async () => {
            await showHandles(editor, GRID);
            const center = centerOf(cellRect(editor, 0, 0));

            touchStart(center.x, center.y);
            expect(touchMove(center.x + 30, center.y + 30).defaultPrevented).toBe(false);
            touchEnd();
            expect(touchMove(center.x, center.y).defaultPrevented).toBe(false);

            const handle = handleCenter(editor, BOTTOM_RIGHT);
            touchStart(handle.x, handle.y);
            touchEnd();
            touchEnd();
            expect(touchMove(center.x, center.y).defaultPrevented).toBe(false);
            expect(selectedCells(editor)).toEqual(["text"]);
        });

        it("lets the browser scroll when it does not let the first move be canceled", async () => {
            await showHandles(editor, GRID);
            const handle = handleCenter(editor, BOTTOM_RIGHT);
            const target = centerOf(cellRect(editor, 1, 1));

            touchStart(handle.x, handle.y);
            expect(touchMove(target.x, target.y, { cancelable: false }).defaultPrevented)
                .toBe(false);
            expect(touchMove(target.x, target.y).defaultPrevented).toBe(false);
            expect(overlay(editor).isDragging).toBe(false);
            expect(selectedCells(editor)).toEqual(["text"]);
        });

        it("ends the drag on a second finger, on touchcancel and when the handles hide",
            async () => {
                await showHandles(editor, GRID);
                let handle = handleCenter(editor, BOTTOM_RIGHT);
                touchStart(handle.x, handle.y);
                moveTo(centerOf(cellRect(editor, 1, 1)));
                expect(overlay(editor).isDragging).toBe(true);
                secondFingerDown(handle.x, handle.y);
                expect(overlay(editor).isDragging).toBe(false);
                expect(touchMove(handle.x, handle.y).defaultPrevented).toBe(false);
                touchEnd();

                await frames();
                handle = handleCenter(editor, BOTTOM_RIGHT);
                touchStart(handle.x, handle.y);
                moveTo(centerOf(cellRect(editor, 2, 2)));
                expect(touchMove(handle.x, handle.y, { identifier: 2 }).defaultPrevented)
                    .toBe(false);
                touchEnd(2);
                expect(overlay(editor).isDragging).toBe(true);
                touchEnd(TOUCH_ID, "touchcancel");
                expect(overlay(editor).isDragging).toBe(false);
                expect(selectedCells(editor)).toHaveLength(9);

                await frames();
                handle = handleCenter(editor, BOTTOM_RIGHT);
                touchStart(handle.x, handle.y);
                moveTo(centerOf(cellRect(editor, 1, 1)));
                const editorElement = editor.ui.element as HTMLElement;
                editorElement.style.marginTop = "200vh";
                window.dispatchEvent(new Event("resize"));
                await expect.poll(() => overlay(editor).isDragging).toBe(false);
                touchEnd();
                editorElement.style.marginTop = "";

                await showHandles(editor, GRID);
                handle = handleCenter(editor, BOTTOM_RIGHT);
                touchStart(handle.x, handle.y);
                moveTo(centerOf(cellRect(editor, 1, 1)));
                (document.activeElement as HTMLElement | null)?.blur();
                await expect.poll(() => overlay(editor).isDragging).toBe(false);
            });

        it("selects up to the cells at the edge when the handle leaves the table", async () => {
            await showHandles(editor, GRID);
            const handle = handleCenter(editor, BOTTOM_RIGHT);
            touchStart(handle.x, handle.y);
            touchMove(handle.x + 1000, handle.y + 1000);
            expect(selectedCells(editor)).toHaveLength(9);
            touchMove(handle.x - 1000, handle.y - 1000);
            expect(selectedCells(editor)).toEqual(["0,0"]);
            touchEnd();
        });

        it("selects only cells of its own table", async () => {
            const nested = modelTable([["x", "y"]]);
            await showHandles(editor, "<table><tableRow>" +
                "<tableCell><paragraph>a[]</paragraph></tableCell>" +
                `<tableCell>${nested}</tableCell>` +
                "</tableRow><tableRow>" +
                "<tableCell><paragraph>c</paragraph></tableCell>" +
                "<tableCell><paragraph>d</paragraph></tableCell>" +
                "</tableRow></table>");
            const handle = handleCenter(editor, BOTTOM_RIGHT);
            touchStart(handle.x, handle.y);

            moveTo(centerOf(domCell(editor, cellAtPath(editor, [0, 0, 1, 0, 0, 0]))
                .getBoundingClientRect()));
            expect(selectedCells(editor)).toEqual(["0,0", "0,1"]);

            const cover = coverWithForeignTable(cellRect(editor, 1, 0));
            moveTo(centerOf(cover.getBoundingClientRect()));
            expect(selectedCells(editor)).toEqual(["0,0", "1,0"]);

            domCell(editor, cell(editor, 1, 1)).style.pointerEvents = "none";
            moveTo(centerOf(cellRect(editor, 1, 1)));
            expect(selectedCells(editor)).toEqual(["0,0", "1,0"]);
            touchEnd();
        });

        it("scrolls the container of the editable while the handle is near its edge",
            async () => {
                const scroller = wrapInScroller(editor, 150);
                const rows = Array.from({ length: 12 }, (_, row) => [`r${row}`, "x"]);
                rows[0][0] = "a[]";
                await showHandles(editor, modelTable(rows));
                const handle = handleCenter(editor, BOTTOM_RIGHT);
                const scrollerRect = scroller.getBoundingClientRect();

                touchStart(handle.x, handle.y);
                touchMove(handle.x, scrollerRect.top + scroller.clientHeight - 5);
                await expect.poll(() => scroller.scrollTop).toBeGreaterThan(100);
                await expect.poll(() => selectedCells(editor).length).toBeGreaterThan(14);
                expect(overlay(editor).isVisible).toBe(true);

                touchEnd();
                const scrollTop = scroller.scrollTop;
                await frames();
                expect(scroller.scrollTop).toBe(scrollTop);
            });

        it("scrolls a wide table sideways while the handle is near its edge", async () => {
            await showHandles(editor, modelTable(
                [["a[]", "b", "c", "d"], ["e", "f", "g", "h"]],
                'tableWidth="200%"'
            ));
            const figure = domCell(editor, cell(editor, 0, 0)).closest("figure");
            if (!figure) {
                throw new Error("The table has no figure.");
            }
            const handle = handleCenter(editor, BOTTOM_RIGHT);
            const figureRect = figure.getBoundingClientRect();

            touchStart(handle.x, handle.y);
            touchMove(figureRect.left + figure.clientWidth - 5, handle.y);
            await expect.poll(() => figure.scrollLeft).toBeGreaterThan(0);
            await expect.poll(() => selectedCells(editor)).toContain("0,3");
            touchEnd();
        });

        it("ends the drag when the editor is destroyed", async () => {
            const element = document.createElement("div");
            document.body.append(element);
            const own = await ClassicEditor.create(element, {
                licenseKey: "GPL",
                plugins: PLUGINS
            });
            await showHandles(own, GRID);

            const handle = handleCenter(own, BOTTOM_RIGHT);
            touchStart(handle.x, handle.y);
            moveTo(centerOf(cellRect(own, 1, 1)));
            await own.destroy();
            element.remove();
            touchMove(handle.x + 20, handle.y + 20);
            touchEnd();
        });
    });
});

let touchTarget: EventTarget = document.body;

/** Waits for two animation frames, for the updates the plugin schedules. */
async function frames() {
    for (let frame = 0; frame < 2; frame++) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
    }
}

async function showHandles(editor: Editor, data: string) {
    setModelData(editor.model, data);
    editor.editing.view.focus();
    touch();
    await expect.poll(() => overlay(editor).isVisible).toBe(true);
}

function touch(pointerType = "touch") {
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType }));
}

/** Puts the finger down at `x`, `y`, on the element there. */
function touchStart(x: number, y: number) {
    return touchStartOn(document.elementFromPoint(x, y) ?? document.body, x, y);
}

function touchStartOn(target: EventTarget, x: number, y: number) {
    touchTarget = target;
    const touch = createTouch(x, y);
    return dispatchTouch("touchstart", [touch], [touch]);
}

function secondFingerDown(x: number, y: number) {
    const second = createTouch(x, y, 2);
    return dispatchTouch("touchstart", [createTouch(x, y), second], [second]);
}

function touchMove(x: number, y: number, { identifier = TOUCH_ID, cancelable = true } = {}) {
    const touch = createTouch(x, y, identifier);
    return dispatchTouch("touchmove", [touch], [touch], cancelable);
}

function moveTo({ x, y }: { x: number; y: number }) {
    return touchMove(x, y);
}

function touchEnd(identifier = TOUCH_ID, type = "touchend") {
    return dispatchTouch(type, [], [createTouch(0, 0, identifier)]);
}

function createTouch(clientX: number, clientY: number, identifier = TOUCH_ID) {
    return new Touch({ identifier, target: touchTarget, clientX, clientY });
}

function dispatchTouch(
    type: string,
    touches: Touch[],
    changedTouches: Touch[],
    cancelable = true
) {
    const event = new TouchEvent(type, {
        bubbles: true,
        cancelable,
        touches,
        targetTouches: touches,
        changedTouches
    });
    touchTarget.dispatchEvent(event);
    return event;
}

function overlay(editor: Editor) {
    return editor.plugins.get(TableTouchSelection).view;
}

function overlayElement(editor: Editor) {
    const element = overlay(editor).element;
    if (!element) {
        throw new Error("The overlay is not rendered.");
    }
    return element;
}

function outlineRectOf(editor: Editor) {
    const outline = overlay(editor).element?.querySelector(".ck-table-touch-selection__outline");
    return outline?.getBoundingClientRect() ?? new DOMRect();
}

function clipRectOf(editor: Editor) {
    const clip = overlay(editor).element?.querySelector(".ck-table-touch-selection__clip");
    return clip?.getBoundingClientRect() ?? new DOMRect();
}

/** The indexes in `CORNERS` of the handles that are shown. */
function shownHandles(editor: Editor) {
    return overlay(editor).handles.flatMap((handle, index) =>
        handle.classList.contains("ck-hidden") ? [] : [index]);
}

function handleCenter(editor: Editor, corner: number) {
    const handle = overlay(editor).handles[corner];
    if (handle.classList.contains("ck-hidden")) {
        throw new Error(`The handle ${corner} is hidden.`);
    }
    return centerOf(handle.getBoundingClientRect());
}

/**
 * Expects the outline and the handles around the cells from `first` to `last`, given as row and
 * child indexes in the table at `tableIndex` of the root.
 */
function expectAround(
    editor: Editor,
    first: [number, number],
    last: [number, number],
    tableIndex = 0
) {
    const firstRect = cellRect(editor, ...first, tableIndex);
    const lastRect = cellRect(editor, ...last, tableIndex);
    const outlineRect = outlineRectOf(editor);
    expectNear(outlineRect.left, firstRect.left);
    expectNear(outlineRect.top, firstRect.top);
    expectNear(outlineRect.right, lastRect.right);
    expectNear(outlineRect.bottom, lastRect.bottom);

    const corners = [
        { x: firstRect.left, y: firstRect.top },
        { x: lastRect.right, y: firstRect.top },
        { x: firstRect.left, y: lastRect.bottom },
        { x: lastRect.right, y: lastRect.bottom }
    ];
    for (const corner of shownHandles(editor)) {
        const center = handleCenter(editor, corner);
        expectNear(center.x, corners[corner].x);
        expectNear(center.y, corners[corner].y);
    }
}

function expectNear(actual: number, expected: number) {
    expect(Math.abs(actual - expected)).toBeLessThan(1.5);
}

function centerOf(rect: DOMRect) {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** The cell at `row` and child index `column` of the table at `tableIndex` of the root. */
function cell(editor: Editor, row: number, column: number, tableIndex = 0) {
    return cellAtPath(editor, [tableIndex, row, column]);
}

function cellAtPath(editor: Editor, path: number[]): ModelElement {
    const node = editor.model.document.getRoot()?.getNodeByPath(path);
    if (!node?.is("element", "tableCell")) {
        throw new Error(`No table cell at ${path.join(", ")}.`);
    }
    return node;
}

function domCell(editor: Editor, modelCell: ModelElement) {
    const viewCell = editor.editing.mapper.toViewElement(modelCell);
    const element = viewCell && editor.editing.view.domConverter.mapViewToDom(viewCell);
    if (!(element instanceof HTMLElement)) {
        throw new Error("The cell is not rendered.");
    }
    return element;
}

function cellRect(editor: Editor, row: number, column: number, tableIndex = 0) {
    return domCell(editor, cell(editor, row, column, tableIndex)).getBoundingClientRect();
}

function rootChild(editor: Editor, index: number) {
    const child = editor.model.document.getRoot()?.getChild(index);
    if (!child?.is("element")) {
        throw new Error(`No element at ${index} in the root.`);
    }
    return child;
}

function paragraphIn(element: ModelElement) {
    const paragraph = element.getChild(0);
    if (!paragraph?.is("element", "paragraph")) {
        throw new Error("The cell has no paragraph.");
    }
    return paragraph;
}

function setCaret(editor: Editor, element: ModelElement) {
    editor.model.change((writer) => writer.setSelection(element, 0));
}

function selectCells(editor: Editor, anchor: [number, number], target: [number, number]) {
    const tableSelection = editor.plugins.get(TableSelection);
    tableSelection.setCellSelection(cell(editor, ...anchor), cell(editor, ...target));
}

/** The selected cells as `row,column` child indexes, sorted, or `text` for a text selection. */
function selectedCells(editor: Editor) {
    return [...editor.model.document.selection.getRanges()].map((range) => {
        const node = range.start.nodeAfter;
        if (!node?.is("element", "tableCell")) {
            return "text";
        }
        return `${node.findAncestor("tableRow")?.index},${node.index}`;
    }).sort();
}

function rootOf(editor: Editor) {
    const root = editor.editing.view.getDomRoot();
    if (!root) {
        throw new Error("The editor has no editable.");
    }
    return root;
}

/** Scrolls `element` down by `distance` and waits for its `scroll` event. */
async function scrollBy(element: HTMLElement, distance: number) {
    const scrolled = new Promise((resolve) => {
        element.addEventListener("scroll", resolve, { once: true });
    });
    element.scrollTop += distance;
    await scrolled;
}

/** Puts the editor in a scroll container `height` pixels tall. */
function wrapInScroller(editor: Editor, height: number) {
    const scroller = document.createElement("div");
    scroller.style.cssText = `height: ${height}px; width: 500px; overflow: auto`;
    document.body.append(scroller);
    scroller.append(editor.ui.element as HTMLElement);
    onTestFinished(() => scroller.remove());
    return scroller;
}

/** A table cell outside the editor, drawn over `rect`. */
function coverWithForeignTable(rect: DOMRect) {
    const table = document.createElement("table");
    const cover = table.insertRow().insertCell();
    table.style.cssText = `position: fixed; left: ${rect.left}px; top: ${rect.top}px; ` +
        `width: ${rect.width}px; height: ${rect.height}px; z-index: 10000`;
    document.body.append(table);
    onTestFinished(() => table.remove());
    return cover;
}
