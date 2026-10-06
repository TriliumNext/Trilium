import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import Component from "../../../components/component";
import FAttachment from "../../../entities/fattachment";
import FBlob from "../../../entities/fblob";
import type FNote from "../../../entities/fnote";
import type { ContentEditor } from "../../../services/content_renderer";
import froca from "../../../services/froca";
import LoadResults from "../../../services/load_results";
import options from "../../../services/options";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import { getContentEmbedTools } from "../text/content_embed_tools";
import CodeEmbed from "./CodeEmbed";

const renderCodePreview = vi.hoisted(() => vi.fn(async (content: string, _mime: string) => {
    const pre = document.createElement("pre");
    pre.textContent = content;
    return pre;
}));
vi.mock("../../../services/content_renderer", () => ({ renderCodePreview }));

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
});

describe("CodeEmbed", () => {
    it("shows the preview, and offers the Editable toggle only where it can edit", async () => {
        const note = buildCodeNote("print(1)");
        const preview = buildPreview("print(1)");
        const { figure } = await mount(note, buildEditor(), { preview });
        expect(figure.querySelector(".editable-embed-preview")?.firstChild).toBe(preview);
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
        expect(figure.querySelector(".editable-embed-preview")).toBeNull();
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
            expect(figure.querySelector(".editable-embed-preview")?.textContent).toBe("ab");
        });
        expect(figure.querySelector(".cm-editor")).toBeNull();
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
        await vi.waitFor(() => {
            expect(renderCodePreview).toHaveBeenLastCalledWith("ab", "text/x-python");
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
    mime?: string;
    preview?: HTMLElement;
    isEditable?: boolean;
}

/** Renders `CodeEmbed` in the markup of an embed, as the host does. */
async function mount(
    entity: FNote | FAttachment,
    editor: ContentEditor,
    options: MountOptions = {}
) {
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
                    entity={entity}
                    editor={editor}
                    content={options.content ?? (await entity.getBlob())?.content ?? content}
                    mime={options.mime ?? entity.mime}
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
