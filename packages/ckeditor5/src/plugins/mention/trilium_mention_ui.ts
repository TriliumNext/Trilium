import "../../theme/mention.css";

import {
    clickOutsideHandler,
    DomEmitterMixin,
    keyCodes,
    type Marker,
    type MentionFeedObjectItem,
    type ModelElement,
    ModelLivePosition,
    ModelLiveRange,
    type ModelPosition,
    type ModelRange,
    Plugin,
    Rect,
    TextWatcher,
    type ViewDocumentKeyDownEvent
} from "ckeditor5";

import { createMarkerPattern, findMarkerMatch, type MarkerMatch } from "./marker_pattern.js";
import type { MentionHostedFeed, MentionHostedList } from "./types.js";

const MARKER_NAME = "mention";
/** The marker on the mention that the open list follows up on, which the editing view marks. */
const FOLLOW_UP_MARKER_NAME = "mentionFollowUp";

/** A marker of `mention.hostedFeeds` with its compiled trigger pattern and the host's list. */
type Pattern = MentionHostedFeed & { pattern: RegExp; hostedList: MentionHostedList };

/** A mention committed with `commitAndFollowUp()`, and the list that follows up on it. */
interface FollowUp {
    feed: Pattern;
    item: MentionFeedObjectItem;
    /** The position before the mention, set before the `mention` command inserts it. */
    start: ModelLivePosition;
    /** The mention in the document, or `null` until the `mention` command inserts it. */
    mention: ModelElement | null;
}

/** The text before the caret, as the query of the list that follows up on a mention. */
interface FollowUpMatch {
    followUp: FollowUp;
    /** The mention found in the document, or `null` while it is still to be inserted. */
    mention: ModelElement | null;
    query: string;
}

/**
 * A replacement for CKEditor's `MentionUI` that finds the markers typed in the editor and runs the
 * host's list for each: it reports the query, forwards the keys while the list is open and commits
 * what the list picks. What a list shows and how it draws it are the host's (`mention.hostedFeeds`).
 *
 * It also fixes three behaviours of upstream's, which we can neither configure nor subclass around,
 * since every interesting member of `MentionUI` is `private`:
 *
 * 1. **Escape actually dismisses.** Upstream's Escape handler only removes the model marker, but its
 *    `TextWatcher` re-evaluates the text on the very next keystroke, the pattern still matches, and
 *    the list reopens. Trilium worked around that by *inserting a ` ` en-space* into the document
 *    so the (also patched) pattern could no longer match — which corrupts data: the attribute lexer
 *    treats only U+0020 as a separator, so `#foo<en-space> #bar` fails to parse and the attribute
 *    list becomes unsaveable. Here dismissal is state ({@link #_dismissedAt}), not a document edit.
 * 2. **The list opens on typing only.** `TextWatcher` fires `matched:selection` on any direct caret
 *    move, and upstream listens to plain `matched`, so merely *clicking* into an existing `#myLabel`
 *    reopens the list — and since it also pre-selects the first item, the Enter meant to save the
 *    attributes commits a suggestion instead.
 * 3. **A stale query closes the list.** See {@link createMarkerPattern}.
 *
 * A list can also follow up on a mention it commits with `commitAndFollowUp()`. It then stays open
 * for the text typed after the mention, until it commits again or is dismissed, the caret leaves
 * that text, a space is typed right after the mention, or Backspace is pressed there. Meanwhile
 * the editing view gives the mention the class `ck-mention-follow-up`.
 *
 * The `mention` model attribute, its post-fixers and the `mention` command are reused from upstream
 * unchanged. Pair this plugin with `MentionEditing` rather than the `Mention` façade, which pulls in
 * `MentionUI` too.
 */
export default class TriliumMentionUI extends Plugin {

    /** The markers whose list the host runs, from `mention.hostedFeeds`. */
    private _feeds: Pattern[] = [];
    /** The marker whose list is open, or `null`. */
    private _open: Pattern | null = null;
    /** The mention that the open list follows up on, or `null`. */
    private _followUp: FollowUp | null = null;
    /** The id the editable's `aria-activedescendant` holds, or `null` while it holds none. */
    private _activeDescendant: string | null = null;
    /** Listens for presses outside the open list, which close it. */
    private readonly _domEmitter = new (DomEmitterMixin())();

    /**
     * Where the marker of the list the user dismissed with Escape sits, or `null` when nothing is
     * dismissed. Live, so it follows edits and lands in the graveyard if the marker is deleted.
     */
    private _dismissedAt: ModelLivePosition | null = null;

    static get pluginName() {
        return "TriliumMentionUI" as const;
    }

    /** Whether a list shows entries, which take the arrow keys. */
    get isListShown() {
        return !!this._open?.hostedList.element;
    }

    /** Closes the open list as Escape does. Returns whether a list was open. */
    dismiss(): boolean {
        if (!this.isListShown) {
            return false;
        }
        this._dismiss();
        return true;
    }

    init() {
        const editor = this.editor;

        this._feeds = (editor.config.get("mention.hostedFeeds") ?? []).map((feed) => ({
            ...feed,
            pattern: createMarkerPattern(feed.marker, feed),
            hostedList: feed.list(editor)
        }));

        editor.editing.view.document.on<ViewDocumentKeyDownEvent>("keydown", (evt, data) => {
            if (this._open && this._handleKeyDown(this._open.hostedList, data.keyCode, data.domEvent)) {
                data.preventDefault();
                evt.stop(); // Required to override the Enter key.
            }
        }, { priority: "highest" });

        clickOutsideHandler({
            emitter: this._domEmitter,
            activator: () => this.isListShown,
            contextElements: () => {
                const element = this._open?.hostedList.element;
                return element
                    ? [ element ]
                    : /* v8 ignore next -- called only while `isListShown` is true */ [];
            },
            callback: () => this._hide()
        });

        editor.conversion.for("editingDowncast").markerToHighlight({
            model: FOLLOW_UP_MARKER_NAME,
            view: { classes: "ck-mention-follow-up" }
        });

        this._setupTextWatcher();
        this.listenTo(editor, "change:isReadOnly", () => this._hide());
    }

    override destroy() {
        super.destroy();

        this._clearDismissal();
        this._followUp?.start.detach();
        this._followUp = null;
        this._domEmitter.stopListening();
        for (const { hostedList } of this._feeds) {
            hostedList.destroy?.();
        }
    }

    /**
     * Hands a key to the open list, and returns whether it took it. Escape is handled here whatever
     * the host does, so that the dismissal is remembered.
     */
    private _handleKeyDown(list: MentionHostedList, keyCode: number, event: KeyboardEvent): boolean {
        // Backspace right after the mention ends its follow-up, and the mention stays.
        if (keyCode === keyCodes.backspace && this._isCaretAfterFollowedMention()) {
            this._hide();
            return true;
        }

        if (keyCode !== keyCodes.esc) {
            return list.handleKeyDown(event);
        }

        if (!list.element) {
            return false;
        }

        this._dismiss();
        return true;
    }

    /** Whether the caret is right after the mention that the open list follows up on. */
    private _isCaretAfterFollowedMention(): boolean {
        const mention = this._followUp?.mention;
        const { focus } = this.editor.model.document.selection;

        return !!mention && !!focus && focus.nodeBefore === mention;
    }

    /**
     * Hides the list and remembers that the user rejected *this* marker, so it does not immediately
     * reopen on the next keystroke. No document mutation is involved. A follow-up ends for good,
     * so its dismissal is not remembered.
     */
    private _dismiss() {
        const start = this._followUp
            ? undefined
            : this.editor.model.markers.get(MARKER_NAME)?.getStart();

        this._hide();

        if (start) {
            this._clearDismissal();
            this._dismissedAt = ModelLivePosition.fromPosition(start, "toPrevious");
        }
    }

    private _clearDismissal() {
        this._dismissedAt?.detach();
        this._dismissedAt = null;
    }

    /**
     * Whether `markerStart` is the marker the user already dismissed. A dismissal whose text has
     * since been deleted (its live position landed in the graveyard) is discarded, so retyping the
     * same marker opens the list again.
     */
    private _isDismissed(markerStart: ModelPosition): boolean {
        if (!this._dismissedAt) {
            return false;
        }

        if (this._dismissedAt.root.rootName === "$graveyard") {
            this._clearDismissal();
            return false;
        }

        return this._dismissedAt.toPosition().isEqual(markerStart);
    }

    private _setupTextWatcher() {
        const editor = this.editor;

        // Returning the match object makes `TextWatcher` merge it into the event data, so the
        // handler does not have to re-derive the block text and re-run the patterns. The text
        // typed after a mention that the list follows up on is its query, whatever markers it has.
        const watcher = new TextWatcher(editor.model, (text) =>
            this._matchFollowUp(text) ?? findMarkerMatch(this._feeds, text) ?? false);

        // Only typing opens the list. `matched:selection` fires on any direct caret move — a click
        // or an arrow key — and reopening there is the "clicking always triggers an autocomplete"
        // bug; a caret move closes the list, which is anchored to a marker the user has just
        // navigated away from.
        watcher.on<TriliumMatchedEvent>("matched:data", (evt, data) => {
            if ("followUp" in data) {
                this._onFollowUpTyped(data);
            } else {
                this._onTyped(data);
            }
        });
        watcher.on("matched:selection", () => this._hide());
        watcher.on("unmatched", () => {
            this._clearDismissal();
            this._hide();
        });

        const command = editor.commands.get("mention");
        if (command) {
            watcher.bind("isEnabled").to(command);
        }
    }

    private _onTyped({ feed, query }: MarkerMatch<Pattern>) {
        const model = this.editor.model;
        const focus = model.document.selection.focus;

        /* v8 ignore next 3 -- the document selection of a live editor always has a focus; the guard only narrows the type for the `getShiftedBy()` calls below */
        if (!focus) {
            return;
        }

        const start = focus.getShiftedBy(-(feed.marker.length + query.length));
        const end = focus.getShiftedBy(-query.length);

        // Never re-trigger inside an existing mention — mirrors upstream's `isPositionInExistingMention`.
        if (isInExistingMention(focus) || isBeforeExistingMention(start)) {
            this._hide();
            return;
        }

        if (this._isDismissed(start)) {
            return;
        }

        // A marker typed where the follow-up no longer applies opens its own list.
        this._endFollowUp();
        this._setMarker(MARKER_NAME, model.createRange(start, end));
        this._show(feed, query);
    }

    /**
     * Matches `text`, the text before the caret, against the follow-up. Returns the query typed
     * after the mention, with no mention while the `mention` command has yet to insert it, and
     * `null` once the caret is elsewhere, the mention is gone or a space follows it.
     */
    private _matchFollowUp(text: string): FollowUpMatch | null {
        const followUp = this._followUp;
        const { focus } = this.editor.model.document.selection;

        if (!followUp || !focus) {
            return null;
        }

        // While the mention is awaited, the node after the caret is whatever followed the marker.
        if (!followUp.mention && focus.isEqual(followUp.start)) {
            return { followUp, mention: null, query: "" };
        }

        const mention = followUp.start.nodeAfter;

        if (!mention?.is("element") || !this.editor.model.schema.isObject(mention)) {
            return null;
        }

        const queryStart = this.editor.model.createPositionAfter(mention);
        const isQuery = focus.getShiftedBy(-text.length).isEqual(queryStart) && !/^\s/.test(text);

        return isQuery ? { followUp, mention, query: text } : null;
    }

    /** Shows the list that follows up on a mention, for the text typed after the mention. */
    private _onFollowUpTyped({ followUp, mention, query }: FollowUpMatch) {
        if (!mention) {
            return;
        }

        if (followUp.mention !== mention) {
            // A commit replaces everything from the marker up to the caret, so the mention too.
            const range = this.editor.model.createRangeOn(mention);

            followUp.mention = mention;
            this._setMarker(MARKER_NAME, range);
            this._setMarker(FOLLOW_UP_MARKER_NAME, range);
        }

        this._show(followUp.feed, query);
    }

    /** Puts the marker `name`, which is in neither the data nor the undo steps, on `range`. */
    private _setMarker(name: string, range: ModelRange) {
        const model = this.editor.model;

        model.change((writer) => {
            if (model.markers.has(name)) {
                writer.updateMarker(name, { range });
            } else {
                writer.addMarker(name, { range, usingOperation: false, affectsData: false });
            }
        });
    }

    /** Shows the host's list of `feed` for `query`, in place of any other list. */
    private _show(feed: Pattern, query: string) {
        const marker = this.editor.model.markers.get(MARKER_NAME);

        /* v8 ignore next 3 -- the callers set the marker first; the guard only narrows its type */
        if (!marker) {
            return;
        }

        if (this._open !== feed) {
            this._hideList();
        }

        const followUp = this._followUp;
        const mention = followUp?.mention ?? null;

        this._open = feed;
        feed.hostedList.show({
            query,
            followUpOf: followUp?.item ?? null,
            caretRect: () => {
                const { left, top, width, height } = this._anchorRect(marker, mention);
                return new DOMRect(left, top, width, height);
            },
            /* v8 ignore next -- a live editor's editing view always has its DOM root, so the `?? null` arm never runs */
            editable: this.editor.editing.view.getDomRoot() ?? null,
            commit: (item) => this._commit(feed, item),
            commitAndFollowUp: (item) => this._commit(feed, item, item),
            dismiss: () => {
                if (this._open === feed) {
                    this._dismiss();
                }
            },
            setActiveDescendant: (id) => {
                if (this._open === feed) {
                    this._setActiveDescendant(id);
                }
            }
        });
    }

    private _hide() {
        this._hideList();
        this._endFollowUp();

        if (this.editor.model.markers.has(MARKER_NAME)) {
            this.editor.model.change((writer) => writer.removeMarker(MARKER_NAME));
        }
    }

    /** Ends the follow-up on a mention, which loses its mark, and leaves the list open. */
    private _endFollowUp() {
        const model = this.editor.model;

        this._followUp?.start.detach();
        this._followUp = null;

        if (model.markers.has(FOLLOW_UP_MARKER_NAME)) {
            model.change((writer) => writer.removeMarker(FOLLOW_UP_MARKER_NAME));
        }
    }

    /** Hides the open list, and leaves the marker. */
    private _hideList() {
        const open = this._open;
        this._open = null;
        this._setActiveDescendant(null);
        open?.hostedList.hide();
    }

    /** Sets the root editable's `aria-activedescendant` through the view, whose renderer owns its attributes. */
    private _setActiveDescendant(id: string | null) {
        if (id === this._activeDescendant) {
            return;
        }

        const view = this.editor.editing.view;
        const root = view.document.getRoot();

        /* v8 ignore next 3 -- a live editor's editing view always has its root, so the guard only narrows its type */
        if (!root) {
            return;
        }

        this._activeDescendant = id;
        view.change((writer) => {
            if (id) {
                writer.setAttribute("aria-activedescendant", id, root);
            } else {
                writer.removeAttribute("aria-activedescendant", root);
            }
        });
    }

    /**
     * Replaces the trigger text with a mention of `item`, or hands `item` to the feed's `commit`.
     * For a promise, the text stays where it is, followed by a live range, until it settles. With
     * `followUpOf`, which is `item`, the list stays open to follow up on the mention.
     */
    private _commit(
        feed: Pattern, item: MentionFeedObjectItem | Promise<MentionFeedObjectItem | undefined>,
        followUpOf?: MentionFeedObjectItem
    ) {
        const editor = this.editor;
        const model = editor.model;
        const marker = model.markers.get(MARKER_NAME);
        const focus = model.document.selection.focus;

        // A pick arriving after the list closed, such as a click racing a caret move, or before
        // the mention that the list follows up on is in the document.
        if (!marker || !focus || (this._followUp && !this._followUp.mention)) {
            return;
        }

        // Everything from the marker up to the caret, not just the marker itself.
        const range = ModelLiveRange.fromRange(model.createRange(marker.getStart(), focus));

        if (followUpOf) {
            this._endFollowUp();
            this._followUp = {
                feed,
                item: followUpOf,
                start: ModelLivePosition.fromPosition(range.start, "toPrevious"),
                mention: null
            };
        } else {
            this._hide();
        }
        this._clearDismissal();

        const insert = (mention: MentionFeedObjectItem | undefined) => {
            // The text can have been deleted while a promise was pending. An item gone stale while
            // the list was open, such as a `/` command that lost `isEnabled`, keeps the text, which
            // committing it would delete for nothing.
            if (mention && range.root.rootName !== "$graveyard" && (feed.canCommit?.(editor, mention) ?? true)) {
                if (feed.commit) {
                    // The text goes first, so the callback sees a collapsed selection where the query
                    // was, and the callback runs outside the change block, as some open a balloon
                    // (`/math`, `/anchor`) that needs a settled view. The focus returns before the
                    // callback, which can open a UI that takes it.
                    const target = range.toRange();
                    model.change((writer) => model.deleteContent(writer.createSelection(target)));
                    editor.editing.view.focus();
                    feed.commit(editor, mention);
                } else {
                    editor.execute("mention", { mention, text: mention.text, marker: feed.marker, range: range.toRange() });
                    editor.editing.view.focus();
                }
            } else if (followUpOf) {
                // The list has no mention to follow up on.
                this._hide();
            }
            range.detach();
        };

        if (item instanceof Promise) {
            void item.then(insert, () => range.detach());
        } else {
            insert(item);
        }
    }

    /**
     * The rect the list is placed against: `mention`, which it follows up on, or else the end of
     * the marker, or of the selection once the marker is gone.
     */
    private _anchorRect(marker: Marker, mention: ModelElement | null): Rect {
        const editing = this.editor.editing;
        const viewElement = mention && editing.mapper.toViewElement(mention);
        const domElement = viewElement && editing.view.domConverter.mapViewToDom(viewElement);

        if (domElement) {
            return new Rect(domElement);
        }

        let range = marker.getRange();

        // The marker can already be gone; fall back to the selection, so the list can still be
        // placed here.
        if (range.start.root.rootName === "$graveyard") {
            /* v8 ignore next -- the document selection always holds at least one range, so the `?? range` arm never runs */
            range = this.editor.model.document.selection.getFirstRange() ?? range;
        }

        const viewRange = editing.mapper.toViewRange(range);
        const rects = Rect.getDomRangeRects(editing.view.domConverter.viewRangeToDom(viewRange));

        return rects[rects.length - 1];
    }
}

type TriliumMatchedEvent = {
    name: "matched:data";
    args: [ (MarkerMatch<Pattern> | FollowUpMatch) & { text: string } ];
};

function isInExistingMention(position: ModelPosition): boolean {
    // The text watcher runs before selection attributes are refreshed, so `selection.hasAttribute`
    // is not usable here — see ckeditor5-engine#1723.
    if (position.textNode?.hasAttribute("mention")) {
        return true;
    }

    const before = position.nodeBefore;
    return !!before && before.is("$text") && before.hasAttribute("mention");
}

function isBeforeExistingMention(markerPosition: ModelPosition): boolean {
    const after = markerPosition.nodeAfter;
    return !!after && after.is("$text") && after.hasAttribute("mention");
}
