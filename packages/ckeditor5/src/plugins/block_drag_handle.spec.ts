import {
    _getModelData as getModelData, _setModelData as setModelData, BlockQuote, type ClassicEditor,
    DragDrop, env, Essentials, Paragraph, Table, TableCaption
} from "ckeditor5";
import editorStylesheetUrl from "ckeditor5/ckeditor5.css?url";
import { beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import Admonition from "./admonition/admonition.js";
import BlockDragHandle from "./block_drag_handle.js";
import Collapsible from "./collapsible/collapsible.js";

describe("BlockDragHandle", () => {
    beforeAll(() => new Promise<void>((resolve, reject) => {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = editorStylesheetUrl;
        link.onload = () => resolve();
        link.onerror = () => reject(new Error("the editor stylesheet did not load"));
        document.head.appendChild(link);
    }));

    it("shows the handle beside the focused block, hidden when read-only or blurred", async () => {
        const { editor, button } = await createEditor(
            "<paragraph>one</paragraph><paragraph>tw[]o</paragraph>"
        );
        const buttonView = editor.plugins.get(BlockDragHandle).buttonView;
        expect(buttonView?.isVisible).toBe(true);
        expect(button.getAttribute("draggable")).toBe("true");
        expect(button.classList).toContain("block-drag-handle");
        expect(getComputedStyle(button).cursor).toBe("grab");
        expect(isBesideBlock(editor, button, 1)).toBe(true);

        button.focus();
        button.click();
        expect(document.activeElement).toBe(getEditable(editor));

        editor.enableReadOnlyMode("spec");
        expect(buttonView?.isVisible).toBe(false);
        editor.disableReadOnlyMode("spec");
        expect(buttonView?.isVisible).toBe(true);

        // A caption is in no block.
        setModelData(editor.model, "<paragraph>one</paragraph><table><tableRow><tableCell>"
            + "<paragraph>cell</paragraph></tableCell></tableRow>"
            + "<caption>Cap[]tion</caption></table>");
        expect(buttonView?.isVisible).toBe(false);
        const captionStart = new DragEvent("dragstart", {
            bubbles: true, cancelable: true, dataTransfer: new DataTransfer()
        });
        button.dispatchEvent(captionStart);
        expect(captionStart.defaultPrevented).toBe(true);

        getEditable(editor).blur();
        await expect.poll(() => buttonView?.isVisible).toBe(false);
    });

    it("follows its block when the window resizes or the page scrolls", async () => {
        const { editor, button } = await createEditor("<paragraph>on[]e</paragraph>");
        const editorElement = editor.ui.view.element;
        // Without a line height in pixels, the first line is measured from the font size.
        getEditable(editor).style.lineHeight = "normal";

        editorElement?.style.setProperty("margin", "40px 150px");
        window.dispatchEvent(new Event("resize"));
        window.dispatchEvent(new Event("resize"));
        await expect.poll(() => isBesideBlock(editor, button, 0)).toBe(true);

        editorElement?.style.setProperty("margin", "80px 200px");
        document.dispatchEvent(new Event("scroll"));
        await expect.poll(() => isBesideBlock(editor, button, 0)).toBe(true);
    });

    it("follows its block through a scroll, measuring before it changes the handle", async () => {
        const { editor, button, scroller } = await createScrolledEditor(3);
        const buttonView = editor.plugins.get(BlockDragHandle).buttonView;
        const forcedLayouts = watchForcedLayouts(button);

        await scrollTo(scroller, 20);
        expect(isBesideBlock(editor, button, 3)).toBe(true);
        expect(buttonView?.isVisible).toBe(true);

        // Out of the visible part of the editable, and back.
        const bottom = scroller.scrollHeight - scroller.clientHeight;
        await scrollTo(scroller, bottom);
        expect(buttonView?.isVisible).toBe(false);
        await scrollTo(scroller, bottom - 50);
        expect(buttonView?.isVisible).toBe(false);
        await scrollTo(scroller, 0);
        expect(buttonView?.isVisible).toBe(true);
        expect(isBesideBlock(editor, button, 3)).toBe(true);

        expect(forcedLayouts).toEqual([]);
    });

    it("ignores the scrolls of elements that cannot move the editable", async () => {
        const { editor } = await createEditor("<paragraph>on[]e</paragraph>");
        const other = document.createElement("div");
        document.body.append(other);
        onTestFinished(() => other.remove());
        const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame");
        onTestFinished(() => requestAnimationFrame.mockRestore());

        other.dispatchEvent(new Event("scroll"));
        expect(requestAnimationFrame).not.toHaveBeenCalled();

        // A scrolled element inside the editable moves the blocks it holds.
        getBlock(editor, 0).dispatchEvent(new Event("scroll"));
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
    });

    it("follows scrolls and resizes only while the editor has focus", async () => {
        const { editor } = await createEditor("<paragraph>on[]e</paragraph>");
        getEditable(editor).blur();
        await expect.poll(() => editor.ui.focusTracker.isFocused).toBe(false);
        const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame");
        onTestFinished(() => requestAnimationFrame.mockRestore());

        document.dispatchEvent(new Event("scroll"));
        window.dispatchEvent(new Event("resize"));
        expect(requestAnimationFrame).not.toHaveBeenCalled();

        editor.editing.view.focus();
        await expect.poll(() => editor.ui.focusTracker.isFocused).toBe(true);
        document.dispatchEvent(new Event("scroll"));
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
    });

    it("drags the selected block to where it is dropped", async () => {
        const { editor, button } = await createEditor(
            "<paragraph>fi[]rst</paragraph><paragraph>second</paragraph>"
            + "<paragraph>third</paragraph>"
        );
        const editableRect = getEditable(editor).getBoundingClientRect();
        const lastBlockRect = getBlock(editor, 2).getBoundingClientRect();

        const dataTransfer = startDrag(button);
        expect(getModelData(editor.model)).toBe(
            "<paragraph>[first]</paragraph><paragraph>second</paragraph>"
            + "<paragraph>third</paragraph>"
        );

        const isAccepted = drop(button, dataTransfer, {
            clientX: editableRect.left - 50,
            clientY: lastBlockRect.bottom - 2
        });
        expect(isAccepted).toBe(true);
        expect(editor.getData()).toBe("<p>second</p><p>third</p><p>first</p>");

        // The editing view takes a drop over the content itself.
        const firstBlockRect = getBlock(editor, 0).getBoundingClientRect();
        drop(button, startDrag(button), {
            clientX: firstBlockRect.left + 5,
            clientY: firstBlockRect.top + 2
        });
        expect(editor.getData()).toBe("<p>first</p><p>second</p><p>third</p>");
    });

    it("drags whole collapsibles from their titles, wherever the selection ends", async () => {
        const toModel = (title: string, body: string) => (
            `<details open="true"><summary>${title}</summary>${body}</details>`
        );
        const toData = (title: string, body: string) => "<details class=\"trilium-collapsible\""
            + ` open=""><summary>${title}</summary>${body}</details>`;
        const cases = [ {
            modelData: toModel("Ti[]tle", "<paragraph>body</paragraph><paragraph>more</paragraph>"),
            data: toData("Title", "<p>body</p><p>more</p>")
        }, {
            modelData: toModel("Ti[tle", "<paragraph>bo]dy</paragraph><paragraph>more</paragraph>"),
            data: toData("Title", "<p>body</p><p>more</p>")
        }, {
            modelData: toModel("On[e", "<paragraph>first</paragraph>")
                + toModel("Two", "<paragraph>sec]ond</paragraph><paragraph>more</paragraph>"),
            data: toData("One", "<p>first</p>") + toData("Two", "<p>second</p><p>more</p>")
        } ];
        for (const { modelData, data } of cases) {
            const { editor, button } = await createEditor(
                `${modelData}<paragraph>after</paragraph>`
            );
            const editable = getEditable(editor);
            const editableRect = editable.getBoundingClientRect();
            const lastBlockRect = getBlock(editor, editable.childElementCount - 1)
                .getBoundingClientRect();

            drop(button, startDrag(button), {
                clientX: editableRect.left - 50,
                clientY: lastBlockRect.bottom - 2
            });
            expect(editor.getData()).toBe(`<p>after</p>${data}`);
        }
    });

    it("drags whole containers when the selection covers all their content", async () => {
        const note = (content: string) => `<aside admonitionType="note">${content}</aside>`;
        const one = "<paragraph>one</paragraph>";
        const after = "<paragraph>after</paragraph>";
        const cases = [ {
            modelData: note("<paragraph>on[]e</paragraph>"),
            dropped: after + note(one)
        }, {
            modelData: note("<paragraph>on[e</paragraph><paragraph>tw]o</paragraph>"),
            dropped: after + note(`${one}<paragraph>two</paragraph>`)
        }, {
            modelData: note("<paragraph>on[]e</paragraph><paragraph>two</paragraph>"),
            dropped: note("<paragraph>two</paragraph>") + after + one
        }, {
            modelData: `<blockQuote>${note("<paragraph>on[]e</paragraph>")}</blockQuote>`,
            dropped: `${after}<blockQuote>${note(one)}</blockQuote>`
        }, {
            modelData: `${note("<paragraph>on[e</paragraph>")}<paragraph>tw]o</paragraph>`,
            dropped: `${after}${note(one)}<paragraph>two</paragraph>`
        }, {
            modelData: "<table><tableRow><tableCell><paragraph>ce[]ll</paragraph></tableCell>"
                + "</tableRow></table>",
            dropped: "<table><tableRow><tableCell><paragraph></paragraph></tableCell>"
                + `</tableRow></table>${after}<paragraph>cell</paragraph>`
        } ];
        for (const { modelData, dropped } of cases) {
            const { editor, button } = await createEditor(modelData + after);
            // The editors of the earlier cases stay on the page until the test ends.
            editor.ui.view.element?.scrollIntoView();
            const editable = getEditable(editor);
            const lastBlockRect = getBlock(editor, editable.childElementCount - 1)
                .getBoundingClientRect();

            drop(button, startDrag(button), {
                clientX: editable.getBoundingClientRect().left - 50,
                clientY: lastBlockRect.bottom - 2
            });
            expect(getModelData(editor.model, { withoutSelection: true })).toBe(dropped);
        }
    });

    it("drags the whole table from a selection of several cells", async () => {
        const cell = (text: string) => `<tableCell><paragraph>${text}</paragraph></tableCell>`;
        const tables = [
            `<table><tableRow>[${cell("a")}][${cell("b")}]</tableRow></table>`,
            // Some cells of one row.
            `<table><tableRow>[${cell("a")}][${cell("b")}]</tableRow>`
                + `<tableRow>${cell("c")}${cell("d")}</tableRow></table>`,
            // Some cells of each row.
            `<table><tableRow>${cell("a")}[${cell("b")}]</tableRow>`
                + `<tableRow>${cell("c")}[${cell("d")}]</tableRow></table>`
        ];
        for (const table of tables) {
            const { editor, button } = await createEditor(`${table}<paragraph>after</paragraph>`);
            // The editors of the earlier cases stay on the page until the test ends.
            editor.ui.view.element?.scrollIntoView();

            drop(button, startDrag(button), {
                clientX: getEditable(editor).getBoundingClientRect().left - 50,
                clientY: getBlock(editor, 1).getBoundingClientRect().bottom - 2
            });
            expect(getModelData(editor.model, { withoutSelection: true })).toBe(
                `<paragraph>after</paragraph>${table.replace(/[[\]]/g, "")}`
            );
        }
    });

    it("tints the blocks that it drags while the pointer is over it", async () => {
        const note = (content: string) => `<aside admonitionType="note">${content}</aside>`;
        const cell = (text: string) => `<tableCell><paragraph>${text}</paragraph></tableCell>`;
        const cases = [ {
            modelData: "<paragraph>one</paragraph><paragraph>tw[]o</paragraph>",
            targets: [ "p:two" ]
        }, {
            modelData: `${note("<paragraph>on[e</paragraph>")}<paragraph>tw]o</paragraph>`,
            targets: [ "aside:one", "p:two" ]
        }, {
            modelData: `<table><tableRow>${cell("a[]")}${cell("b")}</tableRow></table>`,
            targets: [ "span:a" ]
        }, {
            modelData: `<table><tableRow>[${cell("a")}][${cell("b")}]</tableRow></table>`,
            targets: [ "figure:ab" ]
        }, {
            modelData: `<table><tableRow>${cell("a")}[${cell("b")}]</tableRow>`
                + `<tableRow>${cell("c")}[${cell("d")}]</tableRow></table>`,
            targets: [ "figure:abcd" ]
        }, {
            modelData: `<paragraph>[a]</paragraph><table><tableRow>[${cell("b")}]</tableRow></table>`,
            targets: [ "p:a", "figure:b" ]
        }, {
            modelData: `<table><tableRow>[${cell("a")}]</tableRow></table><paragraph>[b]</paragraph>`,
            targets: [ "figure:a", "p:b" ]
        } ];
        for (const { modelData, targets } of cases) {
            const { editor, button } = await createEditor(
                `${modelData}<paragraph>after</paragraph>`
            );
            // The editors of the earlier cases stay on the page until the test ends.
            editor.ui.view.element?.scrollIntoView();

            button.dispatchEvent(new MouseEvent("mouseenter"));
            expect(getTargets(editor)).toEqual(targets);
            button.dispatchEvent(new MouseEvent("mouseleave"));
            expect(getTargets(editor)).toEqual([]);
        }
    });

    it("keeps the tint until the pointer leaves the handle or drags the blocks", async () => {
        const { editor, button } = await createEditor(
            "<paragraph>one</paragraph><paragraph>tw[]o</paragraph>"
        );
        button.dispatchEvent(new MouseEvent("mouseenter"));
        expect(getComputedStyle(getBlock(editor, 1)).boxShadow).toContain("inset");
        expect(editor.getData()).toBe("<p>one</p><p>two</p>");

        setModelData(editor.model, "<paragraph>o[]ne</paragraph><paragraph>two</paragraph>");
        expect(getTargets(editor)).toEqual([ "p:one" ]);

        editor.enableReadOnlyMode("spec");
        expect(getTargets(editor)).toEqual([]);
        editor.disableReadOnlyMode("spec");
        expect(getTargets(editor)).toEqual([ "p:one" ]);

        endDrag(button, startDrag(button), "none");
        expect(getTargets(editor)).toEqual([]);
        expect(getComputedStyle(getBlock(editor, 0)).boxShadow).toBe("none");
    });

    it("tints the blocks when the editor gets focus while it renders", async () => {
        const { editor, button } = await createEditor("<paragraph>on[]e</paragraph>");
        const view = editor.editing.view;
        getEditable(editor).blur();
        await expect.poll(() => editor.ui.focusTracker.isFocused).toBe(false);
        await expect.poll(() => view.document.isFocused).toBe(false);
        button.dispatchEvent(new MouseEvent("mouseenter"));
        expect(getTargets(editor)).toEqual([]);

        // The renderer focuses the editable of a focused view document.
        view.document.isFocused = true;
        view.forceRender();
        expect(getTargets(editor)).toEqual([ "p:one" ]);
    });

    it("takes drops beside a narrow editor or far out in a wide margin", async () => {
        const layouts = [
            { width: "90px", margin: "0 100px", distance: 10 },
            { width: "200px", margin: "0 190px", distance: 150 }
        ];
        for (const { width, margin, distance } of layouts) {
            const { editor, button } = await createEditor(
                "<paragraph>fi[]rst</paragraph><paragraph>second</paragraph>"
            );
            editor.ui.view.element?.style.setProperty("width", width);
            editor.ui.view.element?.style.setProperty("margin", margin);
            const editableRect = getEditable(editor).getBoundingClientRect();
            const lastBlockRect = getBlock(editor, 1).getBoundingClientRect();

            drop(button, startDrag(button), {
                clientX: editableRect.left - distance,
                clientY: lastBlockRect.bottom - 2
            });
            expect(editor.getData()).toBe("<p>second</p><p>first</p>");
        }
    });

    it("moves blocks dropped above or below the others to the start or end", async () => {
        const cases = [ {
            at: (editable: DOMRect, above: DOMRect) => ({
                clientX: editable.left - 50, clientY: above.top + 10
            }),
            data: "<p>second</p><p>first</p><p>third</p>"
        }, {
            at: (editable: DOMRect, _above: DOMRect, below: DOMRect) => ({
                clientX: editable.left + 20, clientY: below.bottom - 10
            }),
            data: "<p>first</p><p>third</p><p>second</p>"
        } ];
        for (const { at, data } of cases) {
            const { editor, button } = await createEditor(
                "<paragraph>first</paragraph><paragraph>sec[]ond</paragraph>"
                + "<paragraph>third</paragraph>"
            );
            const { above, below } = placeInScrollingContainer(editor);
            const editableRect = getEditable(editor).getBoundingClientRect();

            const isAccepted = drop(button, startDrag(button), at(editableRect, above, below));
            expect(isAccepted).toBe(true);
            expect(editor.getData()).toBe(data);
        }
    });

    it("leaves drops over another pane on either side to that pane", async () => {
        const { editor, button } = await createEditor(
            "<paragraph>fi[]rst</paragraph><paragraph>second</paragraph>"
        );
        const editableRect = getEditable(editor).getBoundingClientRect();
        const lastBlockRect = getBlock(editor, 1).getBoundingClientRect();
        const pane = document.createElement("div");
        pane.style.setProperty("position", "fixed");
        pane.style.setProperty("inset", "0 auto 0 0");
        pane.style.setProperty("width", "40px");
        document.body.append(pane);
        onTestFinished(() => pane.remove());

        for (const paneLeft of [ editableRect.left - 60, editableRect.right + 20 ]) {
            pane.style.setProperty("left", `${paneLeft}px`);
            const isAccepted = drop(button, startDrag(button), {
                clientX: paneLeft + 20,
                clientY: lastBlockRect.bottom - 2
            });
            expect(isAccepted).toBe(false);
        }
        expect(editor.getData()).toBe("<p>first</p><p>second</p>");
    });

    it("ends a drag that no drop takes, with the blocks where they were", async () => {
        const { editor, button } = await createEditor(
            "<paragraph>fi[]rst</paragraph><paragraph>second</paragraph>"
            + "<paragraph>third</paragraph>"
        );
        const beside = (index: number) => ({
            clientX: getEditable(editor).getBoundingClientRect().left - 50,
            clientY: getBlock(editor, index).getBoundingClientRect().bottom - 2
        });

        // The second marker update is still pending when the drag ends.
        const dataTransfer = startDrag(button);
        expect(dragOver(dataTransfer, beside(1))).toBe(true);
        expect(dragOver(dataTransfer, beside(2))).toBe(true);
        endDrag(button, dataTransfer, "none");
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(editor.model.markers.has("drop-target")).toBe(false);
        expect(editor.getData()).toBe("<p>first</p><p>second</p><p>third</p>");
    });

    it("moves the blocks into another editor that takes the drop", async () => {
        const { editor, button } = await createEditor(
            "<paragraph>fi[]rst</paragraph><paragraph>second</paragraph>"
        );
        const other = await createTestEditor([ Essentials, Paragraph ]);
        setModelData(other.model, "<paragraph>other</paragraph>");
        const otherBlockRect = getBlock(other, 0).getBoundingClientRect();
        const isAccepted = drop(button, startDrag(button), {
            clientX: otherBlockRect.left + 5,
            clientY: otherBlockRect.bottom - 2
        });
        expect(isAccepted).toBe(true);
        expect(other.getData()).toContain("first");
        expect(editor.getData()).toBe("<p>second</p>");
    });

    it("takes the drop marker away where releasing would not drop", async () => {
        const { editor, button } = await createEditor(
            "<paragraph>fi[]rst</paragraph><paragraph>second</paragraph>"
        );
        const editableRect = getEditable(editor).getBoundingClientRect();
        const buttonRect = button.getBoundingClientRect();
        const beside = {
            clientX: editableRect.left - 50,
            clientY: getBlock(editor, 1).getBoundingClientRect().bottom - 2
        };
        const belowEditable = { ...beside, clientY: editableRect.bottom + 50 };
        const overHandle = {
            clientX: buttonRect.left + buttonRect.width / 2,
            clientY: buttonRect.top + buttonRect.height / 2
        };

        const dataTransfer = startDrag(button);
        for (const point of [ belowEditable, overHandle ]) {
            expect(dragOver(dataTransfer, beside)).toBe(true);
            expect(editor.model.markers.has("drop-target")).toBe(true);
            expect(dragOver(dataTransfer, point)).toBe(false);
            await expect.poll(() => editor.model.markers.has("drop-target")).toBe(false);
        }
        endDrag(button, dataTransfer, "none");
        expect(editor.getData()).toBe("<p>first</p><p>second</p>");
    });

    it("mirrors the handle and its drops in a right-to-left editor", async () => {
        const { editor, button } = await createEditor(
            "<paragraph>fi[]rst</paragraph><paragraph>second</paragraph>",
            { language: "ar" }
        );
        const editableRect = getEditable(editor).getBoundingClientRect();
        const lastBlockRect = getBlock(editor, 1).getBoundingClientRect();
        expect(button.getBoundingClientRect().left).toBeCloseTo(editableRect.right, 0);

        drop(button, startDrag(button), {
            clientX: editableRect.right + 50,
            clientY: lastBlockRect.bottom - 2
        });
        expect(editor.getData()).toBe("<p>second</p><p>first</p>");
    });

    it("ignores other drags, and drags that start disabled or end off the editable", async () => {
        const { editor, button } = await createEditor(
            "<paragraph>fi[]rst</paragraph><paragraph>second</paragraph>"
        );
        const editableRect = getEditable(editor).getBoundingClientRect();
        const lastBlockRect = getBlock(editor, 1).getBoundingClientRect();
        const margin = { clientX: editableRect.left - 50, clientY: lastBlockRect.bottom - 2 };

        const text = new DataTransfer();
        text.setData("text/plain", "dropped");
        const textInit = { bubbles: true, dataTransfer: text, ...margin };
        document.dispatchEvent(new DragEvent("dragover", textInit));
        document.dispatchEvent(new DragEvent("drop", textInit));

        const dragDrop = editor.plugins.get(DragDrop);
        const switches = [
            [ () => editor.enableReadOnlyMode("spec"), () => editor.disableReadOnlyMode("spec") ],
            [ () => dragDrop.forceDisabled("spec"), () => dragDrop.clearForceDisabled("spec") ]
        ];
        for (const [ disable, enable ] of switches) {
            disable();
            const disabledStart = new DragEvent("dragstart", {
                bubbles: true, cancelable: true, dataTransfer: new DataTransfer()
            });
            button.dispatchEvent(disabledStart);
            expect(disabledStart.defaultPrevented).toBe(true);
            enable();
        }

        const offEditable = { ...margin, clientY: editableRect.bottom + 50 };
        expect(drop(button, startDrag(button), offEditable)).toBe(false);
        expect(editor.getData()).toBe("<p>first</p><p>second</p>");
    });

    it("adds no handle on Android, where the editor cannot drag", async () => {
        const { isAndroid } = env;
        Object.defineProperty(env, "isAndroid", { value: true });
        try {
            const editor = await createTestEditor([ Essentials, Paragraph, BlockDragHandle ]);
            expect(editor.plugins.get(BlockDragHandle).buttonView).toBeUndefined();
        } finally {
            Object.defineProperty(env, "isAndroid", { value: isAndroid });
        }
    });
});

async function createEditor(
    modelData: string,
    config: Parameters<typeof createTestEditor>[1] = {}
) {
    const editor = await createTestEditor(
        [
            Essentials, Paragraph, Table, TableCaption, BlockQuote, Admonition, Collapsible,
            BlockDragHandle
        ],
        config
    );
    editor.ui.view.element?.style.setProperty("margin", "0 100px");
    setModelData(editor.model, modelData);
    editor.editing.view.focus();
    await expect.poll(() => editor.ui.focusTracker.isFocused).toBe(true);
    editor.ui.update();

    const button = editor.plugins.get(BlockDragHandle).buttonView?.element;
    if (!button) {
        throw new Error("The drag handle is not rendered.");
    }

    return { editor, button };
}

/**
 * Creates an editor of 40 paragraphs in a scrolled box, as the note pane holds it, with the
 * selection in the paragraph at `index`.
 */
async function createScrolledEditor(index: number) {
    const paragraphs = Array.from({ length: 40 }, (_, paragraphIndex) => (
        paragraphIndex === index ? "<paragraph>bl[]ock</paragraph>" : "<paragraph>text</paragraph>"
    ));
    const { editor, button } = await createEditor(paragraphs.join(""));
    const scroller = document.createElement("div");
    scroller.style.setProperty("height", "200px");
    scroller.style.setProperty("overflow", "auto");
    document.body.prepend(scroller);
    onTestFinished(() => scroller.remove());

    const editorElement = editor.ui.view.element;
    if (editorElement) {
        scroller.append(editorElement);
    }
    editor.editing.view.focus();
    await expect.poll(() => editor.ui.focusTracker.isFocused).toBe(true);
    editor.ui.update();

    return { editor, button, scroller };
}

/** Scrolls `scroller` to `top` and waits for the frame in which the handle follows. */
async function scrollTo(scroller: HTMLElement, top: number) {
    if (Math.round(scroller.scrollTop) === top) {
        throw new Error(`The box is already scrolled to ${top}.`);
    }

    const scrolled = new Promise((resolve) => {
        scroller.addEventListener("scroll", resolve, { once: true });
    });
    scroller.scrollTop = top;
    await scrolled;
    await new Promise(requestAnimationFrame);
}

/**
 * Lists the layout reads of `BlockDragHandle` that follow a change to `button`: each makes the
 * browser compute style and layout again within the frame.
 */
function watchForcedLayouts(button: HTMLElement) {
    const forcedLayouts: string[] = [];
    const observer = new MutationObserver(() => undefined);
    observer.observe(button, { attributes: true });
    const readers = [
        { owner: Element.prototype, name: "getBoundingClientRect" },
        { owner: Element.prototype, name: "getClientRects" },
        { owner: window, name: "getComputedStyle" }
    ] as const;
    for (const { owner, name } of readers) {
        const read = owner[name] as (...args: unknown[]) => unknown;
        Object.defineProperty(owner, name, {
            configurable: true,
            writable: true,
            value(this: unknown, ...args: unknown[]) {
                if (new Error().stack?.includes("/block_drag_handle.ts")) {
                    const changes = observer.takeRecords().map((record) => record.attributeName);
                    if (changes.length) {
                        forcedLayouts.push(`${name} after a change to ${changes.join(", ")}`);
                    }
                }
                return read.apply(this, args);
            }
        });
        onTestFinished(() => {
            Object.defineProperty(owner, name, { configurable: true, writable: true, value: read });
        });
    }
    onTestFinished(() => observer.disconnect());

    return forcedLayouts;
}

/**
 * Moves the editor into a scrolling container, between an element above it and one below it, as
 * a note's title and the space after its content surround it. Returns the two elements' rectangles.
 */
function placeInScrollingContainer(editor: ClassicEditor) {
    const editorElement = editor.ui.view.element;
    if (!editorElement) {
        throw new Error("The editor is not rendered.");
    }

    const scrollable = document.createElement("div");
    const above = document.createElement("div");
    const below = document.createElement("div");
    scrollable.style.setProperty("overflow-y", "auto");
    above.style.setProperty("height", "40px");
    below.style.setProperty("height", "40px");
    editorElement.before(scrollable);
    scrollable.append(above, editorElement, below);
    scrollable.scrollIntoView();
    onTestFinished(() => scrollable.remove());

    return { above: above.getBoundingClientRect(), below: below.getBoundingClientRect() };
}

/** Whether `button` is left of the editable, level with the first line of the block at `index`. */
function isBesideBlock(editor: ClassicEditor, button: HTMLElement, index: number) {
    const buttonRect = button.getBoundingClientRect();
    const buttonCenter = buttonRect.top + buttonRect.height / 2;
    const blockRect = getBlock(editor, index).getBoundingClientRect();
    const editableLeft = getEditable(editor).getBoundingClientRect().left;
    return Math.abs(buttonRect.right - editableLeft) < 1
        && buttonCenter > blockRect.top
        && buttonCenter < blockRect.bottom;
}

/** Starts a drag at `button`, with a `DataTransfer` that the drops reuse. */
function startDrag(button: HTMLElement) {
    // A constructed `DataTransfer` ignores `effectAllowed` writes, so every drop is a copy.
    const dataTransfer = new DataTransfer();
    Object.defineProperty(dataTransfer, "effectAllowed", { value: "none", writable: true });
    button.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
    return dataTransfer;
}

/**
 * Drags over `point`, drops there and ends the drag, with the events on the element at `point`.
 * Returns whether the dragover was accepted.
 */
function drop(
    button: HTMLElement,
    dataTransfer: DataTransfer,
    point: { clientX: number; clientY: number }
) {
    const target = document.elementFromPoint(point.clientX, point.clientY) ?? document;
    const dropInit = { bubbles: true, cancelable: true, dataTransfer, ...point };
    const dragover = new DragEvent("dragover", dropInit);
    target.dispatchEvent(dragover);
    target.dispatchEvent(new DragEvent("drop", dropInit));
    endDrag(button, dataTransfer, dragover.defaultPrevented ? "move" : "none");
    return dragover.defaultPrevented;
}

/** Drags over `point`, on the element there. Returns whether the dragover was accepted. */
function dragOver(dataTransfer: DataTransfer, point: { clientX: number; clientY: number }) {
    const target = document.elementFromPoint(point.clientX, point.clientY) ?? document;
    const dragover = new DragEvent("dragover", {
        bubbles: true, cancelable: true, dataTransfer, ...point
    });
    target.dispatchEvent(dragover);
    return dragover.defaultPrevented;
}

/** Ends the drag at `button`, with the drop effect that the browser reports for its end. */
function endDrag(button: HTMLElement, dataTransfer: DataTransfer, dropEffect: "none" | "move") {
    // A constructed `DataTransfer` ignores `dropEffect` writes.
    Object.defineProperty(dataTransfer, "dropEffect", { value: dropEffect });
    button.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer }));
}

/** The tag and text of each element tinted as a target of the handle. */
function getTargets(editor: ClassicEditor) {
    return Array.from(
        getEditable(editor).querySelectorAll(".block-drag-handle-target"),
        (element) => `${element.localName}:${element.textContent}`
    );
}

function getEditable(editor: ClassicEditor) {
    const editable = editor.ui.getEditableElement();
    if (!editable) {
        throw new Error("The editor has no editable.");
    }

    return editable;
}

function getBlock(editor: ClassicEditor, index: number) {
    const block = getEditable(editor).children.item(index);
    if (!block) {
        throw new Error(`The editor has no block ${index}.`);
    }

    return block;
}
