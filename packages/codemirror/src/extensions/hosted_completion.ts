import { type EditorState, type Extension, Prec } from "@codemirror/state";
import {
    Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType
} from "@codemirror/view";

/** What {@link HostedCompletionConfig.match} finds before the caret. */
export interface HostedCompletionMatch {
    /** Where the text a pick replaces starts, as an offset into the text before the caret. */
    from: number;
}

/**
 * What a pick does in place of inserting text: changes the document between `from`, where the match
 * starts, and `to`, the caret, or runs something else, as a command does.
 */
export type HostedCompletionApply = (view: EditorView, from: number, to: number) => void;

/** What a pick puts in place of the match: text, or what an {@link HostedCompletionApply} does. */
export type HostedCompletionInsert = string | HostedCompletionApply;

/** The text inserted with `commitAndFollowUp()`, as the list that follows up on it gets it. */
export interface HostedCompletionFollowUp {
    /** The value passed to `commitAndFollowUp()`. */
    of: string;
    /** The text typed after the inserted text, up to the caret. */
    query: string;
}

/** What a {@link HostedCompletionList} is shown for, each time the text before the caret changes. */
export interface HostedCompletionState<M extends HostedCompletionMatch> {
    /** The match the list completes. During a follow-up, the match that the inserted text replaced. */
    match: M;
    /** The follow-up on the text that `commitAndFollowUp()` inserted, or `null`. */
    followUp: HostedCompletionFollowUp | null;
    /** Where the caret is, in viewport coordinates. */
    caretRect(): DOMRect;
    /** The editor's element. A list anchored at {@link caretRect} watches the containers around it. */
    editable: HTMLElement;
    /**
     * Replaces what stands between the match's `from` and the caret with `insert`, as a pick does,
     * or runs `insert` on that range. For a promise, the list closes and the text stays until it
     * settles on either, past the editor losing the focus, and stays for good where it settles on
     * `undefined`. An edit that reaches the text meanwhile, such as the editor taking another note's
     * content, gives the commit up.
     */
    commit(insert: HostedCompletionInsert | Promise<HostedCompletionInsert | undefined>): void;
    /**
     * Commits `insert` as `commit()` does, and keeps the list open for the text it inserted: from
     * the start of the match to where the commit leaves the caret. The list is shown again with
     * `followUp` for the text typed after it. The follow-up ends on the next commit, on a
     * dismissal, when a space is typed right after the inserted text, on Backspace there, and when
     * the caret leaves. A commit during the follow-up replaces the inserted text and the text
     * typed after it.
     */
    commitAndFollowUp(insert: HostedCompletionInsert, of: string): void;
    /** Closes the list, as Escape does. */
    dismiss(): void;
    /**
     * Points the editor at the list's highlighted entry through `aria-activedescendant`, by the id
     * of the entry's element, or at none for `null`. Once the list closes, it points at none.
     */
    setActiveDescendant(id: string | null): void;
}

/** A host's list for {@link hostedCompletion}. */
export interface HostedCompletionList<M extends HostedCompletionMatch> {
    show(state: HostedCompletionState<M>): void;
    hide(): void;
    /**
     * Handles a key pressed in the editor while the list is open, other than Escape, which closes it.
     * Returns whether the list took the key, which then reaches the editor no further.
     */
    handleKeyDown(event: KeyboardEvent): boolean;
    /** The list's element while it shows entries. Escape closes the list only then. */
    readonly element: HTMLElement | null;
    destroy?(): void;
}

export interface HostedCompletionConfig<M extends HostedCompletionMatch> {
    /**
     * What can be completed at the caret, read from the text of the line before it, or `null` where
     * nothing can. `explicit` is set after Ctrl-Space, which asks for completions where typing alone
     * offers none. `state` is there for what the text alone does not tell, such as the syntax tree.
     */
    match(before: string, explicit: boolean, state: EditorState): M | null;
    /**
     * Whether moving the caret onto a match opens the list, as typing does. `true` by default. A host
     * whose matches are everywhere, such as any identifier in code, passes `false`: a caret move then
     * only keeps an open list while the caret stays on its match.
     */
    opensOnCaretMove?: boolean;
    /** Creates the list, once per editor. */
    list(view: EditorView): HostedCompletionList<M>;
}

/**
 * Hands what can be completed at the caret to a list the host runs entirely: what it lists, how it
 * draws it, which entry is highlighted and what a pick inserts. The editor keeps the focus, forwards
 * its keys to the list while it is open and puts what the list commits in place of the text the
 * match covers. A commit is read again like typing, so a pick that leaves something to complete,
 * such as `note.`, opens the list on what follows it.
 *
 * The counterpart of CKEditor's `mention.hostedFeeds`, so that a host can serve both editors with
 * the same lists. The list closes when nothing matches, when the editor loses the focus, and on
 * Escape, after which it stays closed for that match.
 *
 * A list can also follow up on what it commits, as `commitAndFollowUp()` describes.
 */
export function hostedCompletion<M extends HostedCompletionMatch>({ match, opensOnCaretMove = true, list }: HostedCompletionConfig<M>): Extension {
    const plugin = ViewPlugin.fromClass(class {
        private readonly list: HostedCompletionList<M>;
        /** Where the open list's match starts in the document, or `-1` while it is closed. */
        private from = -1;
        /** The text before the caret the open list was shown for. */
        private before = "";
        /** Asked for with Ctrl-Space, until the list closes. */
        private explicit = false;
        /** Where the match Escape closed the list on starts, which keeps it closed. */
        private dismissedAt = -1;
        /** The text that commits waiting on a promise replace, mapped through the edits since. */
        private readonly pending = new Set<{ from: number; to: number }>();
        /** The text that `commitAndFollowUp()` inserted, or `null`. */
        private followUp: FollowUp<M> | null = null;
        private destroyed = false;
        /** The mark after the text of the follow-up. */
        decorations: DecorationSet = Decoration.none;

        constructor(private readonly view: EditorView) {
            this.list = list(view);
            const lists = hostedLists.get(view) ?? new Set();
            lists.add(this.list);
            hostedLists.set(view, lists);
        }

        update(update: ViewUpdate) {
            if (update.docChanged && this.dismissedAt >= 0) {
                // With `assoc` 1, so text inserted right before the match leaves it on the match.
                this.dismissedAt = update.changes.mapPos(this.dismissedAt, 1);
            }
            if (update.docChanged && this.followUp) {
                this.mapFollowUp(this.followUp, update);
            }
            if (update.docChanged) {
                for (const range of this.pending) {
                    if (update.changes.touchesRange(range.from, range.to)) {
                        this.pending.delete(range);
                    } else {
                        range.from = update.changes.mapPos(range.from);
                        range.to = update.changes.mapPos(range.to);
                    }
                }
            }

            if (update.docChanged || update.selectionSet || update.focusChanged) {
                this.sync(update.docChanged);
            }

            const followUp = this.followUp;
            this.decorations = followUp && followUp.to >= 0
                ? Decoration.set(followUpMark.range(followUp.to))
                : Decoration.none;
        }

        handleKeyDown(event: KeyboardEvent) {
            if (event.isComposing) {
                return false;
            }

            if (isExplicitRequest(event)) {
                this.explicit = true;
                this.dismissedAt = -1;
                this.from = -1;
                this.sync(true);
                // Nothing to complete here, so the key goes on to the editor's own completion.
                if (this.from < 0) {
                    return false;
                }
            } else if (this.from < 0) {
                return false;
            } else if (event.key === "Escape") {
                // A list showing nothing leaves Escape to the field.
                if (!this.list.element) {
                    return false;
                }

                this.dismiss();
            } else if (event.key === "Backspace" && this.isCaretAfterFollowUp()) {
                // Ends the follow-up and keeps the inserted text.
                this.close();
                this.endFollowUp();
            } else if (!this.list.handleKeyDown(event)) {
                return false;
            }

            event.preventDefault();
            return true;
        }

        destroy() {
            this.destroyed = true;
            hostedLists.get(this.view)?.delete(this.list);
            this.setActiveDescendant(null);
            this.list.hide();
            this.list.destroy?.();
        }

        /** `typed`: the document changed, as typing or a commit does, rather than only the caret. */
        private sync(typed: boolean) {
            const followUpMatch = this.view.hasFocus ? this.matchFollowUp() : null;
            if (!followUpMatch) {
                this.followUp = null;
            }

            const found = followUpMatch
                ?? (this.view.hasFocus ? matchAt(this.view.state, match, this.explicit) : null);
            if (found?.from !== this.dismissedAt) {
                this.dismissedAt = -1;
            }

            // A match a commit waits on stays closed too, until the commit replaces it.
            const waiting = found && [ ...this.pending ].some((range) => range.from === found.from);
            if (!found || this.dismissedAt >= 0 || waiting) {
                this.close();
                return;
            }

            if (found.from === this.from && found.before === this.before) {
                return;
            }
            if (!typed && !opensOnCaretMove && found.from !== this.from) {
                this.close();
                return;
            }

            this.from = found.from;
            this.before = found.before;
            // Shown in a measure, as the list reads the caret's place, which CodeMirror allows only in
            // `read`. While `show` runs, `caretRect()` answers what `read` measured.
            this.view.requestMeasure({
                read: () => caretRect(this.view),
                write: (measured) => {
                    // A later update has replaced or closed the list meanwhile.
                    if (this.from !== found.from || this.before !== found.before) return;

                    let showing = true;
                    this.list.show({
                        match: found.match,
                        followUp: found.followUp ?? null,
                        caretRect: () => (showing ? measured : caretRect(this.view)),
                        editable: this.view.dom,
                        commit: (insert) => this.commit(found.from, insert),
                        commitAndFollowUp: (insert, of) => this.commitAndFollowUp(found, insert, of),
                        dismiss: () => {
                            if (this.from === found.from) {
                                this.dismiss();
                            }
                        },
                        setActiveDescendant: (id) => {
                            if (this.from === found.from) {
                                this.setActiveDescendant(id);
                            }
                        }
                    });
                    showing = false;
                }
            });
        }

        private commit(
            from: number, insert: HostedCompletionInsert | Promise<HostedCompletionInsert | undefined>,
            followUp: FollowUp<M> | null = null
        ) {
            if (this.from !== from) {
                return;
            }

            this.followUp = followUp;
            this.explicit = false;
            if (typeof insert === "function") {
                insert(this.view, from, this.view.state.selection.main.head);
                return;
            }
            if (insert instanceof Promise) {
                void this.commitWhenSettled(from, insert);
                return;
            }

            const text = insert;
            this.view.dispatch({
                changes: { from, to: this.view.state.selection.main.head, insert: text },
                selection: { anchor: from + text.length },
                userEvent: "input.complete"
            });
        }

        /** Commits `insert` and follows up on the text it inserts. */
        private commitAndFollowUp(found: Found<M>, insert: HostedCompletionInsert, of: string) {
            const followUp: FollowUp<M> = {
                of, match: found.match, from: found.from, to: -1, end: -1, text: ""
            };
            this.commit(found.from, insert, followUp);

            // The commit inserted nothing.
            if (this.followUp === followUp && followUp.to < 0) {
                this.followUp = null;
            }
        }

        /**
         * Maps the text of `followUp` through the changes of `update`. The first change after
         * `commitAndFollowUp()` is the commit, which inserted the text up to the caret.
         */
        private mapFollowUp(followUp: FollowUp<M>, update: ViewUpdate) {
            if (followUp.to < 0) {
                followUp.to = update.state.selection.main.head;
                followUp.end = followUp.to;
                followUp.text = update.state.sliceDoc(followUp.from, followUp.to);
                return;
            }

            // Text typed on either side of it stays out of it, and text typed at `end` extends it.
            followUp.from = update.changes.mapPos(followUp.from, 1);
            followUp.to = update.changes.mapPos(followUp.to, -1);
            followUp.end = update.changes.mapPos(followUp.end, 1);
        }

        /**
         * The text typed after the text of the follow-up as a match, or `null` once the caret is
         * outside the text typed, that text changed or a space follows it.
         */
        private matchFollowUp(): Found<M> | null {
            const followUp = this.followUp;
            const { state } = this.view;
            const { main } = state.selection;
            if (!followUp || followUp.to < 0 || !main.empty || main.head < followUp.to
                || main.head > followUp.end
                || state.sliceDoc(followUp.from, followUp.to) !== followUp.text) {
                return null;
            }

            const query = state.sliceDoc(followUp.to, main.head);
            if (/^\s|\n/.test(query)) {
                return null;
            }

            const line = state.doc.lineAt(main.head);
            return {
                match: followUp.match,
                from: followUp.from,
                before: line.text.slice(0, main.head - line.from),
                followUp: { of: followUp.of, query }
            };
        }

        private isCaretAfterFollowUp() {
            const { main } = this.view.state.selection;
            return !!this.followUp && main.empty && main.head === this.followUp.to;
        }

        /** Closes the list, which stays closed on its match. A follow-up ends for good instead. */
        private dismiss() {
            this.dismissedAt = this.followUp ? -1 : this.from;
            this.close();
            this.endFollowUp();
        }

        /** Ends the follow-up outside an update, and redraws the decorations without its mark. */
        private endFollowUp() {
            if (!this.followUp) {
                return;
            }

            this.followUp = null;
            this.view.dispatch({});
        }

        /** Closes the list, which stays closed on the match, and replaces the match once `insert` settles. */
        private async commitWhenSettled(from: number, insert: Promise<HostedCompletionInsert | undefined>) {
            const range = { from, to: this.view.state.selection.main.head };
            this.pending.add(range);
            this.close();

            const settled = await insert.catch(() => undefined);
            // `update()` drops the range of a commit an edit gave up meanwhile.
            const stillWaiting = this.pending.delete(range);
            if (settled === undefined || !stillWaiting || this.destroyed) {
                return;
            }
            if (typeof settled === "function") {
                settled(this.view, range.from, range.to);
                return;
            }

            const text = settled;
            this.view.dispatch({
                changes: { from: range.from, to: range.to, insert: text },
                selection: { anchor: range.from + text.length },
                userEvent: "input.complete"
            });
        }

        private close() {
            this.explicit = false;
            if (this.from < 0) {
                return;
            }

            this.from = -1;
            this.before = "";
            this.setActiveDescendant(null);
            this.list.hide();
        }

        /** Set on `contentDOM` directly: CodeMirror removes only the attributes it set itself. */
        private setActiveDescendant(id: string | null) {
            if (id) {
                this.view.contentDOM.setAttribute("aria-activedescendant", id);
            } else {
                this.view.contentDOM.removeAttribute("aria-activedescendant");
            }
        }
    }, {
        decorations: (value) => value.decorations,
        eventHandlers: {
            keydown(event) {
                return this.handleKeyDown(event);
            }
        }
    });

    // Ahead of the field's keymap, so the list takes Enter and the arrows while it is open.
    return [ Prec.highest(plugin), followUpTheme ];
}

/** The `¶` drawn after the text that a list follows up on, as the text editor draws it. */
class FollowUpMarkWidget extends WidgetType {
    override toDOM() {
        const mark = document.createElement("span");
        mark.className = "cm-completion-follow-up";
        mark.setAttribute("aria-hidden", "true");
        return mark;
    }
}

const followUpMark = Decoration.widget({ widget: new FollowUpMarkWidget(), side: 1 });

const followUpTheme = EditorView.baseTheme({
    ".cm-completion-follow-up::after": {
        content: "\"\\b6\"",
        marginInlineStart: "0.25em",
        opacity: "0.5"
    }
});

/** Whether a list of {@link hostedCompletion} shows entries in `view` and takes the arrow keys. */
export function isHostedCompletionShown(view: EditorView) {
    return [ ...(hostedLists.get(view) ?? []) ].some((list) => list.element !== null);
}

const hostedLists = new WeakMap<EditorView, Set<HostedCompletionList<never>>>();

/** A match found before the caret, with where it starts in the document. */
interface Found<M extends HostedCompletionMatch> {
    match: M;
    from: number;
    /** The text before the caret on its line. */
    before: string;
    followUp?: HostedCompletionFollowUp;
}

/** The text that `commitAndFollowUp()` inserted, from `from` to `to`. */
interface FollowUp<M extends HostedCompletionMatch> {
    of: string;
    /** The match the text replaced. */
    match: M;
    from: number;
    /** `-1` until the commit inserts the text. */
    to: number;
    /** Where the text typed after `to` ends. Text that followed `to` already is not part of it. */
    end: number;
    text: string;
}

/** Ctrl-Space, or Alt-` as CodeMirror binds it on a Mac, where Ctrl-Space switches the input source. */
function isExplicitRequest(event: KeyboardEvent) {
    return (event.ctrlKey && event.key === " ") || (event.altKey && event.key === "`");
}

/** What `match` finds before the caret, with where it starts in the document. */
function matchAt<M extends HostedCompletionMatch>(
    state: EditorState, match: HostedCompletionConfig<M>["match"], explicit: boolean
): Found<M> | null {
    const { main } = state.selection;
    if (!main.empty) {
        return null;
    }

    const line = state.doc.lineAt(main.head);
    const before = line.text.slice(0, main.head - line.from);
    const found = match(before, explicit, state);

    return found && { match: found, from: line.from + found.from, before };
}

function caretRect(view: EditorView) {
    const coords = view.coordsAtPos(view.state.selection.main.head);
    if (!coords) {
        return view.contentDOM.getBoundingClientRect();
    }

    return new DOMRect(coords.left, coords.top, coords.right - coords.left, coords.bottom - coords.top);
}
