import { type Editor, isWidget, type Plugin, type ViewDocumentSelection, type ViewElement } from "ckeditor5";

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
 * Sets `_renderer.isFocused` back to `view.document.isFocused` on a press or key in the text,
 * after `preventCKEditorHandling()` turned it off. The view ignores the events of widget UI
 * (`data-cke-ignore-events`), so a press or key that the view sees is back in the text.
 */
export function restoreRendererFocusOnInput(plugin: Plugin) {
    const view = plugin.editor.editing.view;
    const restore = () => {
        //@ts-expect-error: We are accessing a private field.
        view._renderer.isFocused = view.document.isFocused;
    };
    plugin.listenTo(view.document, "mousedown", restore, { priority: "highest" });
    plugin.listenTo(view.document, "keydown", restore, { priority: "highest" });
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

/**
 * Returns the innermost widget with the `property` custom property that is selected or contains
 * the selection. Used as the `getRelatedElement` of a widget toolbar.
 */
export function findSelectedWidget(
    selection: ViewDocumentSelection,
    property: string
): ViewElement | null {
    const selected = selection.getSelectedElement();
    if (selected && isMarkedWidget(selected, property)) {
        return selected;
    }

    let node = selection.getFirstPosition()?.parent ?? null;
    while (node) {
        if (node.is("element") && isMarkedWidget(node, property)) {
            return node;
        }
        node = node.parent;
    }
    return null;
}

function isMarkedWidget(element: ViewElement, property: string) {
    return !!element.getCustomProperty(property) && isWidget(element);
}

/**
 * Keeps `className` on the view elements that `isContainer` accepts and that hold the focused
 * nested editable, like CKEditor keeps `ck-editor__nested-editable_focused` on the editable.
 * With `isInnermostOnly`, only the closest such element gets it. Stylesheets match this class
 * instead of a `:has()` on CKEditor's: that `:has()` re-checks large ancestors on each caret move.
 */
export function markFocusedContainers(
    editor: Editor,
    className: string,
    isContainer: (element: ViewElement) => boolean,
    { isInnermostOnly = false } = {}
) {
    const viewDocument = editor.editing.view.document;
    let marked = new Set<ViewElement>();

    viewDocument.registerPostFixer(writer => {
        const containers = new Set<ViewElement>();
        const editable = viewDocument.isFocused ? viewDocument.selection.editableElement : null;
        for (const ancestor of editable?.getAncestors({ parentFirst: true }) ?? []) {
            if (ancestor.is("element") && isContainer(ancestor)) {
                containers.add(ancestor);
                if (isInnermostOnly) break;
            }
        }

        let isChanged = false;
        for (const element of marked) {
            if (!containers.has(element) && element.hasClass(className)) {
                writer.removeClass(className, element);
                isChanged = true;
            }
        }
        for (const element of containers) {
            if (!element.hasClass(className)) {
                writer.addClass(className, element);
                isChanged = true;
            }
        }
        marked = containers;
        return isChanged;
    });
}
