import { Plugin } from "ckeditor5";

import InlineIconEditing from "./inline_icon_editing.js";
import InlineIconToolbar from "./inline_icon_toolbar.js";
import InlineIconUI from "./inline_icon_ui.js";

/**
 * The icon feature: inserts one icon of an installed icon pack into the text, for writing about the
 * application's own controls without a screenshot of each one.
 *
 * This is a "glue" plugin which loads the {@link InlineIconEditing}, {@link InlineIconUI} and
 * {@link InlineIconToolbar} plugins.
 */
export default class InlineIcon extends Plugin {

    public static get requires() {
        return [ InlineIconEditing, InlineIconUI, InlineIconToolbar ] as const;
    }

    public static get pluginName() {
        return "InlineIcon" as const;
    }

}

declare module "ckeditor5" {
    interface PluginsMap {
        [InlineIcon.pluginName]: InlineIcon;
        [InlineIconEditing.pluginName]: InlineIconEditing;
        [InlineIconUI.pluginName]: InlineIconUI;
        [InlineIconToolbar.pluginName]: InlineIconToolbar;
    }
}
