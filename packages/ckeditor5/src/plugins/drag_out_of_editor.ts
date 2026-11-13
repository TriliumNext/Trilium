import { Plugin, type ViewDocumentInputEvent } from "ckeditor5";

/**
 * Keeps the editor consistent when text is dragged out of it and dropped onto an editable element
 * outside, such as the note title.
 *
 * For such a move the browser deletes the dragged text from the editable's DOM itself
 * (`beforeinput` of type `deleteByDrag`) and focuses the drop target in the same task. The editor
 * handles that mutation only after the focus change: its render then takes the focus back before
 * the browser inserts the text, so the text is lost, or leaves the DOM without the text that the
 * view selection still spans, so the next render throws.
 *
 * `DragDrop` removes the dragged range from the model when a move ends, so the browser's own
 * deletion is canceled.
 */
export default class DragOutOfEditor extends Plugin {

    static get pluginName() {
        return "DragOutOfEditor" as const;
    }

    init() {
        const viewDocument = this.editor.editing.view.document;

        this.listenTo<ViewDocumentInputEvent>(viewDocument, "beforeinput", (_evt, data) => {
            if (data.inputType === "deleteByDrag") {
                data.preventDefault();
            }
        }, { priority: "high" });
    }
}
