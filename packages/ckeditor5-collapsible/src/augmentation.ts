import CollapsibleCommand from "./collapsible-command.js";
import CollapsibleEditing from "./collapsible-editing.js";
import CollapsibleUI from "./collapsible-ui.js";
import type { Collapsible } from "./index.js";

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
