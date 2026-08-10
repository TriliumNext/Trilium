import { Autoformat, blockAutoformatEditing, Plugin } from "ckeditor5";

import { ADMONITION_TYPE_NAMES, AdmonitionType } from "./admonition_command.js";

/**
 * Turns `!!! <type> ` at the start of a block into an admonition of that type. When the word after
 * the marker is not a known type it is kept as the admonition's text instead.
 */
export default class AdmonitionAutoformat extends Plugin {

    static get requires() {
        return [Autoformat] as const;
    }

    afterInit() {
        if (!this.editor.commands.get("admonition")) {
            return;
        }

        // `blockAutoformatEditing` only uses the plugin to own the `change:data` listener, and is
        // typed against `Autoformat` — pass the real instance rather than casting `this`.
        const autoformat = this.editor.plugins.get(Autoformat);

        blockAutoformatEditing(this.editor, autoformat, /^\!\!\[*\! (.+) $/, ({ match }) => {
            const type = tryParseAdmonitionType(match);

            if (type) {
                // User has entered the admonition type, so we insert as-is.
                this.editor.execute("admonition", { forceValue: type });
            } else {
                // User has not entered a valid type, assume it's part of the text of the admonition.
                // The pattern has exactly one capture group, so `match[1]` is always present.
                this.editor.execute("admonition");
                this.editor.execute("insertText", { text: `${match[1]} ` });
            }
        });
    }

}

function tryParseAdmonitionType(match: RegExpMatchArray): AdmonitionType | undefined {
    if ((ADMONITION_TYPE_NAMES as readonly string[]).includes(match[1])) {
        return match[1] as AdmonitionType;
    }
}
