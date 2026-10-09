import {
    _getModelData as getModelData, _setModelData as setModelData, BlockQuote, type ClassicEditor,
    DragDrop, env, Essentials, Paragraph, Table, TableCaption
} from "ckeditor5";
import editorStylesheetUrl from "ckeditor5/ckeditor5.css?url";
import { beforeAll, describe, expect, it, onTestFinished } from "vitest";

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
    button.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer }));
    return dragover.defaultPrevented;
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
