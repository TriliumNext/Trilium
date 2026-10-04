import {
    clickOutsideHandler,
    DomEmitterMixin,
    keyCodes,
    type Marker,
    type MentionFeedObjectItem,
    ModelLivePosition,
    ModelLiveRange,
    type ModelPosition,
    Plugin,
    Rect,
    TextWatcher,
    type ViewDocumentKeyDownEvent
} from "ckeditor5";

import { createMarkerPattern, findMarkerMatch, type MarkerMatch } from "./marker_pattern.js";
import type { MentionHostedFeed, MentionHostedList } from "./types.js";

const MARKER_NAME = "mention";

/** A marker of `mention.hostedFeeds` with its compiled trigger pattern and the host's list. */
type Pattern = MentionHostedFeed & { pattern: RegExp; hostedList: MentionHostedList };

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
 * The `mention` model attribute, its post-fixers and the `mention` command are reused from upstream
 * unchanged. Pair this plugin with `MentionEditing` rather than the `Mention` façade, which pulls in
 * `MentionUI` too.
 */
export default class TriliumMentionUI extends Plugin {

    /** The markers whose list the host runs, from `mention.hostedFeeds`. */
    private _feeds: Pattern[] = [];
    /** The marker whose list is open, or `null`. */
    private _open: Pattern | null = null;
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
            activator: () => !!this._open?.hostedList.element,
            /* v8 ignore next -- `clickOutsideHandler` only calls `contextElements()` once the activator reported the list showing, so its element is never null */
            contextElements: () => {
                const element = this._open?.hostedList.element;
                return element ? [ element ] : [];
            },
            callback: () => this._hide()
        });

        this._setupTextWatcher();
        this.listenTo(editor, "change:isReadOnly", () => this._hide());
    }

    override destroy() {
        super.destroy();

        this._clearDismissal();
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
        if (keyCode !== keyCodes.esc) {
            return list.handleKeyDown(event);
        }

        if (!list.element) {
            return false;
        }

        this._dismiss();
        return true;
    }

    /**
     * Hides the list and remembers that the user rejected *this* marker, so it does not immediately
     * reopen on the next keystroke. No document mutation is involved.
     */
    private _dismiss() {
        const start = this.editor.model.markers.get(MARKER_NAME)?.getStart();

        this._hide();

        /* v8 ignore next -- Escape only reaches here while the list is open, and the list and the marker always come and go together, so there is always a start */
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
        // handler does not have to re-derive the block text and re-run the patterns.
        const watcher = new TextWatcher(editor.model, (text) => findMarkerMatch(this._feeds, text) ?? false);

        // Only typing opens the list. `matched:selection` fires on any direct caret move — a click
        // or an arrow key — and reopening there is the "clicking always triggers an autocomplete"
        // bug; a caret move closes the list, which is anchored to a marker the user has just
        // navigated away from.
        watcher.on<TriliumMatchedEvent>("matched:data", (evt, data) => this._onTyped(data));
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

        const range = model.createRange(start, end);
        const existing = model.markers.get(MARKER_NAME);

        model.change((writer) => {
            if (existing) {
                writer.updateMarker(existing, { range });
            } else {
                writer.addMarker(MARKER_NAME, { range, usingOperation: false, affectsData: false });
            }
        });

        this._show(feed, query);
    }

    /** Shows the host's list of `feed` for `query`, in place of any other list. */
    private _show(feed: Pattern, query: string) {
        const marker = this.editor.model.markers.get(MARKER_NAME);

        /* v8 ignore next 3 -- `_onTyped()` sets the marker just before calling this; the guard only narrows its type */
        if (!marker) {
            return;
        }

        if (this._open !== feed) {
            this._hideList();
        }

        this._open = feed;
        feed.hostedList.show({
            query,
            caretRect: () => {
                const { left, top, width, height } = this._caretRect(marker);
                return new DOMRect(left, top, width, height);
            },
            /* v8 ignore next -- a live editor's editing view always has its DOM root, so the `?? null` arm never runs */
            editable: this.editor.editing.view.getDomRoot() ?? null,
            commit: (item) => this._commit(feed, item),
            setActiveDescendant: (id) => {
                if (this._open === feed) {
                    this._setActiveDescendant(id);
                }
            }
        });
    }

    private _hide() {
        this._hideList();

        if (this.editor.model.markers.has(MARKER_NAME)) {
            this.editor.model.change((writer) => writer.removeMarker(MARKER_NAME));
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
     * For a promise, the text stays where it is, followed by a live range, until it settles.
     */
    private _commit(feed: Pattern, item: MentionFeedObjectItem | Promise<MentionFeedObjectItem | undefined>) {
        const editor = this.editor;
        const model = editor.model;
        const marker = model.markers.get(MARKER_NAME);
        const focus = model.document.selection.focus;

        // A pick arriving after the list closed, such as a click racing a caret move.
        if (!marker || !focus) {
            return;
        }

        // Everything from the marker up to the caret, not just the marker itself.
        const range = ModelLiveRange.fromRange(model.createRange(marker.getStart(), focus));
        this._hide();
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
            }
            range.detach();
        };

        if (item instanceof Promise) {
            void item.then(insert, () => range.detach());
        } else {
            insert(item);
        }
    }

    /** The rect the list is placed against: the end of the marker, or of the selection once it is gone. */
    private _caretRect(marker: Marker): Rect {
        const editing = this.editor.editing;
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
    args: [ MarkerMatch<Pattern> & { text: string } ];
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
