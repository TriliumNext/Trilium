import { Plugin, ViewDocumentFragment, WidgetToolbarRepository, type ViewAttributeElement, type ViewNode } from "ckeditor5";
import CopyToClipboardButton from "./copy_to_clipboard_button";

/**
 * Shows a small toolbar with a copy button when the cursor is on inline code.
 */
export default class InlineCodeToolbar extends Plugin {

    static get requires() {
        return [WidgetToolbarRepository, CopyToClipboardButton] as const;
    }

    afterInit() {
        const editor = this.editor;
        const widgetToolbarRepository = editor.plugins.get(WidgetToolbarRepository);

        widgetToolbarRepository.register("inlineCode", {
            items: ["copyToClipboard"],
            balloonClassName: "ck-toolbar-container",
            getRelatedElement(selection) {
                const selectionPosition = selection.getFirstPosition();
                if (!selectionPosition) {
                    return null;
                }

                let codeElement: ViewAttributeElement | null = null;
                let parent: ViewNode | ViewDocumentFragment | null = selectionPosition.parent;
                while (parent) {
                    // Linked inline code stays without a toolbar: it would share the balloon stack
                    // with the link balloon, and a caret move that dismisses both re-enters
                    // ContextualBalloon#_showView() and crashes it (ckeditor/ckeditor5#11762).
                    if (parent.is("attributeElement", "a")) {
                        return null;
                    }

                    if (!codeElement && parent.is("attributeElement", "code")) {
                        codeElement = parent;
                    }

                    parent = parent.parent;
                }

                return codeElement;
            }
        });
    }

}
