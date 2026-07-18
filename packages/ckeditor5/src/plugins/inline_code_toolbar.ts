import { Plugin, ViewDocumentFragment, WidgetToolbarRepository, type ViewNode } from "ckeditor5";
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

                let parent: ViewNode | ViewDocumentFragment | null = selectionPosition.parent;
                while (parent) {
                    if (parent.is("attributeElement", "code")) {
                        return parent;
                    }
                    parent = parent.parent;
                }

                return null;
            }
        });
    }

}
