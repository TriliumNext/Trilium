import { AttributeEditor, EmbedHistory } from "@triliumnext/ckeditor5";
import VanillaCodeMirror from "@triliumnext/codemirror";
import moveVerticalIcon from "boxicons/svg/regular/bx-move-vertical.svg?raw";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import Component from "../../../components/component";
import type { SaveState } from "../../../components/note_context";
import FAttachment from "../../../entities/fattachment";
import FBlob from "../../../entities/fblob";
import type FNote from "../../../entities/fnote";
import contextMenu from "../../../menus/context_menu";
import attributes from "../../../services/attributes";
import type { ContentEditor } from "../../../services/content_renderer";
import froca from "../../../services/froca";
import LoadResults from "../../../services/load_results";
import options from "../../../services/options";
import search from "../../../services/search";
import {
    buildCodeViewTextEditor, getEmbedMenuItems, runEmbedMenuItem, summarizeMenuItem
} from "../../../test/content_embed";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import { CodeMirrorFindTarget } from "../../find_in_code";
import { NoteSaves } from "../text/attachment_saves";
import { getContentEmbedTools, getEmbedFindTarget } from "../text/content_embed_tools";
import EmbedHistories from "../text/embed_history";
import CodeEmbed, { InlineCodeEmbed } from "./CodeEmbed";

vi.mock("../../../services/i18n", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    t: (key: string, values?: Record<string, unknown>) =>
        values ? `${key} ${Object.values(values).join(" ")}` : key
}));

// `CodeEditor` reads the theme as a string, and the line numbers set to Auto from the option.
options.set("codeNoteTheme", "");
options.set("codeLineNumbersEnabled", "true");

const parent = new Component();
const figures: HTMLElement[] = [];

afterEach(() => {
    for (const figure of figures) {
        const box = figure.querySelector(".include-note-content");
        if (box) act(() => render(null, box));
        figure.remove();
    }
    figures.length = 0;
    vi.restoreAllMocks();
});

describe("CodeEmbed", () => {
    it("shows the content read-only, and offers the Editable toggle only where it can edit", async () => {
        const note = buildCodeNote("print(1)");
        const { figure } = await mount(note, buildEditor());
        const view = await findView(figure, true);
        expect([ view.state.doc.toString(), view.state.readOnly ]).toEqual([ "print(1)", true ]);
        const tools = getContentEmbedTools(figure);
        expect([ tools?.hasEditableFlag, tools?.boxSizeIcon, tools?.hiddenToolbarItems ])
            .toEqual([ true, moveVerticalIcon, undefined ]);
        expect(moveVerticalIcon).toContain("<svg");

        const { figure: locked } = await mount(note, buildEditor({ canEdit: () => false }), {
            isEditable: true
        });
        expect((await findView(locked, true)).state.readOnly).toBe(true);
        expectBoxSizeIconAlone(locked);

        const readOnly = buildNote({
            title: "Fixed", type: "code", mime: "text/x-python", content: "", "#readOnly": ""
        });
        const { figure: fixed } = await mount(readOnly, buildEditor());
        expectBoxSizeIconAlone(fixed);

        // Without an editor, as in a read-only text note.
        const { figure: shown } = await mount(note, undefined, { isEditable: true });
        const shownView = await findView(shown, true);
        expect([ shownView.state.doc.toString(), shownView.state.readOnly ])
            .toEqual([ "print(1)", true ]);
        expectBoxSizeIconAlone(shown);
    });

    it("edits with CodeMirror while the toggle is on, and saves only the changes", async () => {
        const editor = buildEditor();
        const { figure } = await mount(buildCodeNote("print(1)"), editor, { isEditable: true });

        const view = await findView(figure);
        expect([ view.state.doc.toString(), view.state.readOnly ]).toEqual([ "print(1)", false ]);
        expect(figure.querySelector(".code-embed-editor.read-only")).toBeNull();
        expect(editor.scheduleSave).not.toHaveBeenCalled();

        act(() => view.dispatch({ changes: { from: 0, insert: "# " } }));
        expect(editor.scheduleSave).toHaveBeenCalledOnce();
        const getContent = vi.mocked(editor.scheduleSave).mock.calls[0][0];
        expect(getContent()).toBe("# print(1)");
    });

    it("lists the snippets of its language after a slash while the toggle is on", async () => {
        const snippet = buildNote({
            title: "Greeting", type: "code", mime: "text/x-python", content: "print('hi')"
        });
        const searchForNotes = vi.spyOn(search, "searchForNotes").mockResolvedValue([ snippet ]);
        const { figure } = await mount(buildCodeNote(""), buildEditor(), { isEditable: true });
        const view = await findView(figure);
        expect(searchForNotes).toHaveBeenCalledWith("#snippet");

        view.focus();
        const rows = () => [
            ...document.querySelectorAll(".note-autocomplete-menu [role=option]")
        ];
        // Typed again until the snippets have loaded, as a list opens only where it has entries.
        await vi.waitFor(() => {
            act(() => view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: "/" },
                selection: { anchor: 1 }
            }));
            expect(rows().map((row) => row.textContent))
                .toEqual([ expect.stringContaining("Greeting") ]);
        });
        view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
            key: "Enter", bubbles: true, cancelable: true
        }));
        await vi.waitFor(() => expect(view.state.doc.toString()).toBe("print('hi')"));
    });

    it("lets the find search the editor, and replace only while it edits", async () => {
        const { figure } = await mount(buildCodeNote("print(1)\nprint(2)"), buildEditor(), {
            isEditable: true
        });
        const view = await findView(figure);
        const target = getEmbedFindTarget(figure);
        if (!(target instanceof CodeMirrorFindTarget)) throw new Error("Expected a code target.");
        const onContentChange = vi.fn();
        const stopWatching = target.watchContent(onContentChange);

        expect(await target.find("print", { matchCase: false, wholeWord: false })).toBe(2);
        expect(figure.querySelectorAll(".cm-activeMatch")).toHaveLength(0);
        act(() => target.highlight(1));
        expect(figure.querySelectorAll(".cm-activeMatch")).toHaveLength(1);
        act(() => target.highlight(null));
        expect(figure.querySelectorAll(".cm-activeMatch")).toHaveLength(0);
        expect(target.getFirstMatchBelow(-Infinity)).toBe(0);
        expect(target.getFirstMatchBelow(Infinity)).toBeNull();
        expect(onContentChange).not.toHaveBeenCalled();

        expect(await target.replace(1, "log")).toBe(1);
        expect(view.state.doc.toString()).toBe("print(1)\nlog(2)");
        expect(onContentChange).toHaveBeenCalledOnce();
        expect(target.close(0)).toBe(true);
        expect([ view.state.selection.main.from, view.state.selection.main.to ]).toEqual([ 0, 5 ]);
        stopWatching();
        act(() => view.dispatch({ changes: { from: 0, insert: "#" } }));
        expect(onContentChange).toHaveBeenCalledOnce();

        await act(async () => {
            delete figure.dataset.editable;
            await Promise.resolve();
        });
        expect(await findView(figure, true)).toBe(view);
        expect(getEmbedFindTarget(figure)).toBe(target);
        expect(await target.find("print", { matchCase: false, wholeWord: false })).toBe(1);
        expect(target.canReplace()).toBe(false);
        expect(await target.replace(0, "log")).toBe(1);
        expect(await target.replaceAll("log")).toBe(1);
        expect(view.state.doc.toString()).toBe("#print(1)\nlog(2)");
    });

    it("keeps its edits on the text note's undo stack, read-only and remounted too", async () => {
        const element = document.createElement("div");
        document.body.append(element);
        const textEditor = await AttributeEditor.create(element, {
            licenseKey: "GPL", extraPlugins: [ EmbedHistory ]
        });
        const histories = new EmbedHistories(() => textEditor);
        const note = buildCodeNote("x");
        const editor = buildSavingEditor(note, histories);
        const { figure } = await mount(note, editor, { isEditable: true });
        let view = await findView(figure);
        const outside = vi.fn();
        figure.addEventListener("keydown", outside);

        // Content saved elsewhere loads outside the undo stack.
        note.getBlob = async () => buildBlob("a");
        const noteSaved = new LoadResults([]);
        noteSaved.addNoteContent(note.noteId, "any-component");
        await act(async () => {
            await parent.handleEvent("entitiesReloaded", { loadResults: noteSaved });
        });
        await vi.waitFor(() => expect(view.state.doc.toString()).toBe("a"));
        expect(textEditor.commands.get("undo")?.isEnabled).toBe(false);

        act(() => view.dispatch({ changes: { from: 1, insert: "b" }, userEvent: "input.type" }));
        act(() => textEditor.execute("undo"));
        expect([ view.state.doc.toString(), editor.getUnsavedContent() ]).toEqual([ "a", "a" ]);
        act(() => textEditor.execute("redo"));
        expect([ view.state.doc.toString(), editor.getUnsavedContent() ]).toEqual([ "ab", "ab" ]);

        // The undo keys of the embed undo the note, while read-only as well.
        await act(async () => {
            delete figure.dataset.editable;
            await Promise.resolve();
        });
        view = await findView(figure, true);
        act(() => pressKey(view.contentDOM, "z"));
        expect(view.state.doc.toString()).toBe("a");
        expect(outside).not.toHaveBeenCalled();

        // The next step applies to a remounted editor.
        const box = figure.querySelector(".include-note-content");
        if (box) act(() => render(null, box));
        figure.remove();
        const { figure: remounted } = await mount(note, editor, {
            isEditable: true, content: editor.getUnsavedContent()
        });
        view = await findView(remounted);
        act(() => pressKey(view.contentDOM, "y"));
        expect([ view.state.doc.toString(), editor.getUnsavedContent() ]).toEqual([ "ab", "ab" ]);

        await textEditor.destroy();
        element.remove();
    });

    it("switches the same CodeMirror to editing and back, and releases the edits", async () => {
        const note = buildCodeNote("a");
        const editor = buildSavingEditor(note);
        const { figure } = await mount(note, editor);
        const view = await findView(figure, true);

        await act(async () => {
            figure.dataset.editable = "true";
            await Promise.resolve();
        });
        expect(await findView(figure)).toBe(view);
        expect(view.state.readOnly).toBe(false);
        act(() => view.dispatch({ changes: { from: 1, insert: "b" } }));
        expect(editor.getUnsavedContent()).toBe("ab");

        await act(async () => {
            delete figure.dataset.editable;
            await Promise.resolve();
        });
        expect(editor.getUnsavedContent()).toBe("ab");
        expect(await findView(figure, true)).toBe(view);
        expect([ view.state.doc.toString(), view.state.readOnly ]).toEqual([ "ab", true ]);
        expect(figure.querySelectorAll(".cm-editor")).toHaveLength(1);
    });

    it("offers the language and tab width menus of a note on the toolbar of its embed", async () => {
        options.set("codeNoteTabWidth", "4");
        options.set("codeNoteIndentWithTabs", "false");
        options.set("codeNotesMimeTypes", JSON.stringify([ "text/x-python" ]));
        vi.spyOn(contextMenu, "show").mockResolvedValue(undefined);
        let unsavedContent: string | undefined;
        const editor = buildEditor({
            getUnsavedContent: () => unsavedContent,
            scheduleSave: vi.fn((getContent: () => string) => {
                unsavedContent = getContent();
            })
        });
        const { figure } = await mount(buildCodeNote("if a:\n    b"), editor);
        const tools = getContentEmbedTools(figure);
        expect(tools?.hasEditableFlag).toBe(true);
        expect(tools?.getTools().map(({ id, label, text, opensMenu }) => ({
            id, label, text, opensMenu
        }))).toEqual([
            {
                id: "codeLanguage", label: "status_bar.code_note_switcher", text: "Python",
                opensMenu: true
            },
            {
                id: "tabWidth", label: "status_bar.tab_width_title",
                text: "status_bar.tab_width_spaces_short 4", opensMenu: true
            }
        ]);

        const reindentTo = (title: string) => selectMenuItem(figure, "tabWidth", title, true);
        const getLastSave = () => vi.mocked(editor.scheduleSave).mock.lastCall?.[0]();

        // The content, which is saved, and which the read-only editor shows.
        const readOnlyView = await findView(figure, true);
        await reindentTo("status_bar.tab_width_style_tabs");
        expect(getLastSave()).toBe("if a:\n\tb");
        await vi.waitFor(() => expect(readOnlyView.state.doc.toString()).toBe("if a:\n\tb"));

        // The editor while it is open, then the content again once it closes.
        await act(async () => {
            figure.dataset.editable = "true";
            await Promise.resolve();
        });
        const view = await findView(figure);
        act(() => view.dispatch({ changes: { from: 0, insert: "# " } }));
        await reindentTo("status_bar.tab_width_spaces 8");
        expect(view.state.doc.toString()).toBe("# if a:\n        b");
        await act(async () => {
            delete figure.dataset.editable;
            await Promise.resolve();
        });
        await reindentTo("status_bar.tab_width_spaces 2");
        expect(getLastSave()).toBe("# if a:\n    b");
        const closedView = await findView(figure, true);
        await vi.waitFor(() => expect(closedView.state.doc.toString()).toBe("# if a:\n    b"));
    });

    it("re-indents another embed's unsaved changes as a step of the note's undo", async () => {
        options.set("codeNoteTabWidth", "4");
        options.set("codeNoteIndentWithTabs", "false");
        options.set("codeNotesMimeTypes", JSON.stringify([ "text/x-python" ]));
        vi.spyOn(contextMenu, "show").mockResolvedValue(undefined);
        const element = document.createElement("div");
        document.body.append(element);
        const textEditor = await AttributeEditor.create(element, {
            licenseKey: "GPL", extraPlugins: [ EmbedHistory ]
        });
        const note = buildCodeNote("if a:\n    b");
        const editor = buildSavingEditor(note, new EmbedHistories(() => textEditor));
        const { figure: editing } = await mount(note, editor, { isEditable: true });
        const { figure: previewing } = await mount(note, editor);
        const view = await findView(editing);
        act(() => view.dispatch({ changes: { from: 0, insert: "# " } }));

        await selectMenuItem(previewing, "tabWidth", "status_bar.tab_width_style_tabs", true);
        expect(editor.getUnsavedContent()).toBe("# if a:\n\tb");
        act(() => textEditor.execute("undo"));
        expect(editor.getUnsavedContent()).toBe("# if a:\n    b");

        await textEditor.destroy();
        element.remove();
    });

    it("keeps the language and indentation of a file in its embed, set from its toolbar", async () => {
        options.set("codeNoteTabWidth", "4");
        options.set("codeNoteIndentWithTabs", "false");
        options.set("codeNotesMimeTypes", JSON.stringify([ "text/x-python", "text/x-sh" ]));
        vi.spyOn(contextMenu, "show").mockResolvedValue(undefined);
        const setMimeType = vi.spyOn(VanillaCodeMirror.prototype, "setMimeType");
        const editor = buildEditor();
        const { textEditor, editable } = buildCodeViewTextEditor();
        const { figure } = await mount(buildAttachment("script.py"), editor, {
            content: "if a:\n  b",
            mime: "text/x-python",
            codeLanguage: "text/x-sh",
            embedAttributes: { "data-code-language": "text/x-sh", "data-code-tab-width": "2" },
            container: editable
        });
        const tools = getContentEmbedTools(figure);
        expect(tools?.hasEditableFlag).toBe(true);
        expect(tools?.getTools().map((tool) => tool.text))
            .toEqual([ "Shell (bash)", "status_bar.tab_width_spaces_short 2" ]);
        await findView(figure, true);
        expect(setMimeType).toHaveBeenLastCalledWith("text/x-sh");

        const select = (id: string, title: string, isReindent = false) =>
            selectMenuItem(figure, id, title, isReindent);

        // The language of the file's name is its default, which the embed then leaves out.
        await select("codeLanguage", "Python");
        expect(textEditor.execute)
            .toHaveBeenLastCalledWith("setContentEmbedCodeView", { language: null });
        await vi.waitFor(() => expect(setMimeType).toHaveBeenLastCalledWith("text/x-python"));
        await select("codeLanguage", "Plain text");
        expect(figure.getAttribute("data-code-language")).toBe("text/plain");
        await vi.waitFor(() => expect(setMimeType).toHaveBeenLastCalledWith("text/plain"));

        // The indentation, which a re-indent sets with the content, as one change.
        await select("tabWidth", "status_bar.tab_width_style_tabs");
        await select("tabWidth", "status_bar.tab_width_spaces 4", true);
        expect(vi.mocked(editor.scheduleSave).mock.lastCall?.[0]()).toBe("if a:\n    b");
        expect(textEditor.execute.mock.calls.slice(-2).map(([ , codeView ]) => codeView))
            .toEqual([
                { tabWidth: undefined, indentWithTabs: true },
                { tabWidth: 4, indentWithTabs: false }
            ]);
        expect([ "data-code-tab-width", "data-code-indent-with-tabs" ]
            .map((name) => figure.getAttribute(name))).toEqual([ "4", "false" ]);

        // CodeMirror follows the indentation of the embed.
        figure.setAttribute("data-code-tab-width", "2");
        figure.setAttribute("data-code-indent-with-tabs", "true");
        await act(async () => {
            figure.dataset.editable = "true";
            await Promise.resolve();
        });
        const view = await findView(figure);
        const { indentUnit } = await import("@codemirror/language");
        expect([ view.state.tabSize, view.state.facet(indentUnit) ]).toEqual([ 2, "\t" ]);

        // Nothing changes without the text editor of the embed.
        textEditor.execute.mockClear();
        textEditor.selectEmbedAt.mockReturnValue(false);
        await select("tabWidth", "status_bar.tab_width_spaces 8");
        expect(textEditor.execute).not.toHaveBeenCalled();
    });

    it("offers the line wrapping and line numbers of a note in the menu of its embed", async () => {
        const setLabel = vi.spyOn(attributes, "setLabel").mockResolvedValue(undefined);
        const removeLabel = vi.spyOn(attributes, "removeOwnedLabelByName")
            .mockResolvedValue(undefined as never);
        const { textEditor, editable } = buildCodeViewTextEditor();
        const note = buildNote({
            title: "Script", type: "code", mime: "text/x-python", content: "a",
            "#wrapLines": "false"
        });
        const { figure } = await mount(note, buildEditor(), {
            hasCodeLineNumbers: false,
            embedAttributes: { "data-code-line-numbers": "false" },
            container: editable
        });
        expect(getEmbedMenuItems(figure).map(summarizeMenuItem)).toEqual([
            {
                title: "note_actions.word_wrap",
                items: [
                    { title: "note_actions.word_wrap_auto", checked: false },
                    { title: "note_actions.word_wrap_on", checked: false },
                    { title: "note_actions.word_wrap_off", checked: true }
                ]
            },
            {
                title: "link_context_menu.line_numbers",
                items: [
                    { title: "link_context_menu.line_numbers_auto", checked: false },
                    { title: "link_context_menu.line_numbers_on", checked: false },
                    { title: "link_context_menu.line_numbers_off", checked: true }
                ]
            }
        ]);
        const view = await findView(figure, true);
        expect(view.contentDOM.classList.contains("cm-lineWrapping")).toBe(false);
        expect(figure.querySelector(".cm-lineNumbers")).toBeNull();

        // The line wrapping is the `#wrapLines` label of the note.
        await runEmbedMenuItem(figure, 0, 0);
        expect(removeLabel).toHaveBeenCalledWith(note, "wrapLines");
        await runEmbedMenuItem(figure, 0, 1);
        expect(setLabel).toHaveBeenCalledWith(note.noteId, "wrapLines", "true");
        expect(textEditor.execute).not.toHaveBeenCalled();

        // The line numbers are kept in the embed, as the note has no label for them.
        await runEmbedMenuItem(figure, 1, 0);
        expect(textEditor.execute)
            .toHaveBeenLastCalledWith("setContentEmbedCodeView", { lineNumbers: null });
        await vi.waitFor(() => {
            expect(summarizeMenuItem(getEmbedMenuItems(figure)[1])).toMatchObject({
                items: [ { checked: true }, { checked: false }, { checked: false } ]
            });
        });
        await vi.waitFor(() => expect(figure.querySelector(".cm-lineNumbers")).not.toBeNull());
        await runEmbedMenuItem(figure, 1, 1);
        expect(figure.getAttribute("data-code-line-numbers")).toBe("true");
    });

    it("keeps the line wrapping and the line numbers of a file in its embed", async () => {
        const { textEditor, editable } = buildCodeViewTextEditor();
        const { figure } = await mount(buildAttachment("script.py"), buildEditor(), {
            content: "a",
            mime: "text/x-python",
            isCodeWrapped: true,
            embedAttributes: { "data-code-wrap-lines": "true" },
            container: editable
        });
        expect(getEmbedMenuItems(figure).map(summarizeMenuItem)).toMatchObject([
            {
                items: [
                    { checked: false },
                    { checked: true },
                    { checked: false }
                ]
            },
            { items: [ { checked: true }, { checked: false }, { checked: false } ] }
        ]);
        const view = await findView(figure, true);
        expect(view.contentDOM.classList.contains("cm-lineWrapping")).toBe(true);
        expect(figure.querySelector(".cm-lineNumbers")).not.toBeNull();

        await runEmbedMenuItem(figure, 0, 2);
        expect(textEditor.execute)
            .toHaveBeenLastCalledWith("setContentEmbedCodeView", { wrapLines: false });
        await runEmbedMenuItem(figure, 1, 2);
        expect(textEditor.execute)
            .toHaveBeenLastCalledWith("setContentEmbedCodeView", { lineNumbers: false });
        expect([ "data-code-wrap-lines", "data-code-line-numbers" ]
            .map((name) => figure.getAttribute(name))).toEqual([ "false", "false" ]);
        await vi.waitFor(() => {
            expect(view.contentDOM.classList.contains("cm-lineWrapping")).toBe(false);
            expect(figure.querySelector(".cm-lineNumbers")).toBeNull();
        });

        // The editor follows the embed as well.
        await runEmbedMenuItem(figure, 0, 1);
        await act(async () => {
            figure.dataset.editable = "true";
            await Promise.resolve();
        });
        const editingView = await findView(figure);
        expect(editingView.contentDOM.classList.contains("cm-lineWrapping")).toBe(true);
        expect(figure.querySelector(".cm-lineNumbers")).toBeNull();
        await runEmbedMenuItem(figure, 1, 1);
        await vi.waitFor(() => expect(figure.querySelector(".cm-lineNumbers")).not.toBeNull());
    });

    it("numbers the lines of an embed set to Auto as the global option does", async () => {
        options.set("codeLineNumbersEnabled", "false");
        try {
            const { figure } = await mount(buildCodeNote("a"), buildEditor());
            await findView(figure, true);
            expect(figure.querySelector(".cm-lineNumbers")).toBeNull();

            const { figure: numbered } = await mount(buildCodeNote("a"), buildEditor(), {
                hasCodeLineNumbers: true,
                embedAttributes: { "data-code-line-numbers": "true" }
            });
            await findView(numbered, true);
            expect(numbered.querySelector(".cm-lineNumbers")).not.toBeNull();
        } finally {
            options.set("codeLineNumbersEnabled", "true");
        }
    });

    it("highlights an attachment with the MIME type it is given", async () => {
        const attachment = new FAttachment(froca, {
            attachmentId: "script1",
            ownerId: "owner",
            role: "file",
            mime: "text/plain",
            title: "script.py",
            dateModified: "",
            utcDateModified: "",
            utcDateScheduledForErasureSince: "",
            contentLength: 0
        } as never);
        const setMimeType = vi.spyOn(VanillaCodeMirror.prototype, "setMimeType");
        const { figure } = await mount(attachment, buildEditor(), {
            content: "a",
            mime: "text/x-python",
            isEditable: true
        });
        const view = await findView(figure);
        act(() => view.dispatch({ changes: { from: 1, insert: "b" } }));

        await act(async () => {
            delete figure.dataset.editable;
            await Promise.resolve();
        });
        const readOnlyView = await findView(figure, true);
        expect(readOnlyView.state.doc.toString()).toBe("ab");
        expect(new Set(setMimeType.mock.calls.map(([ mime ]) => mime)))
            .toEqual(new Set([ "text/x-python" ]));
    });

    it("wraps the lines while read-only as the `#wrapLines` label of its note changes", async () => {
        const note = buildNote({
            title: "Script", type: "code", mime: "text/x-python", content: "a", "#wrapLines": "true"
        });
        const { figure } = await mount(note, buildEditor());
        const view = await findView(figure, true);
        expect(view.contentDOM.classList.contains("cm-lineWrapping")).toBe(true);

        const [ label ] = note.getOwnedLabels("wrapLines");
        label.value = "false";
        const labelChanged = new LoadResults([ {
            entityName: "attributes", entityId: label.attributeId, hash: "", isSynced: true,
            isErased: false, entity: {
                attributeId: label.attributeId, noteId: note.noteId, type: "label",
                name: "wrapLines", value: "false", isDeleted: false
            }
        } as never ]);
        labelChanged.addAttribute(label.attributeId, "other");
        await act(async () => {
            await parent.handleEvent("entitiesReloaded", { loadResults: labelChanged });
        });

        await vi.waitFor(() => {
            expect(view.contentDOM.classList.contains("cm-lineWrapping")).toBe(false);
        });
    });

    it("follows each save of its note or attachment, its own included, while it has no changes", async () => {
        const note = buildCodeNote("one");
        const editor = buildEditor();
        const { figure } = await mount(note, editor, { content: "one", isEditable: true });
        const view = await findView(figure);

        // A save of this embed, or of another embed of the same note.
        note.getBlob = async () => buildBlob("two");
        const noteSaved = new LoadResults([]);
        noteSaved.addNoteContent(note.noteId, "any-component");
        await act(async () => {
            await parent.handleEvent("entitiesReloaded", { loadResults: noteSaved });
        });
        await vi.waitFor(() => expect(view.state.doc.toString()).toBe("two"));

        // An embed without an editor, which shows the note read-only.
        const { figure: shown } = await mount(note, undefined);
        const shownView = await findView(shown, true);
        note.getBlob = async () => buildBlob("three");
        await act(async () => {
            await parent.handleEvent("entitiesReloaded", { loadResults: noteSaved });
        });
        await vi.waitFor(() => expect(shownView.state.doc.toString()).toBe("three"));

        const attachment = buildAttachment("script.py");
        const { figure: attachmentFigure } = await mount(attachment, buildEditor(), {
            content: "a",
            isEditable: true
        });
        const attachmentView = await findView(attachmentFigure);
        attachment.getBlob = async () => buildBlob("b");
        const attachmentSaved = new LoadResults([]);
        attachmentSaved.addAttachmentRow({ attachmentId: attachment.attachmentId } as never, "any");
        await act(async () => {
            await parent.handleEvent("entitiesReloaded", { loadResults: attachmentSaved });
        });
        await vi.waitFor(() => expect(attachmentView.state.doc.toString()).toBe("b"));
    });

    it("keeps the latest attachment content when an older fetch resolves last", async () => {
        const attachment = buildAttachment("script.py");
        const { figure } = await mount(attachment, buildEditor(), {
            content: "a",
            isEditable: true
        });
        const view = await findView(figure);
        const resolvers: ((blob: FBlob) => void)[] = [];
        attachment.getBlob = () => new Promise((resolve) => resolvers.push(resolve));
        const saved = new LoadResults([]);
        saved.addAttachmentRow({ attachmentId: attachment.attachmentId } as never, "any");
        await act(async () => {
            await parent.handleEvent("entitiesReloaded", { loadResults: saved });
            await parent.handleEvent("entitiesReloaded", { loadResults: saved });
        });
        expect(resolvers).toHaveLength(2);

        await act(async () => {
            resolvers[1](buildBlob("new"));
        });
        await vi.waitFor(() => expect(view.state.doc.toString()).toBe("new"));
        await act(async () => {
            resolvers[0](buildBlob("old"));
            await new Promise((resolve) => setTimeout(resolve, 50));
        });
        expect(view.state.doc.toString()).toBe("new");
    });

    it("shows the latest content once shown, when hidden fetches land out of order", async () => {
        const container = document.body.appendChild(document.createElement("div"));
        const attachment = buildAttachment("script.py");
        const { figure } = await mount(attachment, buildEditor(), {
            content: "a",
            isEditable: true,
            container
        });
        const view = await findView(figure);
        const resizeCallbacks: ((entries: unknown[]) => void)[] = [];
        const { ResizeObserver } = globalThis;
        globalThis.ResizeObserver = class {
            constructor(callback: (entries: unknown[]) => void) {
                resizeCallbacks.push(callback);
            }
            observe() {}
            disconnect() {}
        } as unknown as typeof ResizeObserver;

        try {
            container.style.display = "none";
            const resolvers: ((blob: FBlob) => void)[] = [];
            attachment.getBlob = () => new Promise((resolve) => resolvers.push(resolve));
            const saved = new LoadResults([]);
            saved.addAttachmentRow({ attachmentId: attachment.attachmentId } as never, "any");
            await act(async () => {
                await parent.handleEvent("entitiesReloaded", { loadResults: saved });
                await parent.handleEvent("entitiesReloaded", { loadResults: saved });
            });
            await act(async () => {
                resolvers[1](buildBlob("new"));
            });
            await act(async () => {
                resolvers[0](buildBlob("old"));
            });
            expect(view.state.doc.toString()).toBe("a");

            container.style.display = "";
            await act(async () => {
                for (const callback of resizeCallbacks) callback([]);
            });
            await vi.waitFor(() => expect(view.state.doc.toString()).toBe("new"));
        } finally {
            globalThis.ResizeObserver = ResizeObserver;
            container.remove();
        }
    });

    it("shows how the saving goes in the title row of its embed while it edits", async () => {
        const listeners = new Set<() => void>();
        let state: SaveState = "unsaved";
        const editor = buildEditor({
            getSaveState: () => state,
            subscribeSaveState: (listener) => {
                listeners.add(listener);
                return () => listeners.delete(listener);
            }
        });
        const { figure } = await mount(buildCodeNote("x"), editor, {
            content: "x",
            isEditable: true
        });
        const findBadge = (name: string) =>
            figure.querySelector(`.include-note-badges > .save-status-badge.${name}`);
        await vi.waitFor(() => expect(findBadge("unsaved")).not.toBeNull());

        act(() => {
            state = "error";
            for (const listener of listeners) listener();
        });
        await vi.waitFor(() => expect(findBadge("error")).not.toBeNull());

        await act(async () => {
            delete figure.dataset.editable;
            await Promise.resolve();
        });
        expect(figure.querySelector(".save-status-badge")).toBeNull();
    });

    it("loads the note as saved elsewhere, unless it has unsaved changes", async () => {
        const { figure } = await mount(buildCodeNote("saved"), buildEditor(), {
            content: "stale",
            isEditable: true
        });
        const view = await findView(figure);
        await vi.waitFor(() => expect(view.state.doc.toString()).toBe("saved"));

        const { figure: changed } = await mount(
            buildCodeNote("saved"),
            buildEditor({ getUnsavedContent: () => "unsaved" }),
            { content: "unsaved", isEditable: true }
        );
        const changedView = await findView(changed);
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
        });
        expect(changedView.state.doc.toString()).toBe("unsaved");
    });
});

describe("InlineCodeEmbed", () => {
    function getLabel(figure: HTMLElement) {
        return figure.querySelector("pre.code-embed-editor")?.getAttribute("data-language");
    }

    it("shows the code in the language of its embed, named while it can edit", async () => {
        const setMimeType = vi.spyOn(VanillaCodeMirror.prototype, "setMimeType");
        const { editable } = buildCodeViewTextEditor();
        const { figure } = await mountInline("pass", buildEditor(), {
            language: "text-x-python", container: editable
        });

        const view = await findView(figure, true);
        expect([ view.state.doc.toString(), view.state.readOnly ]).toEqual([ "pass", true ]);
        expect(setMimeType).toHaveBeenLastCalledWith("text/x-python");
        await vi.waitFor(() => expect(getLabel(figure)).toBe("Python"));
        const tools = getContentEmbedTools(figure);
        // The menu of the embed offers the box size and the Editable toggle.
        expect([ tools?.hasEditableFlag, tools?.boxSizeIcon, tools?.hiddenToolbarItems ]).toEqual([
            true, moveVerticalIcon, [ "contentEmbedBoxSizeDropdown", "toggleContentEmbedEditable" ]
        ]);

        // Without an editor, as in a read-only text note, in a language that names no MIME type.
        const { figure: shown } = await mountInline("x", undefined, {
            language: "text-x-trilium-auto"
        });
        await findView(shown, true);
        await vi.waitFor(() => expect(setMimeType).toHaveBeenLastCalledWith("text/plain"));
        expect(getLabel(shown)).toBeNull();
        expectBoxSizeIconAlone(shown);
    });

    it("edits the code, follows the code the note writes, and sets its language", async () => {
        options.set("codeNotesMimeTypes", JSON.stringify([ "text/x-python", "text/x-sh" ]));
        vi.spyOn(contextMenu, "show").mockResolvedValue(undefined);
        const setMimeType = vi.spyOn(VanillaCodeMirror.prototype, "setMimeType");
        let unsavedContent: string | undefined;
        const editor = buildEditor({
            getUnsavedContent: () => unsavedContent,
            scheduleSave: vi.fn((getContent: () => string) => {
                unsavedContent = getContent();
            })
        });
        const { textEditor, editable } = buildCodeViewTextEditor();
        const { figure, rerender } = await mountInline("a", editor, {
            language: "text-x-python", isEditable: true, container: editable
        });

        const view = await findView(figure);
        act(() => view.dispatch({ changes: { from: 1, insert: "b" } }));
        expect(unsavedContent).toBe("ab");

        // Once written, the code that the note holds replaces the shown code.
        unsavedContent = undefined;
        await rerender("c");
        expect(view.state.doc.toString()).toBe("c");
        unsavedContent = "c, edited";
        await rerender("d");
        expect(view.state.doc.toString()).toBe("c");

        await selectMenuItem(figure, "codeLanguage", "Shell (bash)");
        expect(textEditor.execute)
            .toHaveBeenLastCalledWith("setContentEmbedCodeView", { language: "text/x-sh" });
        await act(async () => {
            figure.dataset.language = "text-x-sh";
            await Promise.resolve();
        });
        await vi.waitFor(() => expect(setMimeType).toHaveBeenLastCalledWith("text/x-sh"));
        expect(getLabel(figure)).toBe("Shell (bash)");
    });
});

interface InlineMountOptions extends Pick<MountOptions, "isEditable" | "container"> {
    language: string;
}

/** Renders `InlineCodeEmbed` in the markup of an embed, as the host does. */
async function mountInline(
    content: string,
    editor: ContentEditor | undefined,
    { language, isEditable, container }: InlineMountOptions
) {
    const { figure, box } = buildFigure({
        isEditable, container, embedAttributes: { "data-language": language }
    });
    const renderContent = (shown: string) => render(
        <ParentComponent.Provider value={parent}>
            <InlineCodeEmbed content={shown} editor={editor} language={language} />
        </ParentComponent.Provider>,
        box
    );

    await act(async () => renderContent(content));
    return {
        figure,
        rerender: (shown: string) => act(async () => renderContent(shown))
    };
}

interface MountOptions {
    content?: string;
    mime?: string;
    codeLanguage?: string;
    isCodeWrapped?: boolean;
    hasCodeLineNumbers?: boolean;
    isEditable?: boolean;
    /** Attributes of the embed, such as `data-code-language`. */
    embedAttributes?: Record<string, string>;
    /** The element the embed goes in, such as the editable root of a text editor. */
    container?: HTMLElement;
}

/** Renders `CodeEmbed` in the markup of an embed, as the host does. */
async function mount(
    entity: FNote | FAttachment,
    editor: ContentEditor | undefined,
    options: MountOptions = {}
) {
    const content = options.content ?? "";
    const { figure, box } = buildFigure(options);

    await act(async () => {
        render(
            <ParentComponent.Provider value={parent}>
                <CodeEmbed
                    entity={entity}
                    editor={editor}
                    content={options.content ?? (await entity.getBlob())?.content ?? content}
                    mime={options.mime ?? entity.mime}
                    codeLanguage={options.codeLanguage}
                    isCodeWrapped={options.isCodeWrapped}
                    hasCodeLineNumbers={options.hasCodeLineNumbers}
                />
            </ParentComponent.Provider>,
            box
        );
    });
    return { figure };
}

/** The markup of an embed in the page, with the box that its content renders in. */
function buildFigure(options: MountOptions) {
    const figure = document.createElement("figure");
    figure.className = "include-note";
    if (options.isEditable) {
        figure.dataset.editable = "true";
    }
    for (const [ name, value ] of Object.entries(options.embedAttributes ?? {})) {
        figure.setAttribute(name, value);
    }
    const wrapper = document.createElement("div");
    wrapper.className = "include-note-wrapper";
    const titleRow = document.createElement("div");
    titleRow.className = "include-note-title-row";
    const badges = document.createElement("div");
    badges.className = "include-note-badges";
    titleRow.append(badges);
    const box = document.createElement("div");
    box.className = "include-note-content";
    wrapper.append(titleRow, box);
    figure.append(wrapper);
    (options.container ?? document.body).append(figure);
    figures.push(figure);
    return { figure, box };
}

function buildCodeNote(content: string) {
    return buildNote({ title: "Script", type: "code", mime: "text/x-python", content });
}

function buildEditor(overrides: Partial<ContentEditor> = {}): ContentEditor {
    return {
        canEdit: () => true,
        getUnsavedContent: () => undefined,
        scheduleSave: vi.fn(),
        release: vi.fn(),
        ...overrides
    };
}

/** An editor of `note` over real `NoteSaves`, which the embeds given it share as a host's do. */
function buildSavingEditor(note: FNote, histories?: EmbedHistories): ContentEditor {
    const saves = new NoteSaves(() => {}, undefined);
    return {
        canEdit: () => true,
        getUnsavedContent: () => saves.getUnsavedContent(note.noteId),
        scheduleSave: (getContent, onSaved) => saves.scheduleSave(note, getContent, onSaved),
        release: () => saves.release(note.noteId),
        history: histories?.get(note.noteId, (text) => saves.scheduleSave(note, () => text))
    };
}

/** Presses Ctrl and `key` in `target`. */
function pressKey(target: HTMLElement, key: string) {
    target.dispatchEvent(new KeyboardEvent("keydown", {
        key, ctrlKey: true, bubbles: true, cancelable: true
    }));
}

/**
 * Runs the item `title` of the toolbar menu `id` of `figure`, from the "Re-indent" part of the
 * menu when `isReindent`. `contextMenu.show` must be mocked.
 */
async function selectMenuItem(figure: HTMLElement, id: string, title: string, isReindent = false) {
    getContentEmbedTools(figure)?.openMenu?.(id, document.createElement("button"));
    const items = vi.mocked(contextMenu.show).mock.lastCall?.[0].items ?? [];
    const item = (isReindent ? items.slice(-7) : items)
        .find((candidate) => "title" in candidate && candidate.title === title);
    if (!item || "kind" in item) throw new Error(`No item titled ${title}.`);
    await act(async () => item.handler?.(item, new MouseEvent("click")));
}

/** Asserts that the toolbar of the embed `figure` shows the box size as an icon, and no tools. */
function expectBoxSizeIconAlone(figure: HTMLElement) {
    const tools = getContentEmbedTools(figure);
    expect([ tools?.hasEditableFlag, tools?.boxSizeIcon ]).toEqual([ false, moveVerticalIcon ]);
    expect([ tools?.getTools(), tools?.getMenuItems?.() ]).toEqual([ [], [] ]);
}

/** The editing or the read-only CodeMirror view in `figure`, once the editor module has loaded. */
async function findView(figure: HTMLElement, isReadOnly = false) {
    const { EditorView } = await import("@codemirror/view");
    const selector = isReadOnly ? ".read-only" : ":not(.read-only)";
    let view: InstanceType<typeof EditorView> | null = null;
    await vi.waitFor(() => {
        const dom = figure.querySelector(`pre.code-embed-editor${selector} > .cm-editor`);
        view = dom instanceof HTMLElement ? EditorView.findFromDOM(dom) : null;
        expect(view).not.toBeNull();
    }, { timeout: 5000 });
    if (!view) throw new Error("CodeMirror did not mount.");
    return view as InstanceType<typeof EditorView>;
}

function buildBlob(content: string) {
    return new FBlob({
        blobId: `blob-${content}`,
        content,
        contentLength: content.length,
        dateModified: "",
        utcDateModified: ""
    });
}

function buildAttachment(title: string) {
    return new FAttachment(froca, {
        attachmentId: `att-${title}`,
        ownerId: "owner",
        role: "file",
        mime: "text/plain",
        title,
        dateModified: "",
        utcDateModified: "",
        utcDateScheduledForErasureSince: "",
        contentLength: 0
    } as never);
}
