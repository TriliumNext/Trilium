import {
    getLocalizedArrowKeyCodeDirection, type ModelElement, Plugin, Table,
    type ViewDocumentArrowKeyEvent, WidgetTypeAround
} from "ckeditor5";

/**
 * Leaves a table with the arrow keys onto the fake caret of `WidgetTypeAround` beside it, where
 * typing adds a paragraph. `TableKeyboard` selects the whole table instead, which typing replaces.
 */
export default class TableExitCaret extends Plugin {

    static get requires() {
        return [ Table, WidgetTypeAround ] as const;
    }

    static get pluginName() {
        return "TableExitCaret" as const;
    }

    init() {
        const editor = this.editor;
        const selection = editor.model.document.selection;
        let leaving: { table: ModelElement; side: "before" | "after" } | null = null;

        this.listenTo<ViewDocumentArrowKeyEvent>(editor.editing.view.document, "arrowKey",
            (_evt, data) => {
            const table = selection.focus?.findAncestor("table");
            if (!table || data.shiftKey) {
                return;
            }
            const direction = getLocalizedArrowKeyCodeDirection(data.keyCode,
                editor.locale.contentLanguageDirection);
            const isForward = direction === "down" || direction === "right";
            leaving = { table, side: isForward ? "after" : "before" };
            queueMicrotask(() => {
                leaving = null;
            });
        }, { context: "$capture" });

        // The selection takes its attributes again once it moved, so the fake caret comes after.
        this.listenTo(selection, "change:range", () => {
            if (leaving && selection.getSelectedElement() === leaving.table) {
                const { side } = leaving;
                leaving = null;
                editor.model.enqueueChange((writer) =>
                    writer.setSelectionAttribute("widget-type-around", side));
            }
        });
    }
}
