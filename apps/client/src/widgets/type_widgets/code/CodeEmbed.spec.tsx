import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../../entities/fnote";
import type { ContentEditor } from "../../../services/content_renderer";
import options from "../../../services/options";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import { getContentEmbedTools } from "../text/content_embed_tools";
import CodeEmbed from "./CodeEmbed";

vi.mock("../../../services/content_renderer", () => ({
    renderCodePreview: async (content: string) => buildPreview(content)
}));

// `CodeEditor` reads the theme as a string.
options.set("codeNoteTheme", "");

const parent = { registerHandler() {}, removeHandler() {}, componentId: "embed-test" } as any;
const figures: HTMLElement[] = [];

afterEach(() => {
    for (const figure of figures) {
        const box = figure.querySelector(".include-note-content");
        if (box) act(() => render(null, box));
        figure.remove();
    }
    figures.length = 0;
});

describe("CodeEmbed", () => {
    it("shows the preview, and offers the Editable toggle only where it can edit", async () => {
        const note = buildCodeNote("print(1)");
        const preview = buildPreview("print(1)");
        const { figure } = await mount(note, buildEditor(), { preview });
        expect(figure.querySelector(".code-embed-preview")?.firstChild).toBe(preview);
        expect(getContentEmbedTools(figure)?.hasEditableFlag).toBe(true);

        const { figure: locked } = await mount(note, buildEditor({ canEdit: () => false }));
        expect(getContentEmbedTools(locked)).toBeNull();

        const readOnly = buildNote({
            title: "Fixed", type: "code", mime: "text/x-python", content: "", "#readOnly": ""
        });
        const { figure: fixed } = await mount(readOnly, buildEditor());
        expect(getContentEmbedTools(fixed)).toBeNull();
    });

    it("edits with CodeMirror while the toggle is on, and saves only the changes", async () => {
        const editor = buildEditor();
        const { figure } = await mount(buildCodeNote("print(1)"), editor, { isEditable: true });

        const view = await findView(figure);
        expect(view.state.doc.toString()).toBe("print(1)");
        expect(figure.querySelector(".code-embed-preview")).toBeNull();
        expect(editor.scheduleSave).not.toHaveBeenCalled();

        act(() => view.dispatch({ changes: { from: 0, insert: "# " } }));
        expect(editor.scheduleSave).toHaveBeenCalledOnce();
        const getContent = vi.mocked(editor.scheduleSave).mock.calls[0][0];
        expect(getContent()).toBe("# print(1)");
    });

    it("releases the editor and previews the edited content once the toggle goes off", async () => {
        const editor = buildEditor();
        const { figure } = await mount(buildCodeNote("a"), editor, { isEditable: true });
        const view = await findView(figure);
        act(() => view.dispatch({ changes: { from: 1, insert: "b" } }));

        await act(async () => {
            delete figure.dataset.editable;
            await Promise.resolve();
        });

        expect(editor.release).toHaveBeenCalledOnce();
        await vi.waitFor(() => {
            expect(figure.querySelector(".code-embed-preview")?.textContent).toBe("ab");
        });
        expect(figure.querySelector(".cm-editor")).toBeNull();
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

interface MountOptions {
    content?: string;
    preview?: HTMLElement;
    isEditable?: boolean;
}

/** Renders `CodeEmbed` in the markup of an embed, as the host does. */
async function mount(note: FNote, editor: ContentEditor, options: MountOptions = {}) {
    const content = options.content ?? "";
    const figure = document.createElement("figure");
    figure.className = "include-note";
    if (options.isEditable) {
        figure.dataset.editable = "true";
    }
    const box = document.createElement("div");
    box.className = "include-note-content";
    figure.append(box);
    document.body.append(figure);
    figures.push(figure);

    await act(async () => {
        render(
            <ParentComponent.Provider value={parent}>
                <CodeEmbed
                    entity={note}
                    editor={editor}
                    content={options.content ?? (await note.getBlob())?.content ?? content}
                    preview={options.preview ?? buildPreview(content)}
                />
            </ParentComponent.Provider>,
            box
        );
    });
    return { figure };
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
        componentId: "host",
        ...overrides
    };
}

function buildPreview(content: string) {
    const pre = document.createElement("pre");
    pre.textContent = content;
    return pre;
}

/** The CodeMirror view in `figure`, once the editor module has loaded. */
async function findView(figure: HTMLElement) {
    const { EditorView } = await import("@codemirror/view");
    let view: InstanceType<typeof EditorView> | null = null;
    await vi.waitFor(() => {
        const dom = figure.querySelector(".cm-editor");
        view = dom instanceof HTMLElement ? EditorView.findFromDOM(dom) : null;
        expect(view).not.toBeNull();
    }, { timeout: 5000 });
    if (!view) throw new Error("CodeMirror did not mount.");
    return view as InstanceType<typeof EditorView>;
}
