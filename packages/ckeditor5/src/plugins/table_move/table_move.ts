import { Plugin, Table, TableUtils } from "ckeditor5";

import { addEditingKeydownCapture, hasMoveModifier } from "../move_block_updown.js";
import { isSelectionInTable, MoveTableColumnCommand, MoveTableRowCommand } from "./table_move_commands.js";

/**
 * Moves table rows and columns with Alt+Arrow keys. The rows or columns touched by the
 * selection move as one block over the adjacent one; merged cells extend both blocks so the
 * grid is never torn apart. Alt+ArrowUp/Down is dispatched by `MoveBlockUpDownPlugin`, which
 * runs the row commands when the selection is in a table.
 */
export default class TableMove extends Plugin {

    static get requires() {
        return [Table, TableUtils] as const;
    }

    static get pluginName() {
        return "TableMove" as const;
    }

    init() {
        const editor = this.editor;
        const t = editor.t;

        editor.commands.add("moveTableRowUp", new MoveTableRowCommand(editor, "up"));
        editor.commands.add("moveTableRowDown", new MoveTableRowCommand(editor, "down"));
        editor.commands.add("moveTableColumnLeft", new MoveTableColumnCommand(editor, "left"));
        editor.commands.add("moveTableColumnRight", new MoveTableColumnCommand(editor, "right"));

        // Alt+Left/Right keeps its application meaning (note history) outside tables, so the
        // event is only swallowed when the selection is in a table. That includes presses at
        // the table edge, where the command is a no-op, so they do not navigate away mid-edit.
        addEditingKeydownCapture(this, (e) => {
            const command = columnKeyCommands.get(e.key);
            if (!command || !hasMoveModifier(e)) {
                return;
            }
            if (!isSelectionInTable(editor.model.document.selection)) {
                return;
            }
            e.preventDefault();
            e.stopImmediatePropagation();
            if (editor.commands.get(command)?.isEnabled) {
                editor.execute(command);
            }
        });

        editor.accessibility.addKeystrokeInfos({
            keystrokes: [
                { label: t("Move row up"), keystroke: "Alt+ArrowUp" },
                { label: t("Move row down"), keystroke: "Alt+ArrowDown" },
                { label: t("Move column left"), keystroke: "Alt+ArrowLeft" },
                { label: t("Move column right"), keystroke: "Alt+ArrowRight" }
            ]
        });
    }

}

const columnKeyCommands = new Map<string, "moveTableColumnLeft" | "moveTableColumnRight">([
    ["ArrowLeft", "moveTableColumnLeft"],
    ["ArrowRight", "moveTableColumnRight"]
]);

declare module "ckeditor5" {
    interface PluginsMap {
        [TableMove.pluginName]: TableMove;
    }

    interface CommandsMap {
        moveTableRowUp: MoveTableRowCommand;
        moveTableRowDown: MoveTableRowCommand;
        moveTableColumnLeft: MoveTableColumnCommand;
        moveTableColumnRight: MoveTableColumnCommand;
    }
}
