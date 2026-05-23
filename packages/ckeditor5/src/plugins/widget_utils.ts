import type { Editor } from "ckeditor5";

/**
 * Hack coming from https://github.com/ckeditor/ckeditor5/issues/4465
 * Prevents CKEditor from handling events inside widget UI elements.
 */
export function preventCKEditorHandling(domElement: HTMLElement, editor: Editor) {
    domElement.addEventListener("mousedown", (evt: Event) => {
        evt.stopPropagation();
        // This prevents rendering changed view selection thus preventing to changing DOM selection while inside a widget.
        //@ts-expect-error: We are accessing a private field.
        editor.editing.view._renderer.isFocused = false;

        // Select the parent widget so its toolbar appears.
        selectParentWidget(domElement, editor);
    }, { capture: true });

    domElement.addEventListener("focus", stopEventPropagationAndHackRendererFocus, { capture: true });
    domElement.addEventListener("keydown", stopEventPropagationAndHackRendererFocus, { capture: true });

    function stopEventPropagationAndHackRendererFocus(evt: Event) {
        evt.stopPropagation();
        //@ts-expect-error: We are accessing a private field.
        editor.editing.view._renderer.isFocused = false;
    }
}

/**
 * Finds the closest widget ancestor of a DOM element and selects it in the
 * editor model. This makes the widget toolbar appear when clicking inside
 * UI elements that have `data-cke-ignore-events`.
 */
function selectParentWidget(domElement: HTMLElement, editor: Editor) {
    // Walk up from the parent to find the widget container. We skip
    // domElement itself because it's the inner UI element (e.g.
    // span.link-mention-inner), not the widget wrapper (span.link-mention).
    const parent = domElement.parentElement;
    if (!parent) return;
    const widgetDom = parent.closest("[data-cke-widget-wrapper]") ?? parent;
    if (!(widgetDom instanceof HTMLElement)) return;

    const viewElement = editor.editing.view.domConverter.mapDomToView(widgetDom);
    if (!viewElement || !viewElement.is("element")) return;

    const modelElement = editor.editing.mapper.toModelElement(viewElement);
    if (!modelElement) return;

    editor.editing.view.focus();

    editor.model.enqueueChange({ isUndoable: false }, writer => {
        writer.setSelection(modelElement, "on");
    });
}
