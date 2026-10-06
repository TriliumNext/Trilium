import type { CompletionContext } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import VanillaCodeMirror from "@triliumnext/codemirror";
import type { MimeType, TaskStateDef } from "@triliumnext/commons";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../../entities/fnote";
import mime_types from "../../../services/mime_types.js";
import type { NoteSuggestionOptions, Suggestion } from "../../../services/note_autocomplete";
import type { TypeWidgetProps } from "../type_widget";
import { buildCodeFenceOptions, buildSlashCommands, buildTaskItemInsert, codeFenceCompletionSource, isClosingFence, markdownCompletionAt, parseCodeFencePrefix, useMarkdownCompletions } from "./completions";

// The hook's two asynchronous sources of menu entries, stubbed so mounting it needs no server.
const { getNoteSuggestions, createNoteFromSuggestion } = vi.hoisted(() => ({
    getNoteSuggestions: vi.fn<(term: string, options?: NoteSuggestionOptions) => Promise<Suggestion[]>>(async () => []),
    createNoteFromSuggestion: vi.fn<(suggestion: Suggestion, childParentNotePath?: string | null) => Promise<string | undefined>>()
}));
vi.mock("../../../services/note_autocomplete", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../../services/note_autocomplete")>(),
    getNoteSuggestions,
    createNoteFromSuggestion
}));

const { uploadImageAndInsert } = vi.hoisted(() => ({ uploadImageAndInsert: vi.fn() }));
vi.mock("./editor_utils", async (importOriginal) => ({
    ...await importOriginal<typeof import("./editor_utils")>(),
    uploadImageAndInsert
}));

vi.mock("../code/snippets", async (importOriginal) => ({
    ...await importOriginal<typeof import("../code/snippets")>(),
    useCodeSnippets: () => ({ current: [] })
}));
vi.mock("../../../services/task_states", () => ({ getTaskStateDefinitions: () => Promise.resolve([]) }));
// The catalogue is not loaded in specs, and the sample diagrams translate their names as they load.
vi.mock("../../../services/i18n", async (importOriginal) => ({
    ...await importOriginal<typeof import("../../../services/i18n")>(),
    t: (key: string) => key
}));

describe("buildTaskItemInsert", () => {
    it("prepends a bullet when not already in a list item", () => {
        expect(buildTaskItemInsert(" ", false)).toBe("- [ ] ");
        expect(buildTaskItemInsert("x", false)).toBe("- [x] ");
        expect(buildTaskItemInsert("/", false)).toBe("- [/] ");
    });

    it("reuses an existing '- ' bullet to avoid a doubled marker", () => {
        expect(buildTaskItemInsert(" ", true)).toBe("[ ] ");
        expect(buildTaskItemInsert("x", true)).toBe("[x] ");
        expect(buildTaskItemInsert("/", true)).toBe("[/] ");
    });
});

describe("parseCodeFencePrefix", () => {
    it("matches a bare fence opener", () => {
        expect(parseCodeFencePrefix("```")).toEqual({ langStart: 3, typed: "" });
    });

    it("captures the partial language token after the backticks", () => {
        expect(parseCodeFencePrefix("```js")).toEqual({ langStart: 3, typed: "js" });
        expect(parseCodeFencePrefix("```c++")).toEqual({ langStart: 3, typed: "c++" });
    });

    it("accounts for leading indentation in langStart", () => {
        expect(parseCodeFencePrefix("    ```py")).toEqual({ langStart: 7, typed: "py" });
    });

    it("handles fences longer than three backticks", () => {
        expect(parseCodeFencePrefix("`````")).toEqual({ langStart: 5, typed: "" });
    });

    it("rejects non-fence text", () => {
        expect(parseCodeFencePrefix("``")).toBeNull();           // too few backticks
        expect(parseCodeFencePrefix("text ```js")).toBeNull();   // not at line start
        expect(parseCodeFencePrefix("```js ")).toBeNull();       // language already finished (trailing space)
    });
});

describe("isClosingFence", () => {
    function lineStart(doc: string, lineNumber: number): number {
        const state = EditorState.create({ doc, extensions: [ markdown() ] });
        ensureSyntaxTree(state, doc.length);
        return state.doc.line(lineNumber).from;
    }

    function check(doc: string, lineNumber: number): boolean {
        const state = EditorState.create({ doc, extensions: [ markdown() ] });
        ensureSyntaxTree(state, doc.length);
        return isClosingFence(state, state.doc.line(lineNumber).from);
    }

    it("treats the first fence line of a block as an opener", () => {
        expect(check("```js\ncode\n```", 1)).toBe(false);
    });

    it("treats the terminating fence line as a closer", () => {
        expect(check("```js\ncode\n```", 3)).toBe(true);
    });

    it("treats a new fence after a closed block as an opener", () => {
        // The second block's opener must still offer completions.
        expect(check("```js\ncode\n```\n\n```py\nmore\n```", 5)).toBe(false);
    });

    it("does not flag a plain line as a closing fence", () => {
        expect(check("just a paragraph", 1)).toBe(false);
        // Referencing lineStart keeps the helper used and documents the offset math.
        expect(lineStart("```js\ncode\n```", 3)).toBe(11);
    });
});

describe("buildCodeFenceOptions", () => {
    afterEach(() => vi.restoreAllMocks());

    const mime = (over: Partial<MimeType>): MimeType => ({
        title: "T", mime: "text/x", enabled: true, mdLanguageCode: "x", ...over
    } as MimeType);

    it("emits one option per enabled language, skipping disabled, code-less and duplicate entries", () => {
        vi.spyOn(mime_types, "getMimeTypes").mockReturnValue([
            mime({ mdLanguageCode: "js", title: "JavaScript" }),
            mime({ mdLanguageCode: "py", title: "Python", enabled: false }),  // disabled → skipped
            mime({ mdLanguageCode: undefined, title: "No code" }),            // no language code → skipped
            mime({ mdLanguageCode: "js", title: "JS again" })                 // duplicate code → skipped
        ]);

        expect(buildCodeFenceOptions()).toEqual([{ label: "js", detail: "JavaScript" }]);
    });
});

describe("codeFenceCompletionSource", () => {
    afterEach(() => vi.restoreAllMocks());

    function context(doc: string, pos: number): CompletionContext {
        const state = EditorState.create({ doc, extensions: [ markdown() ] });
        ensureSyntaxTree(state, doc.length);
        return { state, pos } as CompletionContext;
    }

    function withLanguages(...codes: string[]) {
        vi.spyOn(mime_types, "getMimeTypes").mockReturnValue(
            codes.map((code) => ({ title: code, mime: `text/${code}`, enabled: true, mdLanguageCode: code }) as MimeType)
        );
    }

    it("offers the enabled languages right after a fence opener, anchored at the language token", () => {
        withLanguages("js", "py");
        const result = codeFenceCompletionSource(context("```", 3));
        expect(result?.from).toBe(3); // line.from (0) + langStart (3)
        expect(result?.options.map((o) => o.label)).toEqual([ "js", "py" ]);
    });

    it("returns null when the line is not a fence opener", () => {
        withLanguages("js");
        expect(codeFenceCompletionSource(context("plain text", 5))).toBeNull();
    });

    it("returns null on a closing fence, so only openers get language completions", () => {
        withLanguages("js");
        // Cursor on the terminating ``` of `\`\`\`js\ncode\n\`\`\`` — line 3 starts at offset 11.
        expect(codeFenceCompletionSource(context("```js\ncode\n```", 14))).toBeNull();
    });

    it("returns null on a valid opener when no languages are enabled", () => {
        withLanguages(); // none enabled → no options
        expect(codeFenceCompletionSource(context("```", 3))).toBeNull();
    });
});

describe("markdownCompletionAt", () => {
    /** What is found with the caret at `pos`, or at the end. */
    function at(doc: string, pos = doc.length) {
        const state = EditorState.create({ doc, extensions: [ markdown() ], selection: { anchor: pos } });
        ensureSyntaxTree(state, doc.length);
        const line = state.doc.lineAt(pos);
        return markdownCompletionAt(line.text.slice(0, pos - line.from), false, state);
    }

    it("finds a command at the start of a line or after whitespace, from its slash, by what follows it", () => {
        expect(at("/")).toEqual({ kind: "command", from: 0, query: "" });
        expect(at("some text /todo:in-progress")).toEqual({ kind: "command", from: 10, query: "todo:in-progress" });
        expect(at("first\n  /ta")).toEqual({ kind: "command", from: 2, query: "ta" });
    });

    it("finds a note at the start of a line or after whitespace, from its @, by what follows it", () => {
        expect(at("@")).toEqual({ kind: "note", from: 0, query: "" });
        expect(at("see @Alp")).toEqual({ kind: "note", from: 4, query: "Alp" });
        // A title holds spaces, as the text editor's `@` allows, from the last `@` on.
        expect(at("see @My meeting notes")).toEqual({ kind: "note", from: 4, query: "My meeting notes" });
        expect(at("@a and @b c")).toEqual({ kind: "note", from: 7, query: "b c" });
        // An address is no mention.
        expect(at("mail me@example.com")).toBeNull();
    });

    it("finds a note after [[, as a Wikilink is typed, until its brackets close", () => {
        expect(at("see [[")).toEqual({ kind: "note", from: 4, query: "" });
        expect(at("see [[My meeting no")).toEqual({ kind: "note", from: 4, query: "My meeting no" });
        expect(at("word[[Al")).toEqual({ kind: "note", from: 4, query: "Al" });
        expect(at("see [[Al]] then")).toBeNull();
        expect(at("see [Al")).toBeNull();
        // The marker nearest the caret wins.
        expect(at("[[My @Al")).toEqual({ kind: "note", from: 5, query: "Al" });
        expect(at("@My [[Al")).toEqual({ kind: "note", from: 4, query: "Al" });
        expect(at("`[[Al` b", 5)).toBeNull();
        // A `/` inside an open link is part of the title; after an `@` it opens the commands, as in a text note.
        expect(at("[[my /link")).toEqual({ kind: "note", from: 0, query: "my /link" });
        expect(at("@one /table")).toEqual({ kind: "command", from: 5, query: "table" });
        expect(at("text `a @` b", 9)).toBeNull();
    });

    it("finds none inside a word, past a space, or in code", () => {
        expect(at("and/or")).toBeNull();
        expect(at("/table ")).toBeNull();
        expect(at("```js\nconst a = 1 /")).toBeNull();
        expect(at("text `a /` b", 9)).toBeNull();
    });
});

describe("buildSlashCommands", () => {
    let editor: VanillaCodeMirror;
    const triggerCommand = vi.fn();

    beforeEach(() => {
        triggerCommand.mockReset();
        const parent = document.createElement("div");
        document.body.append(parent);
        editor = new VanillaCodeMirror({ parent });
    });

    afterEach(() => editor.destroy());

    let currentNote = { noteId: "first" } as FNote;

    const todo = (name: string, markdownSymbol: string): TaskStateDef => ({ name, title: name, markdownSymbol, isCompleted: false, icon: `bx bx-${name}` });

    function commands(taskStates: TaskStateDef[] = []) {
        return buildSlashCommands({
            parentComponent: { triggerCommand } as unknown as TypeWidgetProps["parentComponent"],
            getNote: () => currentNote,
            editorView: editor,
            taskStates,
            snippets: [ { noteId: "s1", title: "Greeting", description: "Says hello", content: "Hello!" } ]
        });
    }

    /** Puts `doc` in the editor and runs the command `id` on the command typed at its end. */
    function run(id: string, doc: string, taskStates: TaskStateDef[] = []) {
        editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: doc }, selection: { anchor: doc.length } });
        const entry = commands(taskStates).find((candidate) => candidate.id === id);
        if (!entry) throw new Error(`no command ${id}`);
        entry.apply(editor, doc.lastIndexOf("/"), doc.length);
        return editor.state.doc.toString();
    }

    it("titles and draws each command as the text editor does, found by what is typed after the slash too", () => {
        const entries = commands([ todo("done", "x") ]);
        const byId = (id: string) => entries.find((entry) => entry.id === id);

        expect(byId("table")).toMatchObject({ title: "markdown_slash_commands.titles.table", aliases: [ "table", "grid" ] });
        expect(byId("table")?.iconSvg).toContain("<svg");
        expect(byId("tip")?.iconSvg).toContain("<svg");
        expect(byId("todo:done")).toMatchObject({ aliases: expect.arrayContaining([ "todo:done", "done" ]), icon: "bx bx-done" });
        expect(byId("snippet:Greeting")).toMatchObject({ title: "Greeting", description: "Says hello", icon: "bx bx-code-curly" });
        // One run of commands, with no dividers, as the text editor lists them.
        expect(entries.some((entry) => entry.startsGroup)).toBe(false);
    });

    it("replaces the typed command with what it inserts", () => {
        expect(run("snippet:Greeting", "Hi /snip")).toBe("Hi Hello!");
        expect(run("todo:done", "- /todo", [ todo("done", "x") ])).toBe("- [x] ");
        expect(run("todo:done", "/todo", [ todo("done", "x") ])).toBe("- [x] ");
        expect(run("tip", "/tip")).toBe("> [!TIP]\n> ");
    });

    it("numbers a footnote past the highest one, and selects what to type over", () => {
        expect(run("footnote", "a[^2] b /foot")).toBe("a[^2] b [^3]\n\n[^3]: ");
        expect(editor.state.selection.main.head).toBe(editor.state.doc.length);

        run("table", "/table");
        const { from, to } = editor.state.selection.main;
        expect(editor.state.sliceDoc(from, to)).toBe("markdown_slash_commands.placeholders.table_column");
    });

    it("uploads an image picked to the note shown once the file arrives", () => {
        let picker: HTMLInputElement | undefined;
        const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) { picker = this; });
        currentNote = { noteId: "first" } as FNote;

        expect(run("image", "/image")).toBe("");
        expect(picker?.accept).toBe("image/*");

        currentNote = { noteId: "second" } as FNote;
        const file = new File([ "x" ], "a.png", { type: "image/png" });
        if (!picker) throw new Error("no file picker opened");
        Object.defineProperty(picker, "files", { value: [ file ] });
        picker.dispatchEvent(new Event("change"));
        expect(uploadImageAndInsert).toHaveBeenCalledExactlyOnceWith(editor, currentNote, file);
        click.mockRestore();
    });

    it("removes the typed command before running one of the text editor's commands", () => {
        expect(run("date", "On /date")).toBe("On ");
        expect(triggerCommand).toHaveBeenCalledExactlyOnceWith("insertDateTimeToText");
    });
});

describe("useMarkdownCompletions", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    /** Mounts the hook against `editorView`. */
    function mount(editorView: VanillaCodeMirror) {
        function Probe() {
            useMarkdownCompletions({} as TypeWidgetProps["parentComponent"], editorView, { noteId: "n1" } as FNote, () => "root/parent");
            return null;
        }

        act(() => render(h(Probe, {}), container));
    }

    it("registers the list and the fence languages with the editor, and withdraws both on unmount", () => {
        const setNamedExtension = vi.fn();
        const setCompletionSource = vi.fn();
        mount({ setNamedExtension, setCompletionSource } as unknown as VanillaCodeMirror);

        expect(setNamedExtension).toHaveBeenCalledExactlyOnceWith("markdownCompletions", expect.anything());
        expect(setCompletionSource).toHaveBeenCalledExactlyOnceWith("markdownCodeFence", expect.any(Function));

        act(() => render(null, container));
        expect(setNamedExtension).toHaveBeenLastCalledWith("markdownCompletions", []);
        expect(setCompletionSource).toHaveBeenLastCalledWith("markdownCodeFence", null);
    });

    it("lists the commands for what follows a slash, as the text editor does, and runs the one picked", async () => {
        const parent = document.createElement("div");
        document.body.append(parent);
        const editor = new VanillaCodeMirror({ parent });
        mount(editor);
        editor.focus();

        editor.dispatch({ changes: { from: 0, insert: "/tip" }, selection: { anchor: 4 } });
        const rows = () => [ ...document.querySelectorAll(".note-autocomplete-menu [role=option]") ];
        // Found by its title, without the slash.
        await vi.waitFor(() => expect(rows().map((row) => row.textContent)).toEqual([ expect.stringContaining("titles.tip") ]));
        expect(rows()[0]?.querySelector("b")?.textContent).toBe("tip");
        // Sized as the text editor's `/` list is.
        expect(document.querySelector(".note-autocomplete-menu.slash-command-menu")).not.toBeNull();

        // Opened on the best match, so Enter runs it.
        editor.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
        await vi.waitFor(() => expect(editor.state.doc.toString()).toBe("> [!TIP]\n> "));
        await vi.waitFor(() => expect(rows()).toEqual([]));

        act(() => render(null, container));
        editor.destroy();
    });

    it("lists the notes for what follows an @ or a [[, as the text editor does, and links the one picked or created", async () => {
        getNoteSuggestions.mockResolvedValue([
            { notePath: "root/projects/abc123", noteTitle: "Alpha", notePathTitle: "Projects / Alpha", highlightedNotePathTitle: "<b>Al</b>pha" },
            { action: "create-child-note", noteTitle: "Al", parentNoteId: "parent", highlightedNotePathTitle: "Create child note" }
        ]);
        const parent = document.createElement("div");
        document.body.append(parent);
        const editor = new VanillaCodeMirror({ parent });
        mount(editor);
        editor.focus();
        const rows = () => [ ...document.querySelectorAll(".note-autocomplete-menu [role=option]") ];
        const press = (key: string) => editor.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

        editor.dispatch({ changes: { from: 0, insert: "see @Al" }, selection: { anchor: 7 } });
        await vi.waitFor(() => expect(rows()).toHaveLength(2));
        // At most ten notes, and creation under the note being edited.
        expect(getNoteSuggestions).toHaveBeenLastCalledWith("Al", { allowCreatingNotes: true, limit: 10 });

        // Opened on the best match, so Enter links it.
        press("Enter");
        await vi.waitFor(() => expect(editor.state.doc.toString()).toBe("see [[abc123]]"));

        // A note created is linked once it exists, past the dialog taking the focus.
        let created: (notePath: string | undefined) => void = () => {};
        createNoteFromSuggestion.mockReturnValueOnce(new Promise((resolve) => { created = resolve; }));
        editor.dispatch({ changes: { from: 14, insert: " @Al" }, selection: { anchor: 18 } });
        await vi.waitFor(() => expect(rows()).toHaveLength(2));
        press("ArrowDown");
        await new Promise((resolve) => setTimeout(resolve, 0));
        press("Enter");
        await vi.waitFor(() => expect(createNoteFromSuggestion).toHaveBeenCalledWith(expect.objectContaining({ action: "create-child-note" }), "root/parent"));
        editor.contentDOM.blur();
        created("root/parent/new1");
        await vi.waitFor(() => expect(editor.state.doc.toString()).toBe("see [[abc123]] [[new1]]"));

        // After [[ the same list opens, and a pick inside a link already closed takes its brackets too.
        editor.focus();
        editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: "see [[Al" }, selection: { anchor: 8 } });
        await vi.waitFor(() => expect(rows()).toHaveLength(2));
        press("Enter");
        await vi.waitFor(() => expect(editor.state.doc.toString()).toBe("see [[abc123]]"));
        editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: "see [[Al]] x" }, selection: { anchor: 8 } });
        await vi.waitFor(() => expect(rows()).toHaveLength(2));
        press("Enter");
        await vi.waitFor(() => expect(editor.state.doc.toString()).toBe("see [[abc123]] x"));
        expect(editor.state.selection.main.head).toBe(14);

        // So does a note created there, once it exists.
        createNoteFromSuggestion.mockResolvedValueOnce("root/parent/new2");
        editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: "see [[Al]] x" }, selection: { anchor: 8 } });
        await vi.waitFor(() => expect(rows()).toHaveLength(2));
        press("ArrowDown");
        await new Promise((resolve) => setTimeout(resolve, 0));
        press("Enter");
        await vi.waitFor(() => expect(editor.state.doc.toString()).toBe("see [[new2]] x"));

        act(() => render(null, container));
        editor.destroy();
    });
});
