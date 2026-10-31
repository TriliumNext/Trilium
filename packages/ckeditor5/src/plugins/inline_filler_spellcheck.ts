import { _isInlineViewFiller as isInlineFiller, env, Plugin } from "ckeditor5";

/**
 * Stops the browser spellchecker underlining the word before a formatting boundary.
 *
 * Where the caret ends a formatting run (`**bold**` autoformatted, or Bold toggled off), the
 * renderer inserts `INLINE_FILLER`, seven U+2060 WORD JOINER characters, and keeps it as long as
 * the caret stays in that text node. A word joiner belongs to the word before it, so Chromium
 * checks `bold` and the filler as a single misspelled word, for as long as the rest of the
 * paragraph is being typed.
 *
 * The renderer keeps the filler while `_isSelectionInInlineFiller()` returns `true`. This plugin
 * narrows that check to a text node that holds only the filler, so the filler is removed as soon
 * as text follows it. Desktop browsers skip rendering during an IME composition, so the narrowed
 * check never runs mid-composition there; Android keyboards compose every word, so Android keeps
 * the renderer's own behavior.
 */
export default class InlineFillerSpellcheck extends Plugin {

    static get pluginName() {
        return "InlineFillerSpellcheck" as const;
    }

    init() {
        if (env.isAndroid) {
            return;
        }

        //@ts-expect-error: We are accessing a private field.
        const renderer: FillerRenderer = this.editor.editing.view._renderer;
        const isSelectionInInlineFiller = renderer._isSelectionInInlineFiller.bind(renderer);
        renderer._isSelectionInInlineFiller = () =>
            isSelectionInInlineFiller() && isInlineFiller(renderer._inlineFiller);
    }

}

/** The private members of the editing view's `Renderer` that this plugin reads and replaces. */
interface FillerRenderer {
    /** Never `null` here: `render()` calls `_isSelectionInInlineFiller()` only while it is set. */
    _inlineFiller: Text;
    _isSelectionInInlineFiller(): boolean;
}
