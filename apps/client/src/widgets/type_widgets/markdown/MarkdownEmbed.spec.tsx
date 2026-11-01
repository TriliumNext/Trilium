import type VanillaCodeMirror from "@triliumnext/codemirror";
import moveVerticalIcon from "boxicons/svg/regular/bx-move-vertical.svg?raw";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import Component from "../../../components/component";
import type FNote from "../../../entities/fnote";
import attributes from "../../../services/attributes";
import type { ContentEditor } from "../../../services/content_renderer";
import options from "../../../services/options";
import {
    buildCodeViewTextEditor, getEmbedMenuItems, runEmbedMenuItem, summarizeMenuItem
} from "../../../test/content_embed";
import { buildNote } from "../../../test/easy-froca";
import { CodeMirrorFindTarget } from "../../find_in_code";
import { ParentComponent } from "../../react/react_utils";
import {
    enterContentEmbed, getContentEmbedTools, getEmbedFindTarget
} from "../text/content_embed_tools";
import MarkdownEmbed from "./MarkdownEmbed";

vi.mock("../../../services/i18n", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    t: (key: string) => key
}));
// The `/` list of the source loads the task states from the `_taskStates` subtree.
vi.mock("../../../services/task_states", () => ({ getTaskStateDefinitions: async () => [] }));

// `CodeEditor` reads the theme as a string.
options.set("codeNoteTheme", "");

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

describe("MarkdownEmbed", () => {
    it("shows the preview, offers the display modes, and Editable where it can edit", async () => {
        const note = buildMarkdownNote("# Title");
        const preview = buildPreview("# Title");
        const { figure } = await mount(note, buildEditor(), { preview });
        expect(figure.querySelector(".editable-embed-preview")?.firstChild).toBe(preview);
        expect(figure.querySelector(".note-detail-split.split-read-only")).not.toBeNull();
        expect(figure.querySelector(".cm-editor")).toBeNull();
        expect(getContentEmbedTools(figure)).toMatchObject({
            hasDisplayModes: true, hasEditableFlag: true, boxSizeIcon: moveVerticalIcon
        });
        expect(moveVerticalIcon).toContain("<svg");

        const readOnly = buildNote({
            title: "Fixed", type: "code", mime: "text/x-markdown", content: "", "#readOnly": ""
        });
        for (const [ entity, editor ] of [
            [ note, buildEditor({ canEdit: () => false }) ],
            [ note, undefined ],
            [ readOnly, buildEditor() ]
        ] as const) {
            const { figure: locked } = await mount(entity, editor);
            expect(getContentEmbedTools(locked)).toMatchObject({
                hasDisplayModes: true, hasEditableFlag: false, boxSizeIcon: moveVerticalIcon
            });
        }
    });

    it("shows the source read-only beside the preview, or alone, as the embed picks", async () => {
        const editor = buildEditor();
        const { figure } = await mount(buildMarkdownNote("a"), editor, {
            embedAttributes: { "data-display-mode": "split" }
        });
        const split = figure.querySelector(".note-detail-split");
        const view = await findView(figure);
        expect(view.state.doc.toString()).toBe("a");
        expect(view.state.readOnly).toBe(true);
        expect(split?.className).not.toMatch(/split-(read-only|source-only)/);
        expect(figure.querySelector(".editable-embed-preview")).not.toBeNull();

        await act(async () => {
            figure.dataset.displayMode = "source";
            await Promise.resolve();
        });
        expect(split?.classList.contains("split-source-only")).toBe(true);
        expect(figure.querySelector(".markdown-embed-content.with-source")).not.toBeNull();

        // Formatting shortcuts change only a source that is edited.
        pressCtrl(view, "b");
        expect(view.state.doc.toString()).toBe("a");
        expect(editor.scheduleSave).not.toHaveBeenCalled();
    });

    it("edits in split view while Editable is on, and previews the edits", async () => {
        const editor = buildEditor();
        const renderPreview = vi.fn(async (content: string) => buildPreview(content));
        const { figure } = await mount(buildMarkdownNote("a"), editor, {
            isEditable: true, renderPreview
        });
        const view = await findView(figure);
        expect(view.state.readOnly).toBe(false);
        expect(figure.querySelector(".editable-embed-preview")).not.toBeNull();

        act(() => view.dispatch({ changes: { from: 1, insert: "b" }, selection: { anchor: 2 } }));
        expect(editor.scheduleSave).toHaveBeenCalledOnce();
        expect(vi.mocked(editor.scheduleSave).mock.calls[0][0]()).toBe("ab");
        await vi.waitFor(() => {
            expect(figure.querySelector(".editable-embed-preview")?.textContent).toBe("ab");
        });
        expect(renderPreview).toHaveBeenLastCalledWith("ab");

        pressCtrl(view, "b");
        expect(view.state.doc.toString()).toBe("ab****");

        // Turning Editable off closes the editor, and shows the preview of the edits.
        await act(async () => {
            delete figure.dataset.editable;
            await Promise.resolve();
        });
        expect(editor.release).toHaveBeenCalledOnce();
        expect(figure.querySelector(".cm-editor")).toBeNull();
        expect(figure.querySelector(".note-detail-split.split-read-only")).not.toBeNull();
    });

    it("searches and takes the caret into the source only while it shows", async () => {
        const { figure } = await mount(buildMarkdownNote("a"), buildEditor(), {
            isEditable: true
        });
        const view = await findView(figure);
        expect(getEmbedFindTarget(figure)).toBeInstanceOf(CodeMirrorFindTarget);
        let isEntered = false;
        act(() => {
            isEntered = enterContentEmbed(figure, "end");
        });
        expect(isEntered).toBe(true);
        expect(view.hasFocus).toBe(true);
        await getEmbedFindTarget(figure)?.find("a", { matchCase: false, wholeWord: false });
        expect(view.getSearchMatches()).toHaveLength(1);

        await showDisplayMode(figure, "preview");
        expect(getEmbedFindTarget(figure)).toBeNull();
        expect(enterContentEmbed(figure, "start")).toBe(false);
        expect(view.getSearchMatches()).toHaveLength(0);

        await showDisplayMode(figure, "split");
        expect(getEmbedFindTarget(figure)).toBeInstanceOf(CodeMirrorFindTarget);
        act(() => {
            isEntered = enterContentEmbed(figure, "start");
        });
        expect(isEntered).toBe(true);
    });

    it("keeps the edited source, its undo history and cursor, behind the preview", async () => {
        const { figure } = await mount(buildMarkdownNote("a"), buildEditor(), {
            isEditable: true
        });
        const view = await findView(figure);
        act(() => view.dispatch({ changes: { from: 1, insert: "b" }, selection: { anchor: 2 } }));

        await showDisplayMode(figure, "preview");
        await showDisplayMode(figure, "split");
        expect(await findView(figure)).toBe(view);
        expect(view.state.selection.main.head).toBe(2);
        pressCtrl(view, "z");
        expect(view.state.doc.toString()).toBe("a");
    });

    it("wraps and numbers the lines of the source as the menu of its embed sets", async () => {
        const setLabel = vi.spyOn(attributes, "setLabel").mockResolvedValue(undefined);
        const { textEditor, editable } = buildCodeViewTextEditor();
        const note = buildNote({
            title: "Readme", type: "code", mime: "text/x-markdown", content: "a",
            "#wrapLines": "true"
        });
        const { figure } = await mount(note, buildEditor(), {
            embedAttributes: { "data-display-mode": "source", "data-code-line-numbers": "false" },
            container: editable
        });
        const view = await findView(figure);
        expect(view.contentDOM.classList.contains("cm-lineWrapping")).toBe(true);
        expect(figure.querySelector(".cm-lineNumbers")).toBeNull();
        expect(getEmbedMenuItems(figure).map(summarizeMenuItem)).toMatchObject([
            { title: "note_actions.word_wrap", items: [ {}, { checked: true }, {} ] },
            { title: "link_context_menu.line_numbers", items: [ {}, {}, { checked: true } ] }
        ]);

        // The line wrapping of a note is its `#wrapLines` label.
        await runEmbedMenuItem(figure, 0, 2);
        expect(setLabel).toHaveBeenCalledWith(note.noteId, "wrapLines", "false");
        await runEmbedMenuItem(figure, 1, 1);
        expect(textEditor.execute)
            .toHaveBeenCalledWith("setContentEmbedCodeView", { lineNumbers: true });
        await vi.waitFor(() => expect(figure.querySelector(".cm-lineNumbers")).not.toBeNull());

        // Content that cannot be edited offers neither.
        const { figure: locked } = await mount(note, buildEditor({ canEdit: () => false }));
        expect(getEmbedMenuItems(locked)).toEqual([]);
    });
});

/** Picks the display mode `mode` on the embed `figure`. */
async function showDisplayMode(figure: HTMLElement, mode: string) {
    await act(async () => {
        figure.dataset.displayMode = mode;
        await Promise.resolve();
    });
}

interface MountOptions {
    isEditable?: boolean;
    preview?: HTMLElement;
    renderPreview?: (content: string) => Promise<HTMLElement>;
    /** Attributes of the embed, such as `data-display-mode`. */
    embedAttributes?: Record<string, string>;
    /** The element the embed goes in, such as the editable root of a text editor. */
    container?: HTMLElement;
}

/** Renders `MarkdownEmbed` in the markup of an embed, as the host does. */
async function mount(
    entity: FNote,
    editor: ContentEditor | undefined,
    options: MountOptions = {}
) {
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

    const content = (await entity.getBlob())?.content ?? "";
    await act(async () => {
        render(
            <ParentComponent.Provider value={parent}>
                <MarkdownEmbed
                    entity={entity}
                    editor={editor}
                    content={content}
                    preview={options.preview ?? buildPreview(content)}
                    renderPreview={options.renderPreview ?? (async (text) => buildPreview(text))}
                />
            </ParentComponent.Provider>,
            box
        );
    });
    return { figure };
}

function buildMarkdownNote(content: string) {
    return buildNote({ title: "Readme", type: "code", mime: "text/x-markdown", content });
}

/** An editor that holds the content of its last save as unsaved, as the host does until it saves. */
function buildEditor(overrides: Partial<ContentEditor> = {}): ContentEditor {
    let unsavedContent: string | undefined;
    return {
        canEdit: () => true,
        getUnsavedContent: () => unsavedContent,
        scheduleSave: vi.fn((getContent: () => string) => {
            unsavedContent = getContent();
        }),
        release: vi.fn(),
        ...overrides
    };
}

function buildPreview(content: string) {
    const preview = document.createElement("div");
    preview.className = "ck-content markdown-preview";
    preview.textContent = content;
    return preview;
}

/** Presses Ctrl and `key` in the content of `view`. */
function pressCtrl(view: { contentDOM: HTMLElement }, key: string) {
    act(() => {
        view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
            key, ctrlKey: true, bubbles: true, cancelable: true
        }));
    });
}

/** The CodeMirror view in `figure`, once it has mounted. */
async function findView(figure: HTMLElement) {
    const { EditorView } = await import("@codemirror/view");
    let view: InstanceType<typeof EditorView> | null = null;
    await vi.waitFor(() => {
        const dom = figure.querySelector(".cm-editor");
        view = dom instanceof HTMLElement ? EditorView.findFromDOM(dom) : null;
        expect(view).not.toBeNull();
    }, { timeout: 5000 });
    if (!view) throw new Error("CodeMirror did not mount.");
    return view as VanillaCodeMirror;
}
