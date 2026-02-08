/**
 * https://github.com/zadam/trilium/issues/978
 */

import { ModelDocumentFragment, ModelElement, Plugin, ModelPosition } from "ckeditor5";

export default class IndentBlockShortcutPlugin extends Plugin {

    init() {
        this.editor.keystrokes.set( 'Tab', ( _, cancel ) => {
            // In tables, allow default Tab behavior for cell navigation
            if (this.isInTable()) {
                return;
            }

            const command = this.editor.commands.get( 'indentBlock' );
            if (command?.isEnabled) {
                command.execute();
            }

            // Always cancel in non-table contexts to prevent widget navigation
            cancel();
        } );

        this.editor.keystrokes.set( 'Shift+Tab', ( _, cancel ) => {
            // In tables, allow default Shift+Tab behavior for cell navigation
            if (this.isInTable()) {
                return;
            }

            const command = this.editor.commands.get( 'outdentBlock' );
            if (command?.isEnabled) {
                command.execute();
            }

            // Always cancel in non-table contexts to prevent widget navigation
            cancel();
        } );
    }

    // in table TAB should switch cells
    isInTable() {
        let el: ModelPosition | ModelElement | ModelDocumentFragment | null = this.editor.model.document.selection.getFirstPosition();

        while (el) {
            if ("name" in el && el.name === 'tableCell') {
                return true;
            }

            el = "parent" in el ? el.parent : null;
        }

        return false;
    }

}
