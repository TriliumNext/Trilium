import { type ClassicEditor, Essentials, Paragraph, _getModelData, _setModelData } from "ckeditor5";
import { describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";

import { createTestEditor } from "../../test/editor-kit.js";
import DragOutOfEditor from "./drag_out_of_editor.js";

// A capturing listener for `input` on `document` hides the defect: it gives the editor a microtask
// checkpoint between the removal of the dragged text and the focus change. Register none here.
describe("dragging text out of the editor (#8280)", () => {
    it("moves the text into a text box outside the editor", async () => {
        const dropTarget = createDropTarget("New note");

        try {
            const { editor, paragraph } = await createEditorWithSelectedText("dragged");

            await userEvent.dragAndDrop(paragraph, dropTarget);
            await waitForBlur();

            expect.soft(dropTarget.value).toContain("dragged");
            expect.soft(document.activeElement).toBe(dropTarget);
            expect.soft(_getModelData(editor.model, { withoutSelection: true })).toBe("<paragraph></paragraph>");
        } finally {
            dropTarget.remove();
        }
    });

    it("keeps the DOM in step with the view when the drop takes the focus away", async () => {
        const dropTarget = createDropTarget("");

        try {
            const { editor, paragraph } = await createEditorWithSelectedText("dragged");
            const view = editor.editing.view;
            const domRoot = paragraph.parentElement;
            if (!domRoot) {
                throw new Error("The paragraph is not in the editable.");
            }

            const formatting = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "formatBold" });
            domRoot.dispatchEvent(formatting);
            expect(formatting.defaultPrevented).toBe(false);

            // A drop as Firefox makes it, which cannot be driven natively: unless `beforeinput` is
            // canceled, the browser removes the dragged text itself, leaving a `<br>` in the
            // emptied block, and focuses the drop target in the same task.
            const isDeletionAllowed = domRoot.dispatchEvent(new InputEvent("beforeinput", {
                bubbles: true, cancelable: true, inputType: "deleteByDrag"
            }));
            if (isDeletionAllowed) {
                paragraph.replaceChildren(document.createElement("br"));
                domRoot.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteByDrag" }));
            }
            dropTarget.focus();
            await waitForBlur();

            // Whichever side wins, the DOM and the model must hold the same text …
            const modelText = _getModelData(editor.model, { withoutSelection: true })
                .replace(/<\/?paragraph>/g, "");
            expect.soft(paragraph.textContent).toBe(modelText);

            // … so that the selection can be mapped to the DOM, as `BalloonToolbar` does to place
            // itself on the next render.
            const range = view.document.selection.getFirstRange();
            expect.soft(() => range && view.domConverter.viewRangeToDom(range)).not.toThrow();
        } finally {
            dropTarget.remove();
        }
    });
});

function createDropTarget(value: string) {
    const dropTarget = document.createElement("input");
    dropTarget.value = value;
    document.body.prepend(dropTarget);
    return dropTarget;
}

async function createEditorWithSelectedText(text: string) {
    const editor: ClassicEditor = await createTestEditor([ Essentials, Paragraph, DragOutOfEditor ]);
    _setModelData(editor.model, `<paragraph>[${text}]</paragraph>`);
    editor.editing.view.focus();

    const paragraph = editor.editing.view.getDomRoot()?.querySelector("p");
    if (!paragraph) {
        throw new Error("The editor did not render its paragraph.");
    }
    expect(paragraph.textContent).toBe(text);
    return { editor, paragraph };
}

/** `FocusTracker` reports a blur on a timer, and the editor renders in response to it. */
function waitForBlur() {
    return new Promise((resolve) => setTimeout(resolve, 150));
}
