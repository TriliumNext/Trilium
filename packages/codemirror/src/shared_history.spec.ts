import { isolateHistory } from "@codemirror/commands";
import { EditorSelection, Transaction, type TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SharedHistory, { type HostHistory, type HostHistoryStep } from "./shared_history.js";

let views: EditorView[] = [];
let now = 0;

beforeEach(() => {
    now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
});

afterEach(() => {
    for (const view of views) {
        view.destroy();
    }
    views = [];
    vi.restoreAllMocks();
});

describe("SharedHistory", () => {
    it("groups typing into one step, as the history of CodeMirror does", () => {
        const host = createHost();
        const { view } = setUp(host, "");

        type(view, 0, "a");
        now += 100;
        view.dispatch({});
        type(view, 1, "b");
        expect(host.done).toHaveLength(1);

        // A pause starts a new step.
        now += 600;
        type(view, 2, "c");
        expect(host.done).toHaveLength(2);

        // So do a change away from the last one, a paste and a selection move.
        type(view, 0, "x");
        type(view, 1, "y", "input.paste");
        view.dispatch({ selection: EditorSelection.cursor(2) });
        type(view, 2, "z");
        expect(host.done).toHaveLength(5);

        // And a change of the host made in between.
        host.pushOther();
        type(view, 1, "w");
        expect(host.done).toHaveLength(7);

        // Composition joins the step before it.
        type(view, 2, "q", "input.type.compose");
        now += 600;
        type(view, 3, "r", "input.type.compose");
        expect(host.done).toHaveLength(7);

        // A change that the user did not type does not.
        view.dispatch({ changes: { from: 4, insert: "s" } });
        expect(host.done).toHaveLength(8);
    });

    it("starts a new step for each editor of the document", () => {
        const host = createHost();
        const { view, history } = setUp(host, "");
        const other = createView("", (tr) => history.record(tr));
        history.attach(other);

        type(view, 0, "a");
        type(other, 0, "b");
        expect(host.done).toHaveLength(2);
    });

    it("undoes and redoes a step in the editor that shows it, with its selection", async () => {
        const host = createHost();
        const { view, write, history } = setUp(host, "start");
        const focus = vi.spyOn(view, "focus");
        const otherView = createView("unrelated");
        history.attach(otherView);

        view.dispatch({ selection: EditorSelection.cursor(5) });
        type(view, 5, "!");
        type(view, 6, "?");
        host.undo();
        expect(view.state.doc.toString()).toBe("start");
        expect(view.state.selection.main.head).toBe(5);
        expect(otherView.state.doc.toString()).toBe("unrelated");
        expect(write).toHaveBeenLastCalledWith("start");
        // The undo is not a step of its own.
        expect(host.done).toHaveLength(0);
        await Promise.resolve();
        expect(focus).toHaveBeenCalledOnce();

        host.redo();
        expect(view.state.doc.toString()).toBe("start!?");
        expect(view.state.selection.main.head).toBe(7);
        expect(write).toHaveBeenLastCalledWith("start!?");
        expect(host.done).toHaveLength(1);
    });

    it("changes the document through `write` while no editor shows it", () => {
        const host = createHost();
        const { view, write, history } = setUp(host, "a");

        type(view, 1, "b");
        history.detach(view);
        host.undo();
        expect(write).toHaveBeenLastCalledWith("a");

        // An editor that shows the document again takes the redo.
        const remounted = createView("a");
        history.attach(remounted);
        host.redo();
        expect(remounted.state.doc.toString()).toBe("ab");
        expect(write).toHaveBeenLastCalledWith("ab");
    });

    it("skips a step once the document changed outside the history", () => {
        const host = createHost();
        const { view, write, history } = setUp(host, "a");

        type(view, 1, "b");
        load(view, "changed elsewhere");
        expect(host.done).toHaveLength(1);
        expect(host.undo()).toBe(false);
        expect(view.state.doc.toString()).toBe("changed elsewhere");
        expect(write).not.toHaveBeenCalled();

        // Also while no editor shows the document.
        type(view, 0, "x");
        history.detach(view);
        load(view, "changed again");
        history.attach(view);
        history.detach(view);
        expect(host.undo()).toBe(false);

        // A step whose document was never shown does not apply either.
        const orphan = new SharedHistory(host, write);
        const unattached = createView("");
        orphan.record(unattached.state.update({ changes: { from: 0, insert: "a" } }));
        expect(host.undo()).toBe(false);
    });

    it("ends a step around a change marked with `isolateHistory`, as `history()` does", () => {
        const host = createHost();
        const { view } = setUp(host, "");
        const isolatedType = (at: number, text: string, isolate: "before" | "after" | "full") =>
            view.dispatch({
                changes: { from: at, insert: text },
                selection: EditorSelection.cursor(at + text.length),
                userEvent: "input.type",
                annotations: isolateHistory.of(isolate)
            });

        type(view, 0, "a");
        isolatedType(1, "b", "full");
        type(view, 2, "c");
        expect(host.done).toHaveLength(3);

        isolatedType(3, "d", "before");
        type(view, 4, "e");
        expect(host.done).toHaveLength(4);

        isolatedType(5, "f", "after");
        type(view, 6, "g");
        expect(host.done).toHaveLength(5);
    });

    it("leaves loaded content out of the history, and ends the step before it", () => {
        const host = createHost();
        const { view } = setUp(host, "");

        type(view, 0, "a");
        load(view, "a");
        expect(host.done).toHaveLength(1);
        type(view, 1, "b");
        expect(host.done).toHaveLength(2);
    });
});

interface FakeHost extends HostHistory {
    done: HostHistoryStep[];
    undone: HostHistoryStep[];
    undo(): boolean;
    redo(): boolean;
    /** Pushes a change of the host itself. */
    pushOther(): void;
}

/** A host whose stack runs one step per undo or redo. */
function createHost(): FakeHost {
    const done: HostHistoryStep[] = [];
    const undone: HostHistoryStep[] = [];
    return {
        done,
        undone,
        push(step) {
            done.push(step);
            undone.length = 0;
            return { isLatest: () => done.at(-1) === step && !undone.length };
        },
        undo() {
            const step = done.pop();
            undone.push(...(step ? [ step ] : []));
            return !!step?.undo();
        },
        redo() {
            const step = undone.pop();
            done.push(...(step ? [ step ] : []));
            return !!step?.redo();
        },
        pushOther() {
            done.push({ undo: () => true, redo: () => true });
        }
    };
}

function setUp(host: HostHistory, doc: string) {
    const write = vi.fn();
    const history = new SharedHistory(host, write);
    const view = createView(doc, (tr) => history.record(tr));
    history.attach(view);
    return { view, write, history };
}

function createView(doc: string, record?: (tr: Transaction) => void) {
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
        doc,
        parent,
        dispatchTransactions: (transactions, target) => {
            for (const tr of transactions) {
                record?.(tr);
            }
            target.update(transactions);
        }
    });
    views.push(view);
    return view;
}

function type(view: EditorView, at: number, text: string, userEvent = "input.type") {
    view.dispatch({
        changes: { from: at, insert: text },
        selection: EditorSelection.cursor(at + text.length),
        userEvent
    });
}

function load(view: EditorView, text: string) {
    const spec: TransactionSpec = {
        changes: { from: 0, to: view.state.doc.length, insert: text },
        annotations: Transaction.addToHistory.of(false)
    };
    view.dispatch(spec);
}
