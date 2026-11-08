import { Plugin } from "ckeditor5";

import "../../theme/multicolumn.css";
import type {
    ColumnLayoutCommand, InsertLayoutColumnCommand, InsertMulticolumnLayoutCommand,
    MoveLayoutColumnCommand, MoveToLayoutColumnCommand, RemoveMulticolumnLayoutCommand
} from "./multicolumn_commands.js";
import MulticolumnEditing from "./multicolumn_editing.js";
import MulticolumnKeyboard from "./multicolumn_keyboard.js";
import MulticolumnUI from "./multicolumn_ui.js";

/**
 * The multicolumn layout: two to four columns of block content, side by side.
 *
 * This is a "glue" plugin which loads {@link MulticolumnEditing}, {@link MulticolumnKeyboard} and
 * {@link MulticolumnUI}.
 */
export default class Multicolumn extends Plugin {

    public static get requires() {
        return [MulticolumnEditing, MulticolumnKeyboard, MulticolumnUI] as const;
    }

    public static get pluginName() {
        return "Multicolumn" as const;
    }

}

declare module "ckeditor5" {
    interface PluginsMap {
        [Multicolumn.pluginName]: Multicolumn;
        [MulticolumnEditing.pluginName]: MulticolumnEditing;
        [MulticolumnKeyboard.pluginName]: MulticolumnKeyboard;
        [MulticolumnUI.pluginName]: MulticolumnUI;
    }

    interface CommandsMap {
        multicolumnLayout: InsertMulticolumnLayoutCommand;
        columnLayout: ColumnLayoutCommand;
        removeMulticolumnLayout: RemoveMulticolumnLayoutCommand;
        insertLayoutColumn: InsertLayoutColumnCommand;
        moveLayoutColumn: MoveLayoutColumnCommand;
        moveToLayoutColumn: MoveToLayoutColumnCommand;
    }
}
