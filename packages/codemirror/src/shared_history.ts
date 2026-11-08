import { isolateHistory } from "@codemirror/commands";
import { type ChangeSet, type EditorSelection, type Text, Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/** A change of a document, kept as a step of the host's undo stack. */
export interface HostHistoryStep {
    /** Reverts the change. Returns `false` when the document changed since. */
    undo(): boolean;
    /** Makes the change again. Returns `false` when the document changed since. */
    redo(): boolean;
}

/** The undo stack of the host that shows the editors, such as the text note that embeds them. */
export interface HostHistory {
    /** Adds `step` on top of the stack. `isLatest()` tells whether the step can still grow. */
    push(step: HostHistoryStep): { isLatest(): boolean };
    undo(): void;
    redo(): void;
}

interface Step {
    before: Text;
    after: Text;
    changes: ChangeSet;
    selectionBefore: EditorSelection;
    selectionAfter: EditorSelection;
}

interface OpenStep {
    step: Step;
    entry: { isLatest(): boolean };
    time: number;
}

/** The longest pause between two changes of one step, in milliseconds, as in `history()`. */
const NEW_STEP_DELAY = 500;
/** The changes that join the step before them, as in `history()`. */
const JOINABLE_EVENT = /^(input\.type|delete)($|\.)/;

/**
 * The undo history of a document, such as an embedded note, kept on the undo stack of `host`. Each
 * editor of the document records into it. While no editor shows the document, a step changes it
 * through `write`.
 */
export default class SharedHistory {
    private readonly views = new Set<EditorView>();
    /** The document of the last editor detached, for steps applied while no editor shows it. */
    private doc: Text | undefined;
    private open: OpenStep | undefined;

    constructor(readonly host: HostHistory, private readonly write: (text: string) => void) {}

    attach(view: EditorView) {
        this.views.add(view);
    }

    detach(view: EditorView) {
        this.views.delete(view);
        this.doc = view.state.doc;
        this.open = undefined;
    }

    /** Records a transaction of an attached editor. */
    record(tr: Transaction) {
        if (!tr.docChanged) {
            if (tr.selection) {
                this.open = undefined;
            }
            return;
        }

        const time = Date.now();
        const isolate = tr.annotation(isolateHistory);
        if (tr.annotation(Transaction.addToHistory) === false) {
            this.open = undefined;
        } else if (this.open && isolate !== "before" && isolate !== "full"
                && canJoin(this.open, tr, time)) {
            const { step } = this.open;
            step.changes = step.changes.compose(tr.changes);
            step.after = tr.newDoc;
            step.selectionAfter = tr.newSelection;
            this.open.time = time;
        } else {
            const step: Step = {
                before: tr.startState.doc,
                after: tr.newDoc,
                changes: tr.changes,
                selectionBefore: tr.startState.selection,
                selectionAfter: tr.newSelection
            };
            const entry = this.host.push({
                undo: () => this.apply(step, true),
                redo: () => this.apply(step, false)
            });
            this.open = { step, entry, time };
        }

        if (isolate === "after" || isolate === "full") {
            this.open = undefined;
        }
    }

    private apply(step: Step, isUndo: boolean) {
        const from = isUndo ? step.after : step.before;
        const to = isUndo ? step.before : step.after;
        const view = [ ...this.views ].find((candidate) => candidate.state.doc.eq(from));
        if (view) {
            view.dispatch({
                changes: isUndo ? step.changes.invert(step.before) : step.changes,
                selection: isUndo ? step.selectionBefore : step.selectionAfter,
                scrollIntoView: true,
                annotations: Transaction.addToHistory.of(false)
            });
            // Deferred until after the Undo button of the toolbar focuses the text editor.
            queueMicrotask(() => view.focus());
        } else if (this.views.size || !this.doc?.eq(from)) {
            return false;
        }

        this.open = undefined;
        this.doc = to;
        this.write(to.toString());
        return true;
    }
}

/** Whether `tr` continues the typing of `open`, as `history()` groups its events. */
function canJoin(open: OpenStep, tr: Transaction, time: number) {
    const userEvent = tr.annotation(Transaction.userEvent);
    return open.entry.isLatest()
        && open.step.after === tr.startState.doc
        && (userEvent === "input.type.compose" || (
            !!userEvent && JOINABLE_EVENT.test(userEvent)
            && time - open.time < NEW_STEP_DELAY
            && isAdjacent(open.step.changes, tr.changes)
        ));
}

/** Whether the ranges that `next` changes touch those that `previous` produced. */
function isAdjacent(previous: ChangeSet, next: ChangeSet) {
    const ranges: number[] = [];
    previous.iterChangedRanges((_fromA, _toA, fromB, toB) => ranges.push(fromB, toB));
    let isTouching = false;
    next.iterChangedRanges((fromA, toA) => {
        for (let i = 0; i < ranges.length; i += 2) {
            if (toA >= ranges[i] && fromA <= ranges[i + 1]) {
                isTouching = true;
            }
        }
    });
    return isTouching;
}
