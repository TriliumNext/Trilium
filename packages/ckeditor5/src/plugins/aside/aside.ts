import { type FontColorConfig, Plugin } from "ckeditor5";

import "../../theme/aside.css";
import type { WidgetPositionCommand } from "../positioned_widgets.js";
import type {
    AsideColorCommand, InsertAsideCommand, RemoveAsideCommand
} from "./aside_commands.js";
import AsideEditing from "./aside_editing.js";
import AsideUI, { AsideColorUI } from "./aside_ui.js";

/**
 * The aside: a box of block content beside the main text, which wraps around it, placed and
 * resized as a content embed is.
 *
 * This is a "glue" plugin which loads {@link AsideEditing} and {@link AsideUI}.
 */
export default class Aside extends Plugin {

    static get requires() {
        return [ AsideEditing, AsideUI ] as const;
    }

    static get pluginName() {
        return "Aside" as const;
    }
}

declare module "ckeditor5" {
    interface PluginsMap {
        [ Aside.pluginName ]: Aside;
        [ AsideEditing.pluginName ]: AsideEditing;
        [ AsideUI.pluginName ]: AsideUI;
        [ AsideColorUI.pluginName ]: AsideColorUI;
    }

    interface CommandsMap {
        insertAside: InsertAsideCommand;
        removeAside: RemoveAsideCommand;
        asidePosition: WidgetPositionCommand;
        asideColor: AsideColorCommand;
    }

    interface EditorConfig {
        /** The swatches of the background color dropdown of an aside. */
        asideColor?: FontColorConfig;
    }
}
