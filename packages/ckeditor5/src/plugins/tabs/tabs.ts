import { Plugin } from "ckeditor5";

import "../../theme/scrollable_bar.css";
import "../../theme/tabs.css";
import type {
    AssignTabReferenceCommand, InsertTabCommand, InsertTabsCommand, MoveTabCommand,
    MoveToTabCommand, RemoveTabCommand, TabAlignmentCommand
} from "./tabs_commands.js";
import TabsEditing from "./tabs_editing.js";
import TabsKeyboard from "./tabs_keyboard.js";
import TabsTitleBar from "./tabs_title_bar.js";
import TabsUI from "./tabs_ui.js";

/**
 * The tabs block: titled panels of block content, one of which shows at a time.
 *
 * This is a "glue" plugin which loads {@link TabsEditing}, {@link TabsKeyboard} and
 * {@link TabsUI}.
 */
export default class Tabs extends Plugin {

    public static get requires() {
        return [TabsEditing, TabsKeyboard, TabsUI] as const;
    }

    public static get pluginName() {
        return "Tabs" as const;
    }

}

declare module "ckeditor5" {
    interface PluginsMap {
        [Tabs.pluginName]: Tabs;
        [TabsEditing.pluginName]: TabsEditing;
        [TabsKeyboard.pluginName]: TabsKeyboard;
        [TabsTitleBar.pluginName]: TabsTitleBar;
        [TabsUI.pluginName]: TabsUI;
    }

    interface CommandsMap {
        tabs: InsertTabsCommand;
        insertTab: InsertTabCommand;
        removeTab: RemoveTabCommand;
        moveTabLeft: MoveTabCommand;
        moveTabRight: MoveTabCommand;
        moveTab: MoveTabCommand;
        moveToTab: MoveToTabCommand;
        assignTabReference: AssignTabReferenceCommand;
        tabAlignment: TabAlignmentCommand;
    }
}
