import { Plugin } from "ckeditor5";

import "../../theme/collapsible.css";
import type CollapsibleCommand from "./collapsible_command.js";
import CollapsibleEditing from "./collapsible_editing.js";
import CollapsibleUI from "./collapsible_ui.js";

/**
 * The collapsible block feature: a `<details>` / `<summary>` pair holding block content.
 *
 * This is a "glue" plugin which loads {@link CollapsibleEditing} and {@link CollapsibleUI}.
 */
export default class Collapsible extends Plugin {

    public static get requires() {
        return [CollapsibleEditing, CollapsibleUI] as const;
    }

    public static get pluginName() {
        return "Collapsible" as const;
    }

}

declare module "ckeditor5" {
    interface PluginsMap {
        [Collapsible.pluginName]: Collapsible;
        [CollapsibleEditing.pluginName]: CollapsibleEditing;
        [CollapsibleUI.pluginName]: CollapsibleUI;
    }

    interface CommandsMap {
        collapsible: CollapsibleCommand;
    }
}
