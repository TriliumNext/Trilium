import { render } from "preact";
import { useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ContentEditor } from "../../../services/content_renderer";
import options from "../../../services/options";
import { buildNote } from "../../../test/easy-froca";
import { type ContentEmbedToolProvider, getContentEmbedTools } from "./content_embed_tools";
import {
    type EditableEmbedOptions, NestedEmbedContext, useEditableEmbed, useEmbedEditors,
    useEmbedPreview, useNestedEditor
} from "./editable_embed";

const figures: HTMLElement[] = [];

afterEach(() => {
    for (const figure of figures) {
        const box = figure.querySelector(".include-note-content");
        if (box) act(() => render(null, box));
        figure.remove();
    }
    figures.length = 0;
    options.set("databaseReadonly", "false");
});

describe("useEditableEmbed", () => {
    it("can edit with an editor that saves, unless the note or database is read-only", async () => {
        const editable = await mountProbe({ editor: buildEditor(), note: null });
        expect(editable.state).toEqual({ canEdit: true, isEditing: false });
        expect(getContentEmbedTools(editable.figure)?.hasEditableFlag).toBe(true);

        const readOnly: Array<Partial<EditableEmbedOptions>> = [
            { editor: undefined },
            { editor: buildEditor(false) },
            { note: buildNote({ title: "Fixed", "#readOnly": "" }) }
        ];
        for (const overrides of readOnly) {
            const { state, figure } =
                await mountProbe({ editor: buildEditor(), note: null, ...overrides });
            expect(state.canEdit).toBe(false);
            expect(getContentEmbedTools(figure)).toBeNull();
        }

        options.set("databaseReadonly", "true");
        expect((await mountProbe({ editor: buildEditor(), note: null })).state.canEdit).toBe(false);
    });

    it("edits while the Editable toggle of the embed is on", async () => {
        const probe = await mountProbe({ editor: buildEditor(), note: null }, { isEditable: true });
        expect(probe.state).toEqual({ canEdit: true, isEditing: true });

        await act(async () => {
            delete probe.figure.dataset.editable;
            await Promise.resolve();
        });
        expect(probe.state).toEqual({ canEdit: true, isEditing: false });

        const locked =
            await mountProbe({ editor: buildEditor(false), note: null }, { isEditable: true });
        expect(locked.state).toEqual({ canEdit: false, isEditing: false });
    });

    it("adds the buttons it is given, or none for content that adds its own", async () => {
        const tools = { hasEditableFlag: true } as ContentEmbedToolProvider;
        const custom = await mountProbe({ editor: buildEditor(), note: null, tools });
        expect(getContentEmbedTools(custom.figure)).toBe(tools);

        const own = await mountProbe({ editor: buildEditor(), note: null, tools: null });
        expect(getContentEmbedTools(own.figure)).toBeNull();
    });

    it("passes the focus of the embed box to its target, also once it renders", async () => {
        const { figure, root } = await mountProbe({
            editor: buildEditor(),
            note: null,
            focusTarget: ".target"
        });
        const box = figure.querySelector<HTMLElement>(".include-note-content");
        box?.focus();
        expect(document.activeElement).toBe(box);

        const target = document.createElement("div");
        target.className = "target";
        target.tabIndex = -1;
        root?.append(target);
        await vi.waitFor(() => expect(document.activeElement).toBe(target));

        box?.focus();
        expect(document.activeElement).toBe(target);
    });
});

describe("useEmbedEditors", () => {
    it("passes the editors on, except from a host nested in an embed", () => {
        const editors = { noteEditor: "notes", attachmentEditor: "attachments" };
        const results: object[] = [];
        function Probe() {
            results.push(useEmbedEditors(editors));
            return null;
        }

        const container = document.createElement("div");
        act(() => render(<Probe />, container));
        act(() => render(
            <NestedEmbedContext.Provider value={true}><Probe /></NestedEmbedContext.Provider>,
            container
        ));

        expect(results).toEqual([ editors, {} ]);
        act(() => render(null, container));
    });
});

describe("useEmbedPreview", () => {
    it("renders no preview while paused, and the latest one once resumed", async () => {
        const initial = document.createElement("pre");
        const rendered = document.createElement("pre");
        const renderPreview = vi.fn(async () => rendered);
        let preview: HTMLElement | undefined;
        function Probe({ previewKey, isPaused }: { previewKey: string; isPaused: boolean }) {
            preview = useEmbedPreview(initial, previewKey, renderPreview, isPaused);
            return null;
        }

        const container = document.createElement("div");
        await act(async () => render(<Probe previewKey="a" isPaused />, container));
        await act(async () => render(<Probe previewKey="b" isPaused />, container));
        await act(async () => render(<Probe previewKey="c" isPaused />, container));
        expect(renderPreview).not.toHaveBeenCalled();
        expect(preview).toBe(initial);

        await act(async () => render(<Probe previewKey="c" isPaused={false} />, container));
        await vi.waitFor(() => expect(preview).toBe(rendered));
        expect(renderPreview).toHaveBeenCalledOnce();
        act(() => render(null, container));
    });

    it("keeps the first preview for its key, and renders one for any other key", async () => {
        const initial = document.createElement("pre");
        const rendered = document.createElement("pre");
        const renderPreview = vi.fn(async () => rendered);
        let preview: HTMLElement | undefined;
        function Probe({ previewKey }: { previewKey: string }) {
            preview = useEmbedPreview(initial, previewKey, renderPreview);
            return null;
        }

        const container = document.createElement("div");
        await act(async () => render(<Probe previewKey="a" />, container));
        expect(preview).toBe(initial);
        expect(renderPreview).not.toHaveBeenCalled();

        await act(async () => render(<Probe previewKey="b" />, container));
        await vi.waitFor(() => expect(preview).toBe(rendered));
        expect(renderPreview).toHaveBeenCalledOnce();

        await act(async () => render(<Probe previewKey="a" />, container));
        expect(preview).toBe(initial);
        expect(renderPreview).toHaveBeenCalledOnce();
        act(() => render(null, container));
    });
});

describe("useNestedEditor", () => {
    it("follows the focus between the editor of a note and an editor nested in it", () => {
        const split = buildEditable({ ntxId: "ntx1" });
        const host = buildEditable({ parent: split, editor: buildFakeEditor() });
        const nestedEditor = buildFakeEditor();
        const nested = buildEditable({ parent: host, editor: nestedEditor });
        const caption = buildEditable({ parent: nested, isNestedEditable: true });
        const otherSplit = buildEditable({ ntxId: "ntx2" });
        const otherNested = buildEditable({
            parent: buildEditable({ parent: otherSplit, editor: buildFakeEditor() }),
            editor: buildFakeEditor()
        });
        const button = document.body.appendChild(document.createElement("button"));
        document.body.append(split, otherSplit);

        let editor: unknown;
        function Probe() {
            editor = useNestedEditor("ntx1");
            return null;
        }
        const container = document.createElement("div");
        act(() => render(<Probe />, container));
        expect(editor).toBeNull();

        act(() => nested.focus());
        expect(editor).toBe(nestedEditor);
        // The focus moves to a toolbar, or into a caption of the nested editor.
        act(() => button.focus());
        act(() => caption.focus());
        expect(editor).toBe(nestedEditor);
        // Another split has its own toolbar.
        act(() => otherNested.focus());
        expect(editor).toBe(nestedEditor);

        act(() => host.focus());
        expect(editor).toBeNull();

        act(() => nested.focus());
        expect(editor).toBe(nestedEditor);
        act(() => nestedEditor.fire("destroy"));
        expect(editor).toBeNull();

        act(() => render(null, container));
        split.remove();
        otherSplit.remove();
        button.remove();
    });
});

interface ProbeState {
    canEdit: boolean;
    isEditing: boolean;
}

/** Renders a component that uses `useEditableEmbed()`, in the markup of an embed. */
async function mountProbe(
    embedOptions: EditableEmbedOptions,
    { isEditable = false }: { isEditable?: boolean } = {}
) {
    const figure = document.createElement("figure");
    figure.className = "include-note";
    if (isEditable) {
        figure.dataset.editable = "true";
    }
    const box = document.createElement("div");
    box.className = "include-note-content";
    box.tabIndex = -1;
    figure.append(box);
    document.body.append(figure);
    figures.push(figure);

    const probe = {
        state: { canEdit: false, isEditing: false } as ProbeState,
        figure,
        root: null as HTMLElement | null
    };
    function Probe() {
        const rootRef = useRef<HTMLDivElement>(null);
        probe.state = useEditableEmbed(rootRef, embedOptions);
        return <div ref={rootRef} className="probe" />;
    }

    await act(async () => render(<Probe />, box));
    probe.root = box.querySelector(".probe");
    return probe;
}

function buildEditor(canEdit = true): ContentEditor {
    return {
        canEdit: () => canEdit,
        getUnsavedContent: () => undefined,
        scheduleSave: vi.fn(),
        release: vi.fn()
    };
}

interface EditableOptions {
    parent?: HTMLElement;
    ntxId?: string;
    editor?: object;
    isNestedEditable?: boolean;
}

/** An element with the classes of a text editor's editable, focusable, or a split with `ntxId`. */
function buildEditable({ parent, ntxId, editor, isNestedEditable }: EditableOptions) {
    const element = document.createElement("div");
    element.tabIndex = -1;
    if (ntxId) {
        element.dataset.ntxId = ntxId;
    } else {
        element.className = isNestedEditable
            ? "ck-editor__editable ck-editor__nested-editable"
            : "ck-editor__editable";
    }
    Object.assign(element, { ckeditorInstance: editor });
    parent?.append(element);
    return element;
}

/** An editor that fires its events to the listeners added with `on()`. */
function buildFakeEditor() {
    const listeners = new Map<string, Set<() => void>>();
    return {
        on: (name: string, listener: () => void) => {
            listeners.set(name, (listeners.get(name) ?? new Set()).add(listener));
        },
        off: (name: string, listener: () => void) => listeners.get(name)?.delete(listener),
        fire: (name: string) => {
            for (const listener of listeners.get(name) ?? []) listener();
        }
    };
}
