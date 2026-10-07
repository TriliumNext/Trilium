import { Plugin } from "ckeditor5";

import "../../theme/tabs.css";
import TabsEditing from "./tabs_editing.js";
import type { InsertTabCommand, InsertTabsCommand, MoveTabCommand, RemoveTabCommand } from "./tabs_commands.js";
import TabsUI from "./tabs_ui.js";

/**
 * The tabs block: titled panels of block content, one of which shows at a time.
 *
 * This is a "glue" plugin which loads {@link TabsEditing} and {@link TabsUI}.
 */
export default class Tabs extends Plugin {

    public static get requires() {
        return [TabsEditing, TabsUI] as const;
    }

    public static get pluginName() {
        return "Tabs" as const;
    }

}

declare module "ckeditor5" {
    interface PluginsMap {
        [Tabs.pluginName]: Tabs;
        [TabsEditing.pluginName]: TabsEditing;
        [TabsUI.pluginName]: TabsUI;
    }

    interface CommandsMap {
        tabs: InsertTabsCommand;
        insertTab: InsertTabCommand;
        removeTab: RemoveTabCommand;
        moveTabLeft: MoveTabCommand;
        moveTabRight: MoveTabCommand;
    }
}
