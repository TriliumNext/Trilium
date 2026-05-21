import { Plugin } from "ckeditor5";
import type { ViewElement } from "ckeditor5";

const CURRENT_CLASS = "ck-tn-current-block";
const ANCESTOR_CLASS = "ck-tn-current-ancestor";
const FOCUS_CLASS = "ck-tn-focus";

/**
 * Marks the block where the caret is currently located (paragraph, list item,
 * table cell content, heading, etc.) with the {@link CURRENT_CLASS} class, and
 * marks every block ancestor of it with {@link ANCESTOR_CLASS}. The root editor
 * element gets {@link FOCUS_CLASS} while the editor is focused.
 *
 * Together these let the stylesheet highlight the current block and dim the
 * rest. The classes are added to the editing view only, so they are never
 * serialized into the note content. No model mutation happens, so there is no
 * undo step and no re-conversion cost — just a few class swaps per block change.
 */
export default class CurrentBlockHighlight extends Plugin {

    static get pluginName() {
        return "CurrentBlockHighlight" as const;
    }

    init() {
        const editor = this.editor;
        const editing = editor.editing;
        const viewDocument = editing.view.document;

        let currentElement: ViewElement | null = null;
        let markedAncestors: ViewElement[] = [];

        const update = () => {
            const modelBlock = [...editor.model.document.selection.getSelectedBlocks()][0] ?? null;
            const viewElement = modelBlock
                ? editing.mapper.toViewElement(modelBlock) ?? null
                : null;

            if (viewElement === currentElement) {
                return;
            }

            editing.view.change((writer) => {
                if (currentElement) {
                    writer.removeClass(CURRENT_CLASS, currentElement);
                }
                for (const ancestor of markedAncestors) {
                    writer.removeClass(ANCESTOR_CLASS, ancestor);
                }
                markedAncestors = [];

                if (viewElement) {
                    writer.addClass(CURRENT_CLASS, viewElement);

                    // Mark every block ancestor so a dimmed element never
                    // contains the current block (opacity cannot be undimmed
                    // on a child once its parent is dimmed).
                    let parent = viewElement.parent;
                    while (parent && parent.is("element") && !parent.is("rootElement")) {
                        writer.addClass(ANCESTOR_CLASS, parent);
                        markedAncestors.push(parent);
                        parent = parent.parent;
                    }
                }
            });

            currentElement = viewElement;
        };

        // Caret moves, typing and clicks all trigger a range change.
        editor.model.document.selection.on("change:range", update);

        // Re-assert after structural edits that may have re-converted the block.
        editor.model.document.on("change:data", () => editing.view.once("render", update));

        // The dimming effect is only active while the editor is focused.
        viewDocument.on("change:isFocused", () => {
            editing.view.change((writer) => {
                const root = viewDocument.getRoot();
                if (!root) {
                    return;
                }
                if (viewDocument.isFocused) {
                    writer.addClass(FOCUS_CLASS, root);
                } else {
                    writer.removeClass(FOCUS_CLASS, root);
                }
            });
        });
    }
}
