import { render } from "preact";
import { useContext } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../../components/app_context";
import type FNote from "../../../entities/fnote";
import froca from "../../../services/froca";
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

/** The text editor, which has a spec of its own. It listens for what a real editor listens for. */
vi.mock("./EditableText", () => ({
    default: (props: TypeWidgetProps) => {
        const isNested = useContext(NestedEmbedContext);
        editorProps({ ...props, isNested });
        useTriliumEvent("beforeNoteContextRemove", editorAskedToSave);
        return <div className="editable-text-stub" />;
    }
}));

const figures: HTMLElement[] = [];

beforeEach(() => {
    // `useEmbeddedNoteContext()` asks the tab manager where the reader is hoisted.
    (appContext as unknown as { tabManager: unknown }).tabManager = {
        getActiveContext: () => undefined,
        getActiveContextNotePath: () => undefined,
        openContextWithNote: async () => undefined
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
});

interface MountOptions {
    preview?: HTMLElement;
    isEditable?: boolean;
    /** Whether the editor around the embed has a fixed toolbar, rather than a floating one. */
    hasFixedToolbar?: boolean;
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

    const content = (await note.getBlob())?.content ?? "";
    await act(async () => {
        render(
            <ParentComponent.Provider value={appContext}>
                <TextEmbed
                    note={note}
                    editor={editor}
                    content={content}
                    preview={options.preview ?? buildPreview(content)}
                    renderPreview={async () => buildPreview(content)}
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

function buildPreview(content: string) {
    const div = document.createElement("div");
    div.innerHTML = content;
    return div;
}
