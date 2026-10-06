import {
    _getModelData as getModelData, _setModelData as setModelData, type ClassicEditor, Essentials,
    Paragraph
} from "ckeditor5";
import editorStylesheetUrl from "ckeditor5/ckeditor5.css?url";
import { beforeAll, describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import BlockDragHandle from "./block_drag_handle.js";

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

        const buttonRect = button.getBoundingClientRect();
        const buttonCenter = buttonRect.top + buttonRect.height / 2;
        const editableRect = getEditable(editor).getBoundingClientRect();
        const secondBlockRect = getBlock(editor, 1).getBoundingClientRect();
        expect(buttonRect.right).toBeCloseTo(editableRect.left, 0);
        expect(buttonCenter).toBeGreaterThan(secondBlockRect.top);
        expect(buttonCenter).toBeLessThan(secondBlockRect.bottom);

        button.focus();
        button.click();
        expect(document.activeElement).toBe(getEditable(editor));

        editor.enableReadOnlyMode("spec");
        expect(buttonView?.isVisible).toBe(false);
        editor.disableReadOnlyMode("spec");
        expect(buttonView?.isVisible).toBe(true);

        getEditable(editor).blur();
        await expect.poll(() => buttonView?.isVisible).toBe(false);
    });

    it("drags the selected block to where it is dropped", async () => {
        const { editor, button } = await createEditor(
            "<paragraph>fi[]rst</paragraph><paragraph>second</paragraph>"
            + "<paragraph>third</paragraph>"
        );
        // A constructed `DataTransfer` ignores `effectAllowed` writes, so every drop is a copy.
        const dataTransfer = new DataTransfer();
        Object.defineProperty(dataTransfer, "effectAllowed", { value: "none", writable: true });
        const editableRect = getEditable(editor).getBoundingClientRect();
        const lastBlockRect = getBlock(editor, 2).getBoundingClientRect();
        const dropPoint = {
            clientX: editableRect.left - 50,
            clientY: lastBlockRect.bottom - 2
        };

        button.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
        expect(getModelData(editor.model)).toBe(
            "<paragraph>[first]</paragraph><paragraph>second</paragraph>"
            + "<paragraph>third</paragraph>"
        );

        const dropInit = { bubbles: true, dataTransfer, ...dropPoint };
        document.dispatchEvent(new DragEvent("dragover", dropInit));
        document.dispatchEvent(new DragEvent("drop", dropInit));
        button.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer }));

        expect(editor.getData()).toBe("<p>second</p><p>third</p><p>first</p>");
    });
});

async function createEditor(modelData: string) {
    const editor = await createTestEditor([Essentials, Paragraph, BlockDragHandle]);
    const editorElement = editor.ui.view.element;
    if (editorElement) {
        editorElement.style.margin = "0 100px";
    }
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
