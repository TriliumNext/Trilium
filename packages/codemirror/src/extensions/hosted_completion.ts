import { type EditorState, type Extension, Prec } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

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

/** What a {@link HostedCompletionList} is shown for, each time the text before the caret changes. */
export interface HostedCompletionState<M extends HostedCompletionMatch> {
    match: M;
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
 */
export function hostedCompletion<M extends HostedCompletionMatch>({ match, list }: HostedCompletionConfig<M>): Extension {
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
        private destroyed = false;

        constructor(private readonly view: EditorView) {
            this.list = list(view);
        }

        update(update: ViewUpdate) {
            if (update.docChanged && this.dismissedAt >= 0) {
                // With `assoc` 1, so text inserted right before the match leaves it on the match.
                this.dismissedAt = update.changes.mapPos(this.dismissedAt, 1);
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
                this.sync();
            }
        }

        handleKeyDown(event: KeyboardEvent) {
            if (event.isComposing) {
                return false;
            }

            if (isExplicitRequest(event)) {
                this.explicit = true;
                this.dismissedAt = -1;
                this.from = -1;
                this.sync();
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

                this.dismissedAt = this.from;
                this.close();
            } else if (!this.list.handleKeyDown(event)) {
                return false;
            }

            event.preventDefault();
            return true;
        }

        destroy() {
            this.destroyed = true;
            this.setActiveDescendant(null);
            this.list.hide();
            this.list.destroy?.();
        }

        private sync() {
            const found = this.view.hasFocus ? matchAt(this.view.state, match, this.explicit) : null;
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
                        caretRect: () => (showing ? measured : caretRect(this.view)),
                        editable: this.view.dom,
                        commit: (insert) => this.commit(found.from, insert),
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

        private commit(from: number, insert: HostedCompletionInsert | Promise<HostedCompletionInsert | undefined>) {
            if (this.from !== from) {
                return;
            }

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
        eventHandlers: {
            keydown(event) {
                return this.handleKeyDown(event);
            }
        }
    });

    // Ahead of the field's keymap, so the list takes Enter and the arrows while it is open.
    return Prec.highest(plugin);
}

/** Ctrl-Space, or Alt-` as CodeMirror binds it on a Mac, where Ctrl-Space switches the input source. */
function isExplicitRequest(event: KeyboardEvent) {
    return (event.ctrlKey && event.key === " ") || (event.altKey && event.key === "`");
}

/** What `match` finds before the caret, with where it starts in the document. */
function matchAt<M extends HostedCompletionMatch>(state: EditorState, match: HostedCompletionConfig<M>["match"], explicit: boolean) {
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
