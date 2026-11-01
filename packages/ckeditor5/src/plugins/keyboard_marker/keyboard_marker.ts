import { Plugin } from "ckeditor5";

import KbdEditing from "./keyboard_marker_editing.js";
import KbdUI from "./keyboard_marker_ui.js";

/**
 * The keyboard shortcut feature.
 *
 * Provides a way to semantically mark keyboard shortcuts/hotkeys in the content.
 *
 * This is a "glue" plugin which loads the {@link KbdEditing} and {@link KbdUI} plugins.
 *
 * Derived from `@mlewand/ckeditor5-keyboard-marker` (GPL-3.0); see the `LICENSE` and `README.md`
 * next to this file.
 */
export default class Kbd extends Plugin {

    static get requires() {
        return [KbdEditing, KbdUI] as const;
    }

    public static get pluginName() {
        return "Kbd" as const;
    }

}

declare module "ckeditor5" {
    interface PluginsMap {
        [Kbd.pluginName]: Kbd;
        [KbdEditing.pluginName]: KbdEditing;
        [KbdUI.pluginName]: KbdUI;
    }
}
