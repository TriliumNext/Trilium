import { EditorSelection, type EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFieldEditor, type FieldEditor, type FieldEditorConfig } from "../field_editor.js";
import { hostedCompletion, type HostedCompletionConfig, type HostedCompletionList, type HostedCompletionState } from "./hosted_completion.js";

let editor: FieldEditor | undefined;

afterEach(() => {
    editor?.destroy();
    editor = undefined;
    vi.restoreAllMocks();
});

interface TestMatch {
    from: number;
    query: string;
    explicit: boolean;
    /** Where the caret is, read from the state `match` is given. */
    at: number;
}

/**
 * An `@` where a value can stand, the query running to whitespace, as the search field has it; and
 * when asked explicitly, the word before the caret, empty as it can be.
 */
function match(before: string, explicit: boolean, state: EditorState): TestMatch | null {
    const at = state.selection.main.head;
    const mention = /(?:^|\s)@([^\s@]*)$/.exec(before);
    if (mention) {
        const from = before.length - mention[1].length - 1;
        return { from, query: mention[1], explicit, at };
    }

    const word = /\w*$/.exec(before)?.[0] ?? "";
    return explicit ? { from: before.length - word.length, query: word, explicit, at } : null;
}

describe("hostedCompletion", () => {
    it("shows what matches before the caret as it changes, and hides the list once nothing does", async () => {
        const { list, shown } = build();

        type("#book @");
        await vi.waitFor(() => expect(shown()?.match.query).toBe(""));
        expect(shown()?.editable).toBe(editor?.dom);

        type("Fo");
        await vi.waitFor(() => expect(shown()?.match.query).toBe("Fo"));
        expect(list.show).toHaveBeenCalledTimes(2);
        expect(shown()?.match.at).toBe(9);

        // Neither a selection change that keeps the text before the caret nor an empty update shows
        // it again.
        editor?.dispatch({ selection: EditorSelection.cursor(9) });
        editor?.dispatch({});
        await settle();
        expect(list.show).toHaveBeenCalledTimes(2);

        type(" ");
        expect(list.hide).toHaveBeenCalledOnce();

        // Neither inside a word nor over a selection.
        type("#foo@");
        // Set while blurred: happy-dom reports a range set in a focused editor during the update.
        editor?.contentDOM.blur();
        editor?.dispatch({ changes: { from: 0, insert: "@" }, selection: EditorSelection.range(0, 1) });
        editor?.focus();
        await settle();
        expect(list.show).toHaveBeenCalledTimes(2);
    });

    it("puts what the list commits in place of the match, and reads the result again as typing", async () => {
        const { list, shown } = build({ doc: "#book\n" });

        // Typed faster than the list is shown, the older text is never shown.
        type("@F");
        type("o");
        await vi.waitFor(() => expect(shown()?.match.query).toBe("Fo"));
        expect(list.show).toHaveBeenCalledOnce();
        // On the second line, the match starts past the first.
        shown()?.commit("abc123");

        expect(editor?.state.doc.toString()).toBe("#book\nabc123");
        expect(editor?.state.selection.main.head).toBe(12);
        expect(list.hide).toHaveBeenCalledOnce();

        // The list it was shown for has closed, so a late commit changes nothing.
        shown()?.commit("def456");
        expect(editor?.state.doc.toString()).toBe("#book\nabc123");

        // A function commits whatever it does to the text between the match and the caret.
        type(" @x");
        await vi.waitFor(() => expect(shown()?.match.query).toBe("x"));
        shown()?.commit((view, from, to) => {
            view.dispatch({ changes: { from, to, insert: "[1]" }, selection: { anchor: from } });
        });
        expect(editor?.state.doc.toString()).toBe("#book\nabc123 [1]");
        expect(editor?.state.selection.main.head).toBe(13);
        editor?.dispatch({ changes: { from: 12, to: 16 }, selection: EditorSelection.cursor(12) });

        // A commit that leaves something to complete opens the list on it.
        type(" @Ba");
        await vi.waitFor(() => expect(shown()?.match.query).toBe("Ba"));
        const before = shown();
        shown()?.commit("x @");
        await vi.waitFor(() => expect(shown()).not.toBe(before));
        expect(shown()?.match.query).toBe("");
        expect(editor?.state.doc.toString()).toBe("#book\nabc123 x @");

        // An edit before an open list's match shows it again, and its commit lands on the match.
        const moved = shown();
        editor?.dispatch({ changes: { from: 0, insert: "~author " } });
        await vi.waitFor(() => expect(shown()).not.toBe(moved));
        shown()?.commit("def456");
        expect(editor?.state.doc.toString()).toBe("~author #book\nabc123 x def456");
    });

    it("puts what a promise settles on in place of the match once it settles, past the list closing", async () => {
        const { list, shown } = build();
        let resolveLink: (text: string | undefined) => void = () => {};

        type("see @ne");
        await vi.waitFor(() => expect(shown()?.match.query).toBe("ne"));
        shown()?.commit(new Promise<string | undefined>((resolve) => { resolveLink = resolve; }));
        expect(list.hide).toHaveBeenCalledOnce();

        // A dialog takes the focus meanwhile, and the text typed stays, the list closed on it.
        editor?.contentDOM.blur();
        editor?.dispatch({ changes: { from: 0, insert: "I " } });
        editor?.focus();
        await settle();
        expect(list.show).toHaveBeenCalledOnce();

        resolveLink("[[new]]");
        await vi.waitFor(() => expect(editor?.state.doc.toString()).toBe("I see [[new]]"));

        // Settled on nothing, the text stays for good.
        type(" @x");
        await vi.waitFor(() => expect(shown()?.match.query).toBe("x"));
        shown()?.commit(Promise.resolve<string | undefined>(undefined));
        await settle();
        expect(editor?.state.doc.toString()).toBe("I see [[new]] @x");
        // And so does it where the promise fails.
        type(" @z");
        await vi.waitFor(() => expect(shown()?.match.query).toBe("z"));
        shown()?.commit(Promise.reject(new Error("canceled")));
        await settle();
        expect(editor?.state.doc.toString()).toBe("I see [[new]] @x @z");
        editor?.dispatch({ changes: { from: 16, to: 19 }, selection: EditorSelection.cursor(16) });

        // A promise can settle on a function, which runs on the typed range then.
        type(" @fn");
        await vi.waitFor(() => expect(shown()?.match.query).toBe("fn"));
        shown()?.commit(Promise.resolve((view: EditorView, from: number, to: number) => {
            view.dispatch({ changes: { from, to, insert: "<fn>" } });
        }));
        await vi.waitFor(() => expect(editor?.state.doc.toString()).toBe("I see [[new]] @x <fn>"));

        // Text replaced or edited where the commit waits gives it up, rather than landing elsewhere.
        type(" @a");
        await vi.waitFor(() => expect(shown()?.match.query).toBe("a"));
        shown()?.commit(new Promise<string | undefined>((resolve) => { resolveLink = resolve; }));
        editor?.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: "Another note" } });
        resolveLink("[[late]]");
        await settle();
        expect(editor?.state.doc.toString()).toBe("Another note");
        type(" @b");
        await vi.waitFor(() => expect(shown()?.match.query).toBe("b"));
        shown()?.commit(new Promise<string | undefined>((resolve) => { resolveLink = resolve; }));
        editor?.dispatch({ changes: { from: 15, insert: "c" } });
        resolveLink("[[late]]");
        await settle();
        expect(editor?.state.doc.toString()).toBe("Another note @bc");
        editor?.dispatch({ changes: { from: 12, to: 16 }, selection: EditorSelection.cursor(12) });

        // Settling past the editor's end does nothing.
        type(" @y");
        await vi.waitFor(() => expect(shown()?.match.query).toBe("y"));
        shown()?.commit(new Promise<string | undefined>((resolve) => { resolveLink = resolve; }));
        const view = editor;
        editor = undefined;
        view?.destroy();
        resolveLink("[[late]]");
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(view?.state.doc.toString()).toBe("Another note @y");
    });

    it("follows up on what a commit inserted, for the text typed after it, until a commit or a space", async () => {
        const { list, shown } = build();

        type("see @Al");
        await vi.waitFor(() => expect(shown()?.match.query).toBe("Al"));
        const noteMatch = shown()?.match;
        shown()?.commitAndFollowUp("[[a1]]", "root/a1");
        expect(editor?.state.doc.toString()).toBe("see [[a1]]");
        await vi.waitFor(() => expect(shown()?.followUp).toEqual({ of: "root/a1", query: "" }));
        expect(shown()?.match).toBe(noteMatch);
        expect(list.hide).not.toHaveBeenCalled();

        // A mark follows the inserted text, before the text typed after it.
        type("In st");
        await vi.waitFor(() => expect(shown()?.followUp?.query).toBe("In st"));
        expect(textAround(followUpMark())).toEqual([ "see [[a1]]", "In st" ]);

        // A commit replaces the inserted text and the text typed after it, and ends the follow-up.
        shown()?.commit("[[a1?block=b]]");
        expect(editor?.state.doc.toString()).toBe("see [[a1?block=b]]");
        expect(list.hide).toHaveBeenCalledOnce();
        expect(followUpMark()).toBeNull();
        const shownCount = list.show.mock.calls.length;
        type("x");
        await settle();
        expect(list.show).toHaveBeenCalledTimes(shownCount);

        // A space right after the inserted text ends the follow-up, and the text stays.
        type(" @Be");
        await vi.waitFor(() => expect(shown()?.match.query).toBe("Be"));
        shown()?.commitAndFollowUp("[[b2]]", "b2");
        await vi.waitFor(() => expect(shown()?.followUp?.of).toBe("b2"));
        type(" ");
        expect(list.hide).toHaveBeenCalledTimes(2);
        expect(editor?.state.doc.toString()).toBe("see [[a1?block=b]]x [[b2]] ");

        // A new match after it is completed as any other.
        type("@C");
        await vi.waitFor(() => expect(shown()?.match.query).toBe("C"));
        expect(shown()?.followUp).toBeNull();
    });

    it("ends a follow-up on Backspace right after the inserted text, on a dismissal, and as the text or the caret leaves", async () => {
        const { list, shown, setElement } = build({ doc: "x" });
        setElement(document.createElement("div"));
        const followUp = async (query: string, text: string) => {
            type(` @${query}`);
            await vi.waitFor(() => expect(shown()?.match.query).toBe(query));
            shown()?.commitAndFollowUp(text, text);
            await vi.waitFor(() => expect(shown()?.followUp?.of).toBe(text));
            return list.show.mock.calls.length;
        };

        // Backspace there closes the list and deletes nothing.
        let shownCount = await followUp("a", "[[a]]");
        expect(followUpMark()).not.toBeNull();
        expect(press("Backspace")).toBe(true);
        expect(editor?.state.doc.toString()).toBe("x [[a]]");
        expect(list.hide).toHaveBeenCalledOnce();
        expect(followUpMark()).toBeNull();
        type("y");
        await settle();
        expect(list.show).toHaveBeenCalledTimes(shownCount);

        // Past the text typed after it, Backspace goes to the list, then to the field.
        await followUp("b", "[[b]]");
        type("q");
        await vi.waitFor(() => expect(shown()?.followUp?.query).toBe("q"));
        press("Backspace");
        expect(list.handleKeyDown).toHaveBeenLastCalledWith(expect.objectContaining({ key: "Backspace" }));
        expect(editor?.state.doc.toString()).toBe("x [[a]]y [[b]]");

        // Escape or `dismiss()` end it for good.
        shownCount = await followUp("c", "[[c]]");
        expect(press("Escape")).toBe(true);
        expect(followUpMark()).toBeNull();
        type("z");
        await settle();
        expect(list.show).toHaveBeenCalledTimes(shownCount);
        shownCount = await followUp("d", "[[d]]");
        shown()?.dismiss();
        expect(followUpMark()).toBeNull();
        type("z");
        await settle();
        expect(list.show).toHaveBeenCalledTimes(shownCount);

        // A caret moved before the inserted text, or an edit inside it, ends it too.
        shownCount = await followUp("e", "[[e]]");
        const end = editor?.state.doc.length ?? 0;
        editor?.dispatch({ selection: EditorSelection.cursor(end - 2) });
        editor?.dispatch({ selection: EditorSelection.cursor(end) });
        await settle();
        expect(list.show).toHaveBeenCalledTimes(shownCount);
        shownCount = await followUp("f", "[[f]]");
        const link = (editor?.state.doc.length ?? 0) - 3;
        editor?.dispatch({ changes: { from: link, insert: "g" } });
        await settle();
        expect(list.show).toHaveBeenCalledTimes(shownCount);
        expect(editor?.state.doc.toString()).toBe("x [[a]]y [[b]] [[c]]z [[d]]z [[e]] [[gf]]");

        // Text that was already after the inserted text is no part of the query: a caret moved
        // into it ends the follow-up, and a late commit leaves that text in place.
        editor?.dispatch({
            changes: { from: 0, to: editor.state.doc.length, insert: "word" },
            selection: EditorSelection.cursor(0)
        });
        type("@h");
        await vi.waitFor(() => expect(shown()?.match.query).toBe("h"));
        shown()?.commitAndFollowUp("[[h]]", "h");
        await vi.waitFor(() => expect(shown()?.followUp?.of).toBe("h"));
        type("q");
        await vi.waitFor(() => expect(shown()?.followUp?.query).toBe("q"));
        shownCount = list.show.mock.calls.length;
        const hiddenCount = list.hide.mock.calls.length;
        editor?.dispatch({ selection: EditorSelection.cursor(7) });
        await settle();
        expect(list.show).toHaveBeenCalledTimes(shownCount);
        expect(list.hide).toHaveBeenCalledTimes(hiddenCount + 1);
        expect(followUpMark()).toBeNull();
        shown()?.commit("[[h?block=b]]");
        expect(editor?.state.doc.toString()).toBe("[[h]]qword");
    });

    it("follows up on what a function commits, up to where it leaves the caret", async () => {
        const { shown } = build({ doc: "]]" });
        editor?.dispatch({ selection: EditorSelection.cursor(0) });

        type("@Al");
        await vi.waitFor(() => expect(shown()?.match.query).toBe("Al"));
        shown()?.commitAndFollowUp((view, from, to) => view.dispatch({
            changes: { from, to: to + 2, insert: "[[a1]]" },
            selection: { anchor: from + 6 }
        }), "a1");
        await vi.waitFor(() => expect(shown()?.followUp?.of).toBe("a1"));
        type("He");
        await vi.waitFor(() => expect(shown()?.followUp?.query).toBe("He"));

        // A commit of the follow-up runs on the inserted text and the text typed after it.
        const ranges: number[][] = [];
        shown()?.commit((_view, from, to) => ranges.push([ from, to ]));
        expect(ranges).toEqual([ [ 0, 8 ] ]);

        // A function that inserts nothing leaves nothing to follow up on.
        editor?.dispatch({ changes: { from: 0, to: editor.state.doc.length } });
        type("@B");
        await vi.waitFor(() => expect(shown()?.match.query).toBe("B"));
        const before = shown();
        shown()?.commitAndFollowUp(() => {}, "b");
        type("c");
        await vi.waitFor(() => expect(shown()).not.toBe(before));
        expect(shown()?.followUp).toBeNull();
        expect(shown()?.match.query).toBe("Bc");
    });

    it("forwards the keys to the open list, which takes them from the field", async () => {
        const onArrowDown = vi.fn(() => true);
        const { list, shown } = build({ onArrowDown });

        // Closed, the field has the key.
        expect(press("ArrowDown")).toBe(true);
        expect(onArrowDown).toHaveBeenCalledOnce();

        type("@");
        await vi.waitFor(() => expect(shown()).toBeDefined());
        vi.mocked(list.handleKeyDown).mockReturnValueOnce(true);
        expect(press("ArrowDown")).toBe(true);
        expect(onArrowDown).toHaveBeenCalledOnce();

        // A key the list declines reaches the field, and so does any while an IME composes.
        expect(press("ArrowDown")).toBe(true);
        expect(onArrowDown).toHaveBeenCalledTimes(2);
        vi.mocked(list.handleKeyDown).mockClear();
        press("ArrowDown", { isComposing: true });
        expect(list.handleKeyDown).not.toHaveBeenCalled();
    });

    it("closes on Escape for that match alone, and leaves Escape to the field while the list shows nothing", async () => {
        const onEscape = vi.fn(() => true);
        const { list, shown, setElement } = build({ onEscape });

        type("@");
        await vi.waitFor(() => expect(shown()).toBeDefined());
        expect(press("Escape")).toBe(true);
        expect(onEscape).toHaveBeenCalledOnce();
        expect(list.hide).not.toHaveBeenCalled();

        setElement(document.createElement("div"));
        expect(press("Escape")).toBe(true);
        expect(onEscape).toHaveBeenCalledOnce();
        expect(list.hide).toHaveBeenCalledOnce();

        // Typing on in the same match, even past an edit before it, leaves it closed.
        type("Fo");
        editor?.dispatch({ changes: { from: 0, insert: "#book " } });
        await settle();
        expect(list.show).toHaveBeenCalledOnce();

        // Another match opens it again.
        type(" @");
        await vi.waitFor(() => expect(list.show).toHaveBeenCalledTimes(2));
        expect(shown()?.match.query).toBe("");

        // A dismissal from the list of an earlier match leaves the list of the open one alone.
        const earlier = shown();
        type(" @");
        await vi.waitFor(() => expect(shown()).not.toBe(earlier));
        earlier?.dismiss();
        expect(list.hide).toHaveBeenCalledOnce();
        shown()?.dismiss();
        expect(list.hide).toHaveBeenCalledTimes(2);
    });

    it("asks for an explicit match on Ctrl-Space or Alt-`, until the list closes", async () => {
        const { list, shown, setElement } = build();

        type("#book bo");
        await settle();
        expect(list.show).not.toHaveBeenCalled();

        expect(press(" ", { ctrlKey: true })).toBe(true);
        await vi.waitFor(() => expect(shown()?.match).toEqual({ from: 6, query: "bo", explicit: true, at: 8 }));

        // Asked for while the list is open, or closed with Escape, it shows the list again.
        expect(press("`", { altKey: true })).toBe(true);
        await vi.waitFor(() => expect(list.show).toHaveBeenCalledTimes(2));
        setElement(document.createElement("div"));
        press("Escape");
        expect(list.hide).toHaveBeenCalledOnce();
        press(" ", { ctrlKey: true });
        await vi.waitFor(() => expect(list.show).toHaveBeenCalledTimes(3));

        // Once the list closes, typing alone offers nothing again, past the word it closed on too.
        press("Escape");
        type(" x");
        await settle();
        expect(list.show).toHaveBeenCalledTimes(3);
    });

    it("leaves Ctrl-Space to the editor where nothing can be completed", async () => {
        const { list } = build({}, () => null);

        type("#book");
        expect(press(" ", { ctrlKey: true })).toBe(false);
        await settle();
        expect(list.show).not.toHaveBeenCalled();
    });

    it("opens on a caret move only where the host allows it, and keeps an open list while the caret stays on its match", async () => {
        // Any word before the caret, as a code editor matches identifiers.
        const word = (before: string, explicit: boolean, state: EditorState): TestMatch | null => {
            const found = /\w+$/.exec(before)?.[0];
            return found ? { from: before.length - found.length, query: found, explicit, at: state.selection.main.head } : null;
        };

        const { list, shown } = build({ doc: "return x" }, word, { opensOnCaretMove: false });
        editor?.dispatch({ selection: EditorSelection.cursor(6) });
        await settle();
        expect(list.show).not.toHaveBeenCalled();

        type("s");
        await vi.waitFor(() => expect(shown()?.match.query).toBe("returns"));
        editor?.dispatch({ selection: EditorSelection.cursor(5) });
        await vi.waitFor(() => expect(shown()?.match.query).toBe("retur"));
        editor?.dispatch({ selection: EditorSelection.cursor(9) });
        await vi.waitFor(() => expect(list.hide).toHaveBeenCalled());
        await settle();
        expect(shown()?.match.query).toBe("retur");

        editor?.destroy();
        const byDefault = build({ doc: "return x" }, word);
        await vi.waitFor(() => expect(byDefault.shown()?.match.query).toBe("x"));
    });

    it("closes as the editor loses the focus, and takes the list down with it", async () => {
        const { list, shown } = build();

        type("@Fo");
        await vi.waitFor(() => expect(shown()).toBeDefined());
        editor?.contentDOM.blur();
        await vi.waitFor(() => expect(list.hide).toHaveBeenCalledOnce());

        editor?.destroy();
        editor = undefined;
        expect(list.destroy).toHaveBeenCalledOnce();
    });

    it("points the editor at the entry the open list highlights, and at none once it closes", async () => {
        const { shown } = build();
        type("@");
        await vi.waitFor(() => expect(shown()).toBeDefined());
        const open = shown();
        const activeDescendant = () => editor?.contentDOM.getAttribute("aria-activedescendant");

        open?.setActiveDescendant("row-1");
        expect(activeDescendant()).toBe("row-1");
        open?.setActiveDescendant(null);
        expect(activeDescendant()).toBe(null);

        open?.setActiveDescendant("row-2");
        type(" ");
        expect(activeDescendant()).toBe(null);
        // A list that has closed points at nothing.
        open?.setActiveDescendant("row-3");
        expect(activeDescendant()).toBe(null);

        type("@");
        await vi.waitFor(() => expect(shown()).not.toBe(open));
        shown()?.setActiveDescendant("row-4");
        const dom = editor?.contentDOM;
        editor?.destroy();
        editor = undefined;
        expect(dom?.hasAttribute("aria-activedescendant")).toBe(false);
    });

    it("places the list at the caret, or at the editor where the caret has no place on screen", async () => {
        const { shown, placed } = build();
        type("@");
        await vi.waitFor(() => expect(shown()).toBeDefined());
        // Read as CodeMirror shows the list, when it allows no layout reads.
        expect(placed()).toBeInstanceOf(DOMRect);
        const view = editor;
        if (!view) throw new Error("expected an editor");

        vi.spyOn(view, "coordsAtPos").mockReturnValue({ left: 10, right: 11, top: 20, bottom: 36 });
        expect(shown()?.caretRect()).toEqual(new DOMRect(10, 20, 1, 16));

        vi.spyOn(view, "coordsAtPos").mockReturnValue(null);
        vi.spyOn(view.contentDOM, "getBoundingClientRect").mockReturnValue(new DOMRect(1, 2, 3, 4));
        expect(shown()?.caretRect()).toEqual(new DOMRect(1, 2, 3, 4));
    });
});

function build(
    config: Partial<FieldEditorConfig> = {},
    matchAt: typeof match = match,
    options: Partial<HostedCompletionConfig<TestMatch>> = {}
) {
    let element: HTMLElement | null = null;
    let state: HostedCompletionState<TestMatch> | undefined;
    let placed: unknown;
    const list = {
        // Places itself as it is shown, as a popup does.
        show: vi.fn((shown: HostedCompletionState<TestMatch>) => {
            state = shown;
            try {
                placed = shown.caretRect();
            } catch (e) {
                placed = e;
            }
        }),
        hide: vi.fn(),
        handleKeyDown: vi.fn(() => false),
        get element() { return element; },
        destroy: vi.fn()
    } satisfies HostedCompletionList<TestMatch>;

    const parent = document.createElement("div");
    document.body.appendChild(parent);
    editor = createFieldEditor({
        parent,
        ...config,
        extensions: [ hostedCompletion({ ...options, match: matchAt, list: () => list }) ]
    });
    editor.focus();
    editor.dispatch({ selection: EditorSelection.cursor(editor.state.doc.length) });

    return {
        list,
        shown: () => state,
        placed: () => placed,
        setElement: (el: HTMLElement | null) => { element = el; }
    };
}

/** Types `text` at the caret, leaving the caret after it. */
function type(text: string) {
    const view = editor;
    if (!view) throw new Error("expected an editor");
    const from = view.state.selection.main.head;
    view.dispatch({ changes: { from, insert: text }, selection: EditorSelection.cursor(from + text.length) });
}

/** The mark drawn after the text that the list follows up on. */
function followUpMark() {
    return editor?.contentDOM.querySelector(".cm-completion-follow-up") ?? null;
}

/** The text of the line before `node` and after it. */
function textAround(node: Element | null) {
    let before = "";
    for (let sibling = node?.previousSibling; sibling; sibling = sibling.previousSibling) {
        before = (sibling.textContent ?? "") + before;
    }
    let after = "";
    for (let sibling = node?.nextSibling; sibling; sibling = sibling.nextSibling) {
        after += sibling.textContent ?? "";
    }
    return [ before, after ];
}

/** Waits out the measure pass the list is shown in, so a list that was not shown is known not to be. */
function settle() {
    return new Promise((resolve) => setTimeout(resolve, 50));
}

/** Presses a key on the editor and answers whether a binding handled it. */
function press(key: string, init: KeyboardEventInit = {}) {
    return !editor?.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
}
