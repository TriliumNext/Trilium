import {
    type Editor,
    EmojiPicker,
    EmojiRepository,
    type EmojiSkinToneId,
    type MentionFeedObjectItem,
    Plugin,
    Typing
} from "ckeditor5";

import { registerMentionFeed } from "./register_feed.js";

export const EMOJI_MARKER = ":";

/** The trailing entry that hands the query over to the full emoji picker. */
const SHOW_ALL_ID = ":__trilium_show_all_emoji__:";

const DROPDOWN_LIMIT = 6;

/**
 * The `:smile:` autocomplete, hosted on {@link TriliumMentionUI}.
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
 * feed's own {@link TriliumMentionFeed.commit} callback rather than the `mention` command, so there
 * is no listener left to be orphaned by a command swap.
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

        registerMentionFeed(editor, {
            marker: EMOJI_MARKER,
            // `:` is common in ordinary prose ("note: see below"). The marker pattern already
            // requires whitespace before it, and two more characters keep a bare `:` from opening
            // a panel over every colon the user types.
            minimumCharacters: 2,
            dropdownLimit: editor.config.get("emoji.dropdownLimit") as number,
            feed: (query: string) => this._query(query),
            itemRenderer: (item) => this._renderItem(item),
            commit: (editorInstance, item) => this._commit(editorInstance, item)
        });
    }

    private get _picker(): EmojiPicker | null {
        return this.editor.plugins.has(EmojiPicker) ? this.editor.plugins.get(EmojiPicker) : null;
    }

    private _query(query: string): MentionFeedObjectItem[] {
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

        const emojis = repository.getEmojiByQuery(query).map((emoji) => ({
            id: `${EMOJI_MARKER}${emoji.annotation}${EMOJI_MARKER}`,
            text: emoji.skins[skinTone] ?? emoji.skins.default
        }));

        if (!this._picker) {
            return emojis;
        }

        // One slot is given up to the hand-off entry, so the list length stays at the limit.
        return [ ...emojis.slice(0, limit - 1), { id: SHOW_ALL_ID, text: query } ];
    }

    private _renderItem(item: MentionFeedObjectItem): HTMLElement {
        const button = document.createElement("button");
        button.type = "button";
        button.tabIndex = -1;
        button.classList.add("ck", "ck-button", "ck-button_with-text");

        const label = document.createElement("span");
        label.classList.add("ck", "ck-button__label");
        label.textContent = item.id === SHOW_ALL_ID
            ? this.editor.t("Show all emoji...")
            : `${item.text} ${item.id}`;

        button.append(label);
        return button;
    }

    private _commit(editor: Editor, item: MentionFeedObjectItem) {
        if (item.id !== SHOW_ALL_ID) {
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
