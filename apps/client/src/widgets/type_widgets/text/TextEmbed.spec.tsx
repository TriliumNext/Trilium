import { render } from "preact";
import { useContext } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../../components/app_context";
import NoteContext from "../../../components/note_context";
import FBlob from "../../../entities/fblob";
import type FNote from "../../../entities/fnote";
import froca from "../../../services/froca";
import LoadResults from "../../../services/load_results";
import type { ContentEditor } from "../../../services/content_renderer";
import { buildNote } from "../../../test/easy-froca";
import { useTriliumEvent } from "../../react/hooks";
import { ParentComponent } from "../../react/react_utils";
import type { TypeWidgetProps } from "../type_widget";
import { getContentEmbedTools } from "./content_embed_tools";
import { NestedEmbedContext } from "./editable_embed";
import TextEmbed from "./TextEmbed";

const editorAskedToSave = vi.fn();
const editorProps = vi.fn();
/** What the text editor holds. */
let editorData = "";

/** The text editor, which has a spec of its own. It listens for what a real editor listens for. */
vi.mock("./EditableText", () => ({
    default: (props: TypeWidgetProps) => {
        const isNested = useContext(NestedEmbedContext);
        editorProps({ ...props, isNested });
        useTriliumEvent("beforeNoteContextRemove", editorAskedToSave);
        return (
            <div className="editable-text-stub">
                <div
                    className="ck-editor__editable"
                    ref={(element) => {
                        if (element) {
                            Object.assign(element, { ckeditorInstance: { getData: () => editorData } });
                        }
                    }}
                />
            </div>
        );
    }
}));

const figures: HTMLElement[] = [];

beforeEach(() => {
    // `useEmbeddedNoteContext()` asks the tab manager where the reader is hoisted, and registers
    // its note context with it.
    (appContext as unknown as { tabManager: unknown }).tabManager = {
        getActiveContext: () => undefined,
        getActiveContextNotePath: () => undefined,
        openContextWithNote: async () => undefined,
        registerDetachedContext: () => undefined,
        unregisterDetachedContext: () => undefined
    };
    editorAskedToSave.mockClear();
    editorProps.mockClear();
});

afterEach(() => {
    for (const figure of figures) {
        const box = figure.querySelector(".include-note-content");
        if (box) act(() => render(null, box));
        figure.parentElement?.remove();
    }
    figures.length = 0;
    (appContext as unknown as { tabManager: unknown }).tabManager = undefined;
});

describe("TextEmbed", () => {
    it("uses the floating toolbar inside an editor that has one", async () => {
        const { figure } = await mount(buildTextNote("floating"), buildEditor(), { isEditable: true });
        await vi.waitFor(() => expect(editorProps).toHaveBeenCalled(), { timeout: 5000 });
        const props = editorProps.mock.calls[0][0] as TypeWidgetProps;
        expect(props.viewScope?.floatingToolbar).toBe(true);
        expect(figure.isConnected).toBe(true);
    });

    it("shows the preview, and offers the Editable toggle only where it can edit", async () => {
        const preview = buildPreview("Hello");
        const { figure } = await mount(buildTextNote("hello"), buildEditor(), { preview });
        expect(figure.querySelector(".editable-embed-preview")?.firstChild).toBe(preview);
        expect(getContentEmbedTools(figure)?.hasEditableFlag).toBe(true);
        expect(editorProps).not.toHaveBeenCalled();

        const { figure: locked } = await mount(buildTextNote("locked"), undefined);
        expect(getContentEmbedTools(locked)).toBeNull();
    });

    it("edits in a note context of its own, and saves before the editor goes away", async () => {
        const saveToRecentNotes = vi.spyOn(NoteContext.prototype, "saveToRecentNotes");
        const note = buildTextNote("edited");
        const { figure } = await mount(note, buildEditor(), { isEditable: true, hasFixedToolbar: true });

        // The editor module loads on demand, which takes a while under a busy test run.
        await vi.waitFor(() => expect(editorProps).toHaveBeenCalled(), { timeout: 5000 });
        // Mounted once the note context holds the note, with its view scope from the start.
        const props = editorProps.mock.calls[0][0] as TypeWidgetProps & { isNested: boolean };
        expect(props.note).toBe(note);
        expect(props.ntxId).toMatch(/^_embed_/);
        expect(props.noteContext?.ntxId).toBe(props.ntxId);
        // Inside an editor with a fixed toolbar, that toolbar shows the buttons of this editor.
        expect(props.viewScope).toMatchObject({ viewMode: "default", floatingToolbar: false });
        expect(props.isNested).toBe(true);
        // Editing an included note does not add it to the recent notes.
        expect(saveToRecentNotes).not.toHaveBeenCalled();
        saveToRecentNotes.mockRestore();
        // The plugins of the editor find their host from its DOM.
        const stub = figure.querySelector<HTMLElement>(".editable-text-stub");
        expect(stub && appContext.getComponentByEl(stub)).toBe(props.parentComponent);
        expect(figure.querySelector(".editable-embed-preview")).toBeNull();

        // The title row of the embed shows how the saving of the note goes.
        act(() => props.noteContext?.setContextData("saveState", { state: "error" }));
        await vi.waitFor(() => {
            expect(figure.querySelector(".include-note-badges > .save-status-badge.error"))
                .not.toBeNull();
        });

        await act(async () => {
            delete figure.dataset.editable;
            await Promise.resolve();
        });
        expect(editorAskedToSave).toHaveBeenCalledWith({ ntxIds: [ props.ntxId ] });
        expect(figure.querySelector(".save-status-badge")).toBeNull();
        expect(figure.querySelector(".editable-text-stub")).toBeNull();
        expect(figure.querySelector(".editable-embed-preview")).not.toBeNull();
    });

    it("previews what the editor holds once it closes, before the note saves", async () => {
        const note = buildTextNote("closing");
        const renderPreview = vi.fn(async (content: string) => buildPreview(content));
        let finishSave = () => {};
        editorAskedToSave.mockImplementationOnce(() => new Promise<void>((resolve) => {
            finishSave = resolve;
        }));
        const { figure } = await mount(note, buildEditor(), { isEditable: true, renderPreview });
        await vi.waitFor(() => {
            expect(figure.querySelector(".editable-text-stub")).not.toBeNull();
        }, { timeout: 5000 });

        editorData = "<p>Typed just now</p>";
        await act(async () => {
            delete figure.dataset.editable;
            await Promise.resolve();
        });
        const shownPreview = () => figure.querySelector(".editable-embed-preview")?.innerHTML;
        await vi.waitFor(() => expect(shownPreview()).toBe("<div><p>Typed just now</p></div>"));

        // A save made before the editor closed lands while its last save runs.
        note.getBlob = async () => buildBlob("<p>Typed</p>");
        await act(async () => {
            await reloadNoteContent(note);
            await new Promise((resolve) => setTimeout(resolve, 50));
        });
        expect(shownPreview()).toBe("<div><p>Typed just now</p></div>");
        expect(renderPreview).toHaveBeenCalledExactlyOnceWith("<p>Typed just now</p>");

        // Once the last save lands, the preview follows what the note holds.
        note.getBlob = async () => buildBlob("<p>Saved</p>");
        await act(async () => {
            finishSave();
        });
        await vi.waitFor(() => expect(shownPreview()).toBe("<div><p>Saved</p></div>"));
    });

    it("keeps what the editor held when its last save fails", async () => {
        const note = buildTextNote("failing");
        const { figure } = await mount(note, buildEditor(), { isEditable: true });
        await vi.waitFor(() => expect(editorProps).toHaveBeenCalled(), { timeout: 5000 });
        const { noteContext } = editorProps.mock.calls[0][0] as TypeWidgetProps;
        editorAskedToSave.mockImplementationOnce(async () => {
            noteContext?.setContextData("saveState", { state: "error" });
        });

        editorData = "<p>Not saved yet</p>";
        note.getBlob = async () => buildBlob("<p>Saved before</p>");
        await act(async () => {
            delete figure.dataset.editable;
            await Promise.resolve();
        });
        await settle();
        expect(figure.querySelector(".editable-embed-preview")?.innerHTML)
            .toBe("<div><p>Not saved yet</p></div>");
    });

    it("shows the newest content when reads of the note land out of order", async () => {
        const note = buildTextNote("racing");
        const { figure } = await mount(note, buildEditor(), { isEditable: true });
        await vi.waitFor(() => {
            expect(figure.querySelector(".editable-text-stub")).not.toBeNull();
        }, { timeout: 5000 });

        let finishSave = () => {};
        editorAskedToSave.mockImplementationOnce(() => new Promise<void>((resolve) => {
            finishSave = resolve;
        }));
        editorData = "<p>Closed</p>";
        await act(async () => {
            delete figure.dataset.editable;
            await Promise.resolve();
        });

        // The read that follows the last save of the editor is slow.
        let slowRead = () => {};
        const isRead = vi.fn();
        note.getBlob = () => new Promise((resolve) => {
            isRead();
            slowRead = () => resolve(buildBlob("<p>Older</p>"));
        });
        await act(async () => {
            finishSave();
        });
        await settle();
        expect(isRead).toHaveBeenCalledOnce();

        // Another editor saves the note meanwhile.
        note.getBlob = async () => buildBlob("<p>Newer</p>");
        await act(async () => {
            await reloadNoteContent(note);
        });
        await settle();
        expect(figure.querySelector(".editable-embed-preview")?.innerHTML)
            .toBe("<div><p>Newer</p></div>");
        await act(async () => {
            slowRead();
        });
        await settle();
        expect(figure.querySelector(".editable-embed-preview")?.innerHTML)
            .toBe("<div><p>Newer</p></div>");
    });

    it("shows a save that landed before it listened for saves", async () => {
        const note = buildTextNote("late");
        note.getBlob = async () => buildBlob("<p>Saved meanwhile</p>");
        const { figure } = await mount(note, buildEditor(), { content: "<p>Read before</p>" });
        await settle();
        expect(figure.querySelector(".editable-embed-preview")?.innerHTML)
            .toBe("<div><p>Saved meanwhile</p></div>");
    });

    it("lets another include of the note follow its saves while an editor closes", async () => {
        const note = buildTextNote("shared");
        let finishSave = () => {};
        editorAskedToSave.mockImplementationOnce(() => new Promise<void>((resolve) => {
            finishSave = resolve;
        }));
        const { figure: edited } = await mount(note, buildEditor(), { isEditable: true });
        const { figure: other } = await mount(note, buildEditor());
        await vi.waitFor(() => {
            expect(edited.querySelector(".editable-text-stub")).not.toBeNull();
        }, { timeout: 5000 });

        editorData = "<p>Final</p>";
        await act(async () => {
            delete edited.dataset.editable;
            await Promise.resolve();
        });
        note.getBlob = async () => buildBlob("<p>Final</p>");
        await act(async () => {
            await reloadNoteContent(note);
        });
        await vi.waitFor(() => {
            expect(other.querySelector(".editable-embed-preview")?.innerHTML)
                .toBe("<div><p>Final</p></div>");
        });
        await act(async () => {
            finishSave();
        });
    });

    it("loads the note once the save of the editor it replaces lands", async () => {
        const note = buildTextNote("redrawn");
        const countEditors = () =>
            new Set(editorProps.mock.calls.map(([ props ]) => props.ntxId)).size;
        let finishSave = () => {};
        editorAskedToSave.mockImplementationOnce(() => new Promise<void>((resolve) => {
            finishSave = resolve;
        }));
        const { figure: first } = await mount(note, buildEditor(), { isEditable: true });
        await vi.waitFor(() => expect(countEditors()).toBe(1), { timeout: 5000 });

        // The host draws the embed again, as for a change of its size.
        const firstBox = first.querySelector(".include-note-content");
        expect(firstBox).not.toBeNull();
        await act(async () => {
            if (firstBox) render(null, firstBox);
        });
        expect(editorAskedToSave).toHaveBeenCalledOnce();
        const { figure: second } = await mount(note, buildEditor(), { isEditable: true });
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
        });
        expect(countEditors()).toBe(1);
        expect(second.querySelector(".editable-embed-preview")).not.toBeNull();

        // The content fetched before the save lands is not loaded.
        froca.blobPromises[`notes-${note.noteId}`] = Promise.resolve(null);
        await act(async () => {
            finishSave();
        });
        await vi.waitFor(() => expect(countEditors()).toBe(2), { timeout: 5000 });
        expect(froca.blobPromises[`notes-${note.noteId}`]).toBeUndefined();
        expect(second.querySelector(".editable-text-stub")).not.toBeNull();
    });
});

interface MountOptions {
    preview?: HTMLElement;
    isEditable?: boolean;
    /** Whether the editor around the embed has a fixed toolbar, rather than a floating one. */
    hasFixedToolbar?: boolean;
    renderPreview?: (content: string) => Promise<HTMLElement>;
    /** The content that the host read for the embed, instead of the content of the note. */
    content?: string;
}

/** Renders `TextEmbed` in the markup of an embed, as the host does. */
async function mount(note: FNote, editor: ContentEditor | undefined, options: MountOptions = {}) {
    const figure = document.createElement("figure");
    figure.className = "include-note";
    if (options.isEditable) {
        figure.dataset.editable = "true";
    }
    // The markup of `ContentEmbed`, with the slot for the badges in its title row.
    const wrapper = document.createElement("div");
    wrapper.className = "include-note-wrapper";
    wrapper.innerHTML = `<div class="include-note-title-row">`
        + `<div class="note-badges include-note-badges"></div></div>`
        + `<div class="include-note-body"><div class="include-note-content"></div></div>`;
    const box = wrapper.querySelector(".include-note-content");
    if (!box) throw new Error("Expected the content box.");
    figure.append(wrapper);
    // The editable root of the text editor that shows the embed.
    const hostRoot = document.createElement("div");
    hostRoot.className = "ck-editor__editable";
    const toolbar = options.hasFixedToolbar ? { element: document.createElement("div") } : undefined;
    Object.assign(hostRoot, { ckeditorInstance: { ui: { view: { toolbar } } } });
    hostRoot.append(figure);
    document.body.append(hostRoot);
    figures.push(figure);

    const content = options.content ?? (await note.getBlob())?.content ?? "";
    await act(async () => {
        render(
            <ParentComponent.Provider value={appContext}>
                <TextEmbed
                    note={note}
                    editor={editor}
                    content={content}
                    preview={options.preview ?? buildPreview(content)}
                    renderPreview={options.renderPreview ?? (async (html) => buildPreview(html))}
                />
            </ParentComponent.Provider>,
            box
        );
    });
    return { figure };
}

function buildTextNote(id: string) {
    const root = froca.notes["root"] ?? buildNote({ id: "root", title: "root" });
    const note = buildNote({ id, title: id, type: "text", content: `<p>${id}</p>` });
    root.children.push(note.noteId);
    note.parents.push(root.noteId);
    return note;
}

function buildEditor(): ContentEditor {
    return {
        canEdit: () => true,
        getUnsavedContent: () => undefined,
        scheduleSave: vi.fn(),
        release: vi.fn()
    };
}

/** Lets the reads, renders and effects that are under way finish. */
async function settle() {
    for (let i = 0; i < 3; i++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
        });
    }
}

/** Announces a save of the content of `note`, as the server does. */
async function reloadNoteContent(note: FNote) {
    const loadResults = new LoadResults([]);
    loadResults.addNoteContent(note.noteId, "other-component");
    await appContext.handleEvent("entitiesReloaded", { loadResults });
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

function buildPreview(content: string) {
    const div = document.createElement("div");
    div.innerHTML = content;
    return div;
}
