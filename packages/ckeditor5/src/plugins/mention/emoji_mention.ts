import { IconEmoji } from "@ckeditor/ckeditor5-icons";
import {
    type Editor,
    EmojiPicker,
    EmojiRepository,
    type EmojiSkinToneId,
    type MentionFeedObjectItem,
    Plugin,
    Typing
} from "ckeditor5";

import { registerHostedMentionFeed } from "./register_feed.js";
import type { MentionHostedList } from "./types.js";

export const EMOJI_MARKER = ":";

/** The trailing entry that hands the query over to the full emoji picker. */
const SHOW_ALL_ID = ":__trilium_show_all_emoji__:";

const DROPDOWN_LIMIT = 6;

declare module "@ckeditor/ckeditor5-emoji" {
    interface EmojiConfig {
        /**
         * The host's list of the `:` completion, which lists {@link TriliumEmojiMention.search} for
         * the query and commits the {@link EmojiSuggestion} picked. Without it there is no completion.
         */
        list?: ( editor: Editor ) => MentionHostedList;
    }
}

/** An entry of the `:` completion, as {@link TriliumEmojiMention.search} lists it and its list commits it. */
export interface EmojiSuggestion extends MentionFeedObjectItem {
    /** The emoji, or for the entry that opens the picker, the query it opens the picker on. */
    text: string;
    /** What the row says: the emoji's `:annotation:`, or the picker entry's caption. */
    title: string;
    /** Marks the entry that opens the emoji picker on the query instead of inserting an emoji. */
    opensPicker?: boolean;
    /** The picker entry's icon as SVG markup: the one of the toolbar button that opens the picker too. */
    icon?: string;
}

/**
 * The `:smile:` autocomplete: what it finds and what a pick inserts, for the list the host draws in
 * `emoji.list`, which {@link TriliumMentionUI} runs as a hosted feed.
 *
 * Upstream ships this as `EmojiMention`, which we cannot use: it `requires` the `Mention` façade and
 * so drags in upstream's `MentionUI` next to ours, leaving the text editor with two panels fighting
 * over the same balloon. It was also broken here regardless of that — it binds its insert-as-text
 * handler to the `mention` command in `init()`, but `MentionCustomization` replaces that command in
 * `afterInit()`, so the handler ended up bound to a discarded instance and picking an emoji fell
 * through to `CustomMentionCommand`, which inserted a `#undefined` reference link.
 *
 * Only that ~60 lines of glue is reimplemented here. The emoji data, the query engine and the picker
 * remain upstream's: `EmojiRepository` requires just `EmojiUtils`, and `EmojiPicker` never touches
 * `Mention`, so neither pulls a second autocomplete UI into the editor. Insertion goes through the
 * feed's own `commit` callback rather than the `mention` command, so there is no listener left to
 * be orphaned by a command swap.
 */
export default class TriliumEmojiMention extends Plugin {

    static get pluginName() {
        return "TriliumEmojiMention" as const;
    }

    static get requires() {
        return [ EmojiRepository, Typing ];
    }

    constructor(editor: Editor) {
        super(editor);

        editor.config.define("emoji", { dropdownLimit: DROPDOWN_LIMIT });

        const list = editor.config.get("emoji.list");
        if (!list) {
            return;
        }

        registerHostedMentionFeed(editor, {
            marker: EMOJI_MARKER,
            // `:` is common in ordinary prose ("note: see below"). The marker pattern already
            // requires whitespace before it, and two more characters keep a bare `:` from opening
            // a list over every colon the user types.
            minimumCharacters: 2,
            list,
            commit: (editorInstance, item) => this._commit(editorInstance, item as EmojiSuggestion)
        });
    }

    /**
     * The emoji matching what was typed after the `:`, at most `emoji.dropdownLimit` of them, the
     * last of which opens the picker on the query where the picker is loaded.
     */
    search(query: string): EmojiSuggestion[] {
        const repository = this.editor.plugins.get(EmojiRepository);

        if (!repository.isRepositoryReady) {
            return [];
        }

        // The picker owns the skin tone once it is loaded — the user can change it there, and that
        // choice is not written back to the config.
        // `EmojiRepository` defines `emoji.skinTone` (defaulting to `"default"`), so the config read
        // never comes back empty.
        const picker = this._picker;
        const skinTone = picker ? picker.skinTone : this.editor.config.get("emoji.skinTone") as EmojiSkinToneId;
        const limit = this.editor.config.get("emoji.dropdownLimit") as number;

        const emojis = repository.getEmojiByQuery(query).map((emoji): EmojiSuggestion => {
            const shortcode = `${EMOJI_MARKER}${emoji.annotation}${EMOJI_MARKER}`;
            return { id: shortcode, title: shortcode, text: emoji.skins[skinTone] ?? emoji.skins.default };
        });

        if (!picker) {
            return emojis.slice(0, limit);
        }

        // One slot is given up to the hand-off entry, so the list length stays at the limit.
        return [
            ...emojis.slice(0, limit - 1),
            { id: SHOW_ALL_ID, title: this.editor.t("Show all emoji..."), text: query, opensPicker: true, icon: IconEmoji }
        ];
    }

    private get _picker(): EmojiPicker | null {
        return this.editor.plugins.has(EmojiPicker) ? this.editor.plugins.get(EmojiPicker) : null;
    }

    private _commit(editor: Editor, item: EmojiSuggestion) {
        if (!item.opensPicker) {
            editor.execute("insertText", { text: item.text });
            return;
        }

        const picker = this._picker;

        /* v8 ignore next 3 -- the hand-off entry is only ever added to the feed while `EmojiPicker` is loaded, so it cannot be picked when the plugin is absent */
        if (!picker) {
            return;
        }

        picker.showUI(item.text);
        // The picker renders into the balloon during `showUI()`; focusing it has to wait until that
        // view exists. Mirrors upstream `EmojiMention`.
        setTimeout(() => picker.emojiPickerView?.focus());
    }
}
