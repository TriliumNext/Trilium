import { env, type Observable, Plugin, type ViewNode } from "ckeditor5";

/**
 * Leaves the DOM selection to Firefox while the user drags it, and renders it when the drag ends,
 * as the renderer does in Chromium.
 *
 * A drag that covers just a widget makes `Widget` select the widget, and the renderer then moves
 * the DOM selection into its fake selection container at the end of the editable. Firefox goes on
 * extending the drag from there, so the note gets highlighted from the pointer to its end.
 */
export default class KeepDragSelection extends Plugin {

    static get pluginName() {
        return "KeepDragSelection" as const;
    }

    init() {
        if (!env.isGecko || env.isAndroid) {
            return;
        }

        //@ts-expect-error: We are accessing a private field.
        const renderer: SelectingRenderer = this.editor.editing.view._renderer;
        const updateSelection = renderer._updateSelection.bind(renderer);
        renderer._updateSelection = () => {
            // A change of structure can remove the DOM nodes that the selection is in.
            if (!renderer.isSelecting || renderer.markedChildren.size) {
                updateSelection();
            }
        };
        this.listenTo(renderer, "change:isSelecting", () => {
            if (!renderer.isSelecting) {
                renderer.render();
            }
        });
    }

}

interface SelectingRenderer extends Observable {
    isSelecting: boolean;
    markedChildren: Set<ViewNode>;
    render(): void;
    _updateSelection(): void;
}
