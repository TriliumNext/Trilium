import {
    Command, first, type ModelElement, type ModelPosition, type ModelRange, Plugin
} from "ckeditor5";

import { getDraggedRange } from "./block_drag_handle.js";

/** Registers the `deleteBlocks` command, which the menu of the block handle runs. */
export default class DeleteBlocks extends Plugin {

    static get pluginName() {
        return "DeleteBlocks" as const;
    }

    init() {
        this.editor.commands.add("deleteBlocks", new DeleteBlocksCommand(this.editor));
    }

}

/**
 * Deletes the blocks that the block handle drags, then puts the caret at the start of the block
 * after them, else at the end of the block before them.
 */
export class DeleteBlocksCommand extends Command {

    override refresh() {
        this.isEnabled = !!first(this.editor.model.document.selection.getSelectedBlocks());
    }

    override execute() {
        const model = this.editor.model;
        // `refresh()` enables the command only with a selected block.
        const range = getDraggedRange(model) as ModelRange;

        model.change((writer) => {
            const selection = model.createSelection(range);
            model.deleteContent(selection, { doNotAutoparagraph: true });

            // Fills an emptied parent, such as a table cell, as `DragDrop` does after a move.
            const position = selection.getFirstPosition() as ModelPosition;
            const parent = position.parent as ModelElement;
            if (parent.isEmpty && model.schema.checkChild(parent, "paragraph")) {
                writer.insertElement("paragraph", parent, 0);
            }

            writer.setSelection(model.schema.getNearestSelectionRange(position, "forward")
                ?? model.schema.getNearestSelectionRange(position, "backward"));
        });
    }

}

declare module "ckeditor5" {
    interface PluginsMap {
        [DeleteBlocks.pluginName]: DeleteBlocks;
    }

    interface CommandsMap {
        deleteBlocks: DeleteBlocksCommand;
    }
}
