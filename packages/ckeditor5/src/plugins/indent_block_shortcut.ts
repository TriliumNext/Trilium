/**
 * https://github.com/zadam/trilium/issues/978
 */

import { ModelDocumentFragment, ModelElement, Plugin, ModelPosition, ViewDocumentTabEvent, isWidget } from "ckeditor5";

export default class IndentBlockShortcutPlugin extends Plugin {

    init() {
        this.listenTo<ViewDocumentTabEvent>(this.editor.editing.view.document, "tab", (ev, data) => {
            // In tables, allow default Tab behavior for cell navigation
            if (this.isInTable()) return;

            // Always cancel in non-table contexts to prevent widget navigation
            data.preventDefault();
            ev.stop();

            const commandName = data.shiftKey ? "outdentBlock" : "indentBlock";
            const command = this.editor.commands.get(commandName);
            if (command?.isEnabled) {
                command.execute();
            }
        }, {
            context: node => isWidget( node ) || node.is( 'editableElement' ),
        });
    }

    // in table TAB should switch cells
    isInTable() {
        let el: ModelPosition | ModelElement | ModelDocumentFragment | null = this.editor.model.document.selection.getFirstPosition();

        while (el) {
            if ("name" in el && el.name === 'tableCell') {
                return true;
            }

            /* v8 ignore next 1 -- ModelPosition/ModelElement/ModelDocumentFragment all carry `parent`; the null fallback is a defensive guard that can never fire */
            el = "parent" in el ? el.parent : null;
        }

        return false;
    }

}
