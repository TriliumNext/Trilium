import { Plugin } from "ckeditor5";
import type { InsertTextCommandExecuteEvent, InsertTextCommandOptions, ModelPosition } from "ckeditor5";

/**
 * Automatically capitalizes the first letter of a sentence as the user types,
 * similar to Word and OneNote.
 *
 * A letter is capitalized when it is typed:
 *   - at the start of a block (a new paragraph, list item, heading, ...), or
 *   - after sentence-ending punctuation (".", "!", "?") followed by whitespace.
 *
 * The transformation hooks the `insertText` command before insertion, so the
 * capital becomes part of the normal typing operation: undo/redo and inline
 * formatting behave exactly as if the user had typed the capital themselves.
 * Code blocks and inline code are skipped so case-sensitive content is left
 * untouched.
 *
 * The feature is opt-in: the plugin is removed from the editor unless the
 * `textNoteAutoCapitalizeEnabled` option is enabled (gated by
 * `getDisabledPlugins()` in the client editor configuration).
 */
export default class AutoCapitalize extends Plugin {

    static get pluginName() {
        return "AutoCapitalize" as const;
    }

    init() {
        const command = this.editor.commands.get("insertText");
        /* v8 ignore next 3 -- defensive: the insertText command is always registered by the Typing plugin */
        if (!command) {
            return;
        }

        this.listenTo<InsertTextCommandExecuteEvent>(command, "execute", (_evt, [ options ]) => {
            this.capitalizeSentenceStart(options);
        }, { priority: "high" });
    }

    private capitalizeSentenceStart(options: InsertTextCommandOptions | undefined) {
        if (!options || !options.text || options.text.length !== 1) {
            return;
        }

        // Only act on a lowercase letter that has a distinct uppercase form
        // (skips digits, punctuation, whitespace and already-uppercase letters).
        const text = options.text;
        const upper = text.toUpperCase();
        if (upper === text) {
            return;
        }

        // Typing always targets the model selection, which is where the
        // character will land. Programmatic inserts that pass an explicit
        // range are ignored, so only real typing is affected.
        const selection = options.selection ?? this.editor.model.document.selection;
        const position = selection.getFirstPosition();
        /* v8 ignore next 3 -- defensive: a typing selection always has a position */
        if (!position) {
            return;
        }

        // Leave case-sensitive content (code blocks, inline code) untouched.
        if (position.parent.is("element", "codeBlock")) {
            return;
        }
        if (selection.hasAttribute("code")) {
            return;
        }

        const { text: before, isAtBlockStart } = this.getTextBefore(position);
        if (isSentenceStart(before, isAtBlockStart)) {
            options.text = upper;
        }
    }

    private getTextBefore(position: ModelPosition): { text: string; isAtBlockStart: boolean } {
        // A sentence boundary needs only a few characters of context before the
        // caret, so cap the lookback instead of scanning a whole large paragraph
        // on every keystroke.
        const model = this.editor.model;
        const startOffset = Math.max(0, position.offset - LOOKBEHIND);
        const range = model.createRange(model.createPositionAt(position.parent, startOffset), position);
        let before = "";
        for (const item of range.getItems()) {
            if (item.is("$textProxy") || item.is("$text")) {
                before += item.data;
            } else {
                before += " ";
            }
        }
        return { text: before, isAtBlockStart: startOffset === 0 };
    }

}

/**
 * Whether `before` (the text from the start of the current block up to the
 * caret) ends at a sentence boundary: the point where the next typed letter
 * starts a new sentence.
 */
/** How many characters before the caret to inspect when detecting a sentence boundary. */
const LOOKBEHIND = 50;

function isSentenceStart(before: string, isAtBlockStart: boolean) {
    // Start of the block (optionally after leading whitespace).
    if (isAtBlockStart && /^\s*$/.test(before)) {
        return true;
    }
    // After ".", "!" or "?" (optionally followed by closing quotes/brackets)
    // and at least one whitespace character.
    return /[.!?]["')\]]*\s+$/.test(before);
}
