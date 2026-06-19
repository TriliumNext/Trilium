import { Plugin } from "ckeditor5";
import type { InsertTextCommandExecuteEvent, InsertTextCommandOptions, ModelPosition, ModelWriter } from "ckeditor5";

/**
 * Automatically capitalizes the first letter of a sentence as the user types,
 * similar to Word and OneNote.
 *
 * The first letter of a word is capitalized when that word starts a sentence:
 *   - at the start of a block (a new paragraph, list item, heading, ...), or
 *   - after sentence-ending punctuation (".", "!", "?") followed by whitespace.
 *
 * Following Word / OneNote, the capital is applied only when the word is
 * *finished* — when a space (or tab) is typed after it, or when the line/word is
 * ended with Enter or Shift+Enter — not while the word is still being typed. The
 * capital is recorded as its own undo step, applied after that triggering
 * keystroke, which makes the undo match autocorrect exactly: pressing Ctrl+Z
 * (Cmd+Z) once reverts only the capitalization ("Is " -> "is ", "I " -> "i "
 * keeping the space), and a further Ctrl+Z removes the typed text / line break.
 * The capital is never undone before the text that triggered it.
 *
 * This is achieved by listening to the `insertText`, `enter` and `shiftEnter`
 * commands at low priority and replacing the letter through
 * `model.enqueueChange()`, which records the replacement in a new,
 * separately-undoable batch. The replacement reads the model from inside the
 * queued callback (not the listener), so it sees the finished word whether the
 * command was run directly or wrapped in the Typing plugin's own
 * `enqueueChange()` during real keystrokes. It is applied before the browser
 * repaints, so there is no visible flash of the lowercase letter.
 *
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
        const model = this.editor.model;

        // Typing: a single whitespace character (space / tab) ends a word.
        const insertText = this.editor.commands.get("insertText");
        /* v8 ignore next 3 -- defensive: the insertText command is always registered by the Typing plugin */
        if (insertText) {
            this.listenTo<InsertTextCommandExecuteEvent>(insertText, "execute", (_evt, [ options ]) => {
                if (!isWhitespaceTrigger(options)) {
                    return;
                }
                // Defer into a fresh batch so the capital is a separate undo step
                // and runs after the whitespace has actually landed in the model
                // (real typing wraps the command in its own enqueueChange, so the
                // insertion is queued — reading the model here, inside the queued
                // callback, sees the finished word in every case).
                model.enqueueChange(writer => {
                    const caret = model.document.selection.getFirstPosition();
                    if (caret && caret.offset >= 1) {
                        // The word ends just before the whitespace.
                        this.capitalizeWordEndingAt(writer, caret.getShiftedBy(-1));
                    }
                });
            }, { priority: "low" });
        }

        // Enter / Shift+Enter also finish a word (a new line or paragraph).
        for (const name of [ "enter", "shiftEnter" ] as const) {
            const command = this.editor.commands.get(name);
            if (!command) {
                continue;
            }
            this.listenTo(command, "execute", () => {
                model.enqueueChange(writer => {
                    const end = this.lineBreakWordEnd(name);
                    if (end) {
                        this.capitalizeWordEndingAt(writer, end);
                    }
                });
            }, { priority: "low" });
        }
    }

    /**
     * The position at which the word finished by a line break ends. `enter`
     * splits the block, so the finished word is at the end of the previous block;
     * `shiftEnter` inserts a soft break in the same block, so it is just before
     * the caret.
     */
    private lineBreakWordEnd(command: "enter" | "shiftEnter"): ModelPosition | null {
        const model = this.editor.model;
        const caret = model.document.selection.getFirstPosition();
        if (!caret) {
            return null;
        }
        if (command === "shiftEnter") {
            return caret.offset >= 1 ? caret.getShiftedBy(-1) : null;
        }
        const previousBlock = caret.parent.previousSibling;
        if (!previousBlock || !previousBlock.is("element")) {
            return null;
        }
        return model.createPositionAt(previousBlock, "end");
    }

    /**
     * Capitalizes the first letter of the word that ends at `end`, but only if
     * that word starts a sentence. The caret is left untouched: the replacement
     * is length-neutral and happens before the caret, so the live selection
     * adjusts on its own.
     */
    private capitalizeWordEndingAt(writer: ModelWriter, end: ModelPosition) {
        const model = this.editor.model;
        const { text, startOffset } = this.textBefore(end);

        // The finished word is the trailing run of non-whitespace.
        const match = text.match(/\S+$/);
        if (!match) {
            return;
        }
        const word = match[0];
        const firstChar = word[0];
        const upper = firstChar.toUpperCase();
        // Skip if the first character is not a lowercase letter with a distinct
        // capital (already-uppercase letters, digits, symbols).
        if (upper === firstChar) {
            return;
        }

        // The word must start a sentence.
        const beforeWord = text.slice(0, text.length - word.length);
        if (!isSentenceStart(beforeWord, startOffset === 0)) {
            return;
        }

        // Resolve that first letter in the model (its offset maps 1:1 from the
        // text window, since each non-text item counts as one space).
        const letterStart = model.createPositionAt(end.parent, startOffset + text.length - word.length);
        const letterRange = model.createRange(letterStart, letterStart.getShiftedBy(1));
        const item = Array.from(letterRange.getItems())[0];
        if (!item || (!item.is("$textProxy") && !item.is("$text"))) {
            return;
        }
        if (item.data !== firstChar) {
            return;
        }

        // Leave case-sensitive content (code blocks, inline code) untouched.
        if (letterStart.parent.is("element", "codeBlock")) {
            return;
        }
        if (item.getAttribute("code")) {
            return;
        }

        // Replace the lowercase letter with its capital, preserving any inline
        // formatting it carries.
        const attributes = Object.fromEntries(item.getAttributes());
        writer.remove(letterRange);
        writer.insertText(upper, attributes, letterStart);
    }

    private textBefore(end: ModelPosition): { text: string; startOffset: number } {
        // A sentence boundary needs only a few characters of context, so cap the
        // lookback instead of scanning a whole large paragraph on every word end.
        const model = this.editor.model;
        const startOffset = Math.max(0, end.offset - LOOKBEHIND);
        const range = model.createRange(model.createPositionAt(end.parent, startOffset), end);
        let text = "";
        for (const item of range.getItems()) {
            if (item.is("$textProxy") || item.is("$text")) {
                text += item.data;
            } else {
                text += " ";
            }
        }
        return { text, startOffset };
    }

}

/** How many characters before the trigger to inspect when detecting a sentence boundary. */
const LOOKBEHIND = 50;

/** Whether the insertText options represent a single whitespace keystroke. */
function isWhitespaceTrigger(options: InsertTextCommandOptions | undefined): boolean {
    return !!options && !!options.text && options.text.length === 1 && /\s/.test(options.text);
}

/**
 * Whether `before` (the text from the start of the block up to the word) ends at
 * a sentence boundary: the point where the word that follows starts a sentence.
 */
function isSentenceStart(before: string, isAtBlockStart: boolean) {
    // Start of the block (optionally after leading whitespace).
    if (isAtBlockStart && /^\s*$/.test(before)) {
        return true;
    }
    // After ".", "!" or "?" (optionally followed by closing quotes/brackets)
    // and at least one whitespace character.
    return /[.!?]["')\]]*\s+$/.test(before);
}
