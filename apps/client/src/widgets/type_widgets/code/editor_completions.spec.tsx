import VanillaCodeMirror from "@triliumnext/codemirror";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../../entities/fnote";
import type { NoteSuggestionOptions, Suggestion } from "../../../services/note_autocomplete";
import { type CompletionTarget, useEditorCompletions } from "./editor_completions";
import type { CodeSnippet } from "./snippets";

// The hook's asynchronous sources of menu entries, stubbed so mounting it needs no server.
const { getNoteSuggestions, createNoteFromSuggestion } = vi.hoisted(() => ({
    getNoteSuggestions: vi.fn<
        (term: string, options?: NoteSuggestionOptions) => Promise<Suggestion[]>
    >(async () => []),
    createNoteFromSuggestion: vi.fn<
        (suggestion: Suggestion, childParentNotePath?: string | null) => Promise<string | undefined>
    >()
}));
vi.mock("../../../services/note_autocomplete", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../../services/note_autocomplete")>(),
    getNoteSuggestions,
    createNoteFromSuggestion
}));

const { snippets, useCodeSnippets } = vi.hoisted(() => {
    const ref = { current: [] as CodeSnippet[] };
    return { snippets: ref, useCodeSnippets: vi.fn(() => ref) };
});
vi.mock("./snippets", async (importOriginal) => ({
    ...await importOriginal<typeof import("./snippets")>(),
    useCodeSnippets
}));
vi.mock("../../../services/task_states", () => ({
    getTaskStateDefinitions: () => Promise.resolve([])
}));
// The catalogue is not loaded in specs, and the sample diagrams translate their names as they load.
vi.mock("../../../services/i18n", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../../services/i18n")>(),
    t: (key: string) => key
}));

const MARKDOWN = "text/x-markdown";
const GREETING: CodeSnippet = {
    noteId: "s1", title: "Greeting", description: "Says hello", content: "Hello!"
};
const ALPHA: Suggestion = {
    notePath: "root/projects/abc123",
    noteTitle: "Alpha",
    notePathTitle: "Projects / Alpha",
    highlightedNotePathTitle: "<b>Al</b>pha"
};
const CREATE_AL: Suggestion = {
    action: "create-child-note",
    noteTitle: "Al",
    parentNoteId: "parent",
    highlightedNotePathTitle: "Create child note"
};

describe("useEditorCompletions", () => {
    let container: HTMLElement;
    const editors: VanillaCodeMirror[] = [];

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        snippets.current = [];
        getNoteSuggestions.mockClear();
        createNoteFromSuggestion.mockClear();
    });

    afterEach(() => {
        act(() => render(null, container));
        container.remove();
        for (const editor of editors) editor.destroy();
        editors.length = 0;
    });

    /** Mounts the hook against `view`, and returns what it gives `codeCompletions()`. */
    function mount(view: VanillaCodeMirror, mime: string, target: CompletionTarget | undefined) {
        let getSnippets: () => CodeSnippet[] = () => [];
        function Probe() {
            getSnippets = useEditorCompletions(view, mime, target);
            return null;
        }

        act(() => render(h(Probe, {}), container));
        return () => getSnippets();
    }

    /** A focused editor, which the list opens in. */
    function buildEditor() {
        const parent = document.createElement("div");
        document.body.append(parent);
        const editor = new VanillaCodeMirror({ parent });
        editors.push(editor);
        editor.focus();
        return editor;
    }

    /** Puts `text` in `editor`, the caret at `caret` or at its end. */
    function type(editor: VanillaCodeMirror, text: string, caret = text.length) {
        editor.dispatch({
            changes: { from: 0, to: editor.state.doc.length, insert: text },
            selection: { anchor: caret }
        });
    }

    const rows = () => [
        ...document.querySelectorAll(".note-autocomplete-menu [role=option]")
    ];
    const rowTexts = () => rows().map((row) => row.textContent);
    const onlyRow = (text: string) => [ expect.stringContaining(text) ];
    const press = (editor: VanillaCodeMirror, key: string) => editor.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
    );
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const textOf = (editor: VanillaCodeMirror) => editor.state.doc.toString();

    it("registers the list and the fence languages only for Markdown, and withdraws both", () => {
        const setNamedExtension = vi.fn();
        const setCompletionSource = vi.fn();
        const view = { setNamedExtension, setCompletionSource } as unknown as VanillaCodeMirror;

        mount(view, MARKDOWN, { note: null });
        expect(setNamedExtension)
            .toHaveBeenCalledExactlyOnceWith("markdownCompletions", expect.anything());
        expect(setCompletionSource)
            .toHaveBeenCalledExactlyOnceWith("markdownCodeFence", expect.any(Function));
        act(() => render(null, container));
        expect(setNamedExtension).toHaveBeenLastCalledWith("markdownCompletions", []);
        expect(setCompletionSource).toHaveBeenLastCalledWith("markdownCodeFence", null);

        setNamedExtension.mockClear();
        setCompletionSource.mockClear();
        mount(view, "text/x-python", { note: null });
        expect(useCodeSnippets).toHaveBeenLastCalledWith("text/x-python", true);
        act(() => render(null, container));
        expect(setNamedExtension).not.toHaveBeenCalled();
        expect(setCompletionSource).not.toHaveBeenCalled();

        setNamedExtension.mockClear();
        mount(view, MARKDOWN, undefined);
        expect(setNamedExtension).not.toHaveBeenCalled();
        expect(setCompletionSource).not.toHaveBeenCalled();
        expect(useCodeSnippets).toHaveBeenLastCalledWith(MARKDOWN, false);
    });

    it("lists the Markdown commands and the snippets after a slash, and runs one", async () => {
        snippets.current = [ GREETING ];
        const editor = buildEditor();
        mount(editor, MARKDOWN, { note: { noteId: "n1" } as FNote });

        type(editor, "/tip");
        // Found by its title, without the slash.
        await vi.waitFor(() => expect(rowTexts()).toEqual(onlyRow("titles.tip")));
        expect(rows()[0]?.querySelector("b")?.textContent).toBe("tip");
        // Sized as the text editor's `/` list is.
        expect(document.querySelector(".note-autocomplete-menu.slash-command-menu")).not.toBeNull();

        // Opened on the best match, so Enter runs it.
        press(editor, "Enter");
        await vi.waitFor(() => expect(textOf(editor)).toBe("> [!TIP]\n> "));
        await vi.waitFor(() => expect(rows()).toEqual([]));

        type(editor, "/greet");
        await vi.waitFor(() => expect(rowTexts()).toEqual(onlyRow("Greeting")));
        press(editor, "Enter");
        await vi.waitFor(() => expect(textOf(editor)).toBe("Hello!"));
    });

    it("gives a code editor's snippets to its own list, without the note being edited", async () => {
        const editor = buildEditor();
        const getSnippets = mount(editor, "text/x-python", { note: { noteId: "s2" } as FNote });
        expect(getSnippets()).toEqual([]);

        snippets.current = [ GREETING, { noteId: "s2", title: "Itself", content: "x" } ];
        expect(getSnippets()).toEqual([ GREETING ]);

        // A code editor offers no note lists.
        type(editor, "@Al");
        await settle();
        expect(rows()).toEqual([]);
        expect(getNoteSuggestions).not.toHaveBeenCalled();

        // A Markdown editor lists them with its commands instead.
        act(() => render(null, container));
        expect(mount(editor, MARKDOWN, { note: null })()).toEqual([]);
    });

    it("lists the notes after an @ or a [[, and links the one picked or created", async () => {
        getNoteSuggestions.mockResolvedValue([ ALPHA, CREATE_AL ]);
        const editor = buildEditor();
        mount(editor, MARKDOWN, {
            note: { noteId: "n1" } as FNote, getNotePath: () => "root/parent"
        });

        type(editor, "see @Al");
        await vi.waitFor(() => expect(rows()).toHaveLength(2));
        // At most ten notes, and creation under the note being edited.
        expect(getNoteSuggestions)
            .toHaveBeenLastCalledWith("Al", { allowCreatingNotes: true, limit: 10 });

        // Opened on the best match, so Enter links it.
        press(editor, "Enter");
        await vi.waitFor(() => expect(textOf(editor)).toBe("see [[abc123]]"));

        // A note created is linked once it exists, past the dialog taking the focus.
        let created: (notePath: string | undefined) => void = () => {};
        createNoteFromSuggestion.mockReturnValueOnce(new Promise((resolve) => {
            created = resolve;
        }));
        type(editor, "see [[abc123]] @Al");
        await vi.waitFor(() => expect(rows()).toHaveLength(2));
        press(editor, "ArrowDown");
        await settle();
        press(editor, "Enter");
        await vi.waitFor(() => expect(createNoteFromSuggestion).toHaveBeenCalledWith(
            expect.objectContaining({ action: "create-child-note" }), "root/parent"
        ));
        editor.contentDOM.blur();
        created("root/parent/new1");
        await vi.waitFor(() => expect(textOf(editor)).toBe("see [[abc123]] [[new1]]"));

        // After [[ the same list opens, and a pick in a link already closed takes its brackets too.
        editor.focus();
        type(editor, "see [[Al");
        await vi.waitFor(() => expect(rows()).toHaveLength(2));
        press(editor, "Enter");
        await vi.waitFor(() => expect(textOf(editor)).toBe("see [[abc123]]"));
        type(editor, "see [[Al]] x", 8);
        await vi.waitFor(() => expect(rows()).toHaveLength(2));
        press(editor, "Enter");
        await vi.waitFor(() => expect(textOf(editor)).toBe("see [[abc123]] x"));
        expect(editor.state.selection.main.head).toBe(14);

        // So does a note created there, once it exists.
        createNoteFromSuggestion.mockResolvedValueOnce("root/parent/new2");
        type(editor, "see [[Al]] x", 8);
        await vi.waitFor(() => expect(rows()).toHaveLength(2));
        press(editor, "ArrowDown");
        await settle();
        press(editor, "Enter");
        await vi.waitFor(() => expect(textOf(editor)).toBe("see [[new2]] x"));
    });

    it("creates notes under the best path of the owner note without a path given", async () => {
        getNoteSuggestions.mockResolvedValue([ CREATE_AL ]);
        createNoteFromSuggestion.mockResolvedValueOnce(undefined);
        const owner = {
            noteId: "owner", getBestNotePathString: () => "root/owner"
        } as unknown as FNote;
        const editor = buildEditor();
        mount(editor, MARKDOWN, { note: null, ownerNote: owner });

        type(editor, "@Al");
        await vi.waitFor(() => expect(rows()).toHaveLength(1));
        press(editor, "Enter");
        await vi.waitFor(() => expect(createNoteFromSuggestion)
            .toHaveBeenLastCalledWith(expect.anything(), "root/owner"));
    });
});
