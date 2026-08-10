import { Plugin } from "ckeditor5";

import "../../theme/footnotes.css";

import FootnoteEditing from "./footnote_editing.js";
import FootnoteUI from "./footnote_ui.js";

/**
 * Footnotes: an inline `[n]` reference in the text, paired with a numbered item in a footnote
 * section at the end of the document.
 *
 * This is a "glue" plugin which loads {@link FootnoteEditing} and {@link FootnoteUI}.
 *
 * Derived from the Forum Magnum footnote plugin; see the `LICENSE.md` and `README.md` next to this
 * file.
 */
export default class Footnotes extends Plugin {

    public static get pluginName() {
        return "Footnotes" as const;
    }

    public static get requires() {
        return [FootnoteEditing, FootnoteUI] as const;
    }

}

declare module "ckeditor5" {
    interface PluginsMap {
        [Footnotes.pluginName]: Footnotes;
        [FootnoteEditing.pluginName]: FootnoteEditing;
        [FootnoteUI.pluginName]: FootnoteUI;
    }
}
