import "../../theme/collapsible_headings.css";

import { Plugin } from "ckeditor5";

import CollapsibleHeadingsEditing, {
    type ToggleHeadingCollapseCommand
} from "./collapsible_headings_editing.js";
import CollapsibleHeadingsUI from "./collapsible_headings_ui.js";

/**
 * Headings that collapse to hide the blocks under them, with an arrow at the end of the heading
 * and `Ctrl+Alt+Enter`.
 */
export default class CollapsibleHeadings extends Plugin {

    static get pluginName() {
        return "CollapsibleHeadings" as const;
    }

    static get requires() {
        return [ CollapsibleHeadingsEditing, CollapsibleHeadingsUI ] as const;
    }

}

declare module "ckeditor5" {
    interface PluginsMap {
        [CollapsibleHeadings.pluginName]: CollapsibleHeadings;
        [CollapsibleHeadingsEditing.pluginName]: CollapsibleHeadingsEditing;
        [CollapsibleHeadingsUI.pluginName]: CollapsibleHeadingsUI;
    }

    interface CommandsMap {
        toggleHeadingCollapse: ToggleHeadingCollapseCommand;
    }
}
