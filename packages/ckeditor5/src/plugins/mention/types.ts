import type { Editor, MentionFeedObjectItem } from "ckeditor5";

/**
 * Merged into upstream's `MentionConfig` so that `EditorConfig["mention"]` accepts it at every call
 * site. The augmentation targets `@ckeditor/ckeditor5-mention` rather than `ckeditor5`, because the
 * umbrella package is a pure re-export barrel and augmenting it would declare a new interface
 * instead of merging into the existing one.
 */
declare module "@ckeditor/ckeditor5-mention" {
    interface MentionConfig {
        /**
         * Markers whose list the host runs entirely: what it lists, how it draws it, which entry is
         * highlighted and what a pick means. {@link TriliumMentionUI} only reports the query typed
         * after the marker, forwards the keys while the list is open and commits what the host hands
         * back.
         */
        hostedFeeds?: MentionHostedFeed[];
    }
}

/** A marker whose list the host runs. See `mention.hostedFeeds`. */
export interface MentionHostedFeed {
    marker: string;
    /**
     * How many characters must follow the marker before the list opens. `0`, the default, opens it
     * on the bare marker.
     */
    minimumCharacters?: number;
    /**
     * Whether the query can contain spaces. Note titles do (`@My meeting notes`), attribute names
     * never do — and allowing them there means `#foo bar baz` keeps matching forever, so the list can
     * never close on its own. Defaults to `false`.
     */
    allowSpaces?: boolean;
    /** Creates the list, once per editor. */
    list( editor: Editor ): MentionHostedList;
    /**
     * Whether the item the list commits can still be committed, checked before the trigger text is
     * removed. Returning `false` leaves the document as it is, so the user keeps what they typed.
     * Feeds that omit it always commit.
     *
     * The `/` palette needs it: an entry's command can lose `isEnabled` between the keystroke that
     * listed it and the Enter that commits it, and since committing first deletes the `/query`, an
     * unchecked no-op would eat the input.
     */
    canCommit?: ( editor: Editor, item: MentionFeedObjectItem ) => boolean;
    /**
     * What to do with the item the list commits, called with the trigger text (the marker and the
     * query) already removed and the selection collapsed in its place.
     *
     * Feeds that omit it fall back to `editor.execute( "mention", … )`, which is what the `@`, `#` and
     * `~` feeds rely on. Feeds that insert something other than a mention — an emoji, a heading —
     * provide it instead of piggy-backing on the `mention` command, so they neither depend on nor
     * have to work around `CustomMentionCommand`.
     */
    commit?: ( editor: Editor, item: MentionFeedObjectItem ) => void;
}

/** What a {@link MentionHostedList} is shown for, each time the query changes. */
export interface MentionHostedListState {
    /** The text typed after the marker, up to the caret. */
    query: string;
    /** Where the caret ends the query, in viewport coordinates. */
    caretRect(): DOMRect;
    /**
     * The editable element the caret is in. A list anchored at {@link caretRect} watches the
     * containers around it, so the list follows the caret as they scroll.
     */
    editable: HTMLElement | null;
    /**
     * Replaces the marker and the query with a mention of `item`, or hands `item` to the feed's
     * `commit`, as a pick from the list does. For a promise, the text stays until it settles, and
     * stays for good where it settles on `undefined`.
     */
    commit( item: MentionFeedObjectItem | Promise<MentionFeedObjectItem | undefined> ): void;
    /**
     * Points the editable at the list's highlighted entry through `aria-activedescendant`, by the
     * id of the entry's element, or at none for `null`. Once the list closes, it points at none.
     */
    setActiveDescendant( id: string | null ): void;
}

/** A host's list for a marker in `mention.hostedFeeds`. */
export interface MentionHostedList {
    show( state: MentionHostedListState ): void;
    hide(): void;
    /**
     * Handles a key pressed in the editor while the list is open, other than Escape, which closes it.
     * Returns whether the list took the key, which then reaches the editor no further.
     */
    handleKeyDown( event: KeyboardEvent ): boolean;
    /** The list's element while it shows entries, inside which a press does not close it. */
    readonly element: HTMLElement | null;
    destroy?(): void;
}
