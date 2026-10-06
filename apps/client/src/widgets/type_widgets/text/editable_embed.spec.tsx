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
    useEmbedPreview
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
