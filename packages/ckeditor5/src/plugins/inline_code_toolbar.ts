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

        // Suppress the generic BalloonToolbar while the cursor is inside
        // inline code (#11077) — the same suppression code_block_toolbar
        // applies for code blocks. Clicking the boundary of inline code that
        // carries a link makes both toolbars claim the selection at once:
        // the BalloonToolbar fires `show`, WidgetToolbarRepository reacts by
        // removing the inline-code balloon, and that removal runs the
        // balloon's position computation against an already-torn-down view
        // stack ("TypeError: can't access property 'values',
        // this._visibleStack is undefined"). Stopping the generic toolbar's
        // show while the view selection sits inside inline code keeps exactly
        // one balloon alive around the selection.
        if (editor.plugins.has("BalloonToolbar")) {
            editor.listenTo(editor.plugins.get("BalloonToolbar"), "show", (evt) => {
                const viewSelection = editor.editing.view.document.selection;
                const viewPosition = viewSelection.getFirstPosition();
                if (!viewPosition) {
                    return;
                }
                let parent: ViewNode | ViewDocumentFragment | null = viewPosition.parent;
                while (parent) {
                    if (parent.is("attributeElement", "code")) {
                        evt.stop();
                        return;
                    }
                    parent = parent.parent;
                }
            }, { priority: "high" });
        }
    }

}
