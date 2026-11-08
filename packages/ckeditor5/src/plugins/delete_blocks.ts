import {
    ClipboardPipeline, Command, type Editor, first, type ModelElement, type ModelPosition,
    type ModelRange, Plugin, ViewDataTransfer
} from "ckeditor5";

import { getDraggedRange } from "./block_drag_handle.js";

/** The clipboard flavors of the blocks that `copyBlocks` serializes. */
export interface BlocksClipboardData {
    html: string;
    text: string;
}

/**
 * Registers the `copyBlocks` and `deleteBlocks` commands, which the menu of the block handle runs.
 */
export default class DeleteBlocks extends Plugin {

    static get requires() {
        return [ ClipboardPipeline ] as const;
    }

    static get pluginName() {
        return "DeleteBlocks" as const;
    }

    init() {
        this.editor.commands.add("copyBlocks", new CopyBlocksCommand(this.editor));
        this.editor.commands.add("deleteBlocks", new DeleteBlocksCommand(this.editor));
    }

}

/**
 * Returns the HTML and plain text that a copy puts on the clipboard for the blocks that the block
 * handle drags. The selection and the content stay as they are.
 */
export class CopyBlocksCommand extends Command {

    constructor(editor: Editor) {
        super(editor);
        this.affectsData = false;
    }

    override refresh() {
        this.isEnabled = !!first(this.editor.model.document.selection.getSelectedBlocks());
    }

    override execute(): BlocksClipboardData {
        const model = this.editor.model;
        const { isBackward } = model.document.selection;
        const ranges = Array.from(model.document.selection.getRanges());
        // `refresh()` enables the command only with a selected block.
        const selection = model.createSelection(getDraggedRange(model) as ModelRange);
        const dataTransfer = new ViewDataTransfer(new DataTransfer());
        // The step that a native copy runs, so that the `clipboardOutput` listeners apply.
        this.editor.plugins.get(ClipboardPipeline)
            ._fireOutputTransformationEvent(dataTransfer, selection, "copy");
        // `_fireOutputTransformationEvent()` leaves the copied blocks selected.
        model.change((writer) => writer.setSelection(ranges, { backward: isBackward }));

        return {
            html: dataTransfer.getData("text/html"),
            text: dataTransfer.getData("text/plain")
        };
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
        copyBlocks: CopyBlocksCommand;
        deleteBlocks: DeleteBlocksCommand;
    }
}
