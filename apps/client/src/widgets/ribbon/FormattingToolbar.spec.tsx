import { OptionNames } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => {
    class Tooltip {
        static getInstance() { return null; }
        dispose() {}
        show() {}
        hide() {}
    }
    return { Tooltip, default: { Tooltip } };
});

import appContext from "../../components/app_context";
import Component from "../../components/component";
import type NoteContext from "../../components/note_context";
import FNote from "../../entities/fnote";
import options from "../../services/options";
import { buildNote } from "../../test/easy-froca";
import { ParentComponent } from "../react/react_utils";
import FormattingToolbar, { FixedFormattingToolbar, getFormattingToolbarState } from "./FormattingToolbar";
import { TabContext } from "./ribbon-interface";

// --- Render helper -------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
let parent: Component | undefined;

function renderComponent(vnode: preact.VNode) {
    parent = new Component();
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
        render((
            <ParentComponent.Provider value={parent ?? null}>
                {vnode}
            </ParentComponent.Provider>
        ), container);
    });
    return container;
}

function fireEvent(name: string, data: unknown) {
    act(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (parent?.handleEventInChildren as any)?.(name, data);
    });
}

function setOptions(values: Record<string, string>) {
    options.load(values as Record<OptionNames, string>);
}

/** Builds a CKTextEditor-shaped object exposing (or omitting) a toolbar element. */
function fakeEditor(toolbar?: HTMLElement) {
    return { ui: { view: { toolbar: toolbar ? { element: toolbar } : undefined } } } as unknown as never;
}

/** A minimal `NoteContext`-shaped object; only the fields the component/function touch are present. */
function fakeNoteContext(overrides: Record<string, unknown> = {}): NoteContext {
    const ctx: Record<string, unknown> = {
        ntxId: "ntx1",
        note: undefined,
        notePath: "root/note1",
        hoistedNoteId: "root",
        viewScope: { viewMode: "default" },
        isReadOnly: vi.fn(async () => false),
        ...overrides
    };
    ctx.getMainContext = ctx.getMainContext ?? (() => ctx);
    ctx.getSubContexts = ctx.getSubContexts ?? (() => [ ctx ]);
    return ctx as unknown as NoteContext;
}

function tabContext(overrides: Partial<TabContext> = {}): TabContext {
    return {
        note: undefined,
        hidden: false,
        ntxId: "ntx1",
        componentId: "comp-1",
        activate: vi.fn(),
        ...overrides
    };
}

beforeEach(() => {
    setOptions({ textNoteEditorType: "ckeditor-classic" });
    Object.assign(appContext, { tabManager: { getActiveContext: () => null } });
});

afterEach(() => {
    const c = container;
    if (c) {
        act(() => render(null, c));
        c.remove();
        container = undefined;
    }
    parent = undefined;
    vi.restoreAllMocks();
});

// --- FormattingToolbar (detached/decoupled editor toolbar) ---------------------------------------

describe("FormattingToolbar", () => {
    it("renders nothing when the editor type is not the classic CKEditor", () => {
        setOptions({ textNoteEditorType: "ckeditor-balloon" });
        const el = renderComponent(<FormattingToolbar {...tabContext()} />);
        expect(el.querySelector(".classic-toolbar-widget")).toBeNull();
    });

    it("renders the toolbar container, marking it hidden via the prop", () => {
        const el = renderComponent(<FormattingToolbar {...tabContext({ hidden: true })} />);
        const widget = el.querySelector(".classic-toolbar-widget");
        expect(widget?.className).toContain("hidden-ext");
    });

    it("renders without the hidden class when not hidden", () => {
        const el = renderComponent(<FormattingToolbar {...tabContext({ hidden: false })} />);
        const widget = el.querySelector(".classic-toolbar-widget");
        expect(widget).not.toBeNull();
        expect(widget?.className).not.toContain("hidden-ext");
    });

    it("attaches the CKEditor toolbar element when an editor refresh matches the ntxId", () => {
        const el = renderComponent(<FormattingToolbar {...tabContext({ ntxId: "ntxA" })} />);
        const toolbar = document.createElement("div");
        toolbar.className = "ck-toolbar";
        fireEvent("textEditorRefreshed", { ntxId: "ntxA", editor: fakeEditor(toolbar) });
        expect(el.querySelector(".classic-toolbar-widget .ck-toolbar")).toBe(toolbar);
    });

    it("clears its children when the matching editor has no toolbar element", () => {
        const el = renderComponent(<FormattingToolbar {...tabContext({ ntxId: "ntxA" })} />);
        const toolbar = document.createElement("div");
        toolbar.className = "ck-toolbar";
        fireEvent("textEditorRefreshed", { ntxId: "ntxA", editor: fakeEditor(toolbar) });
        expect(el.querySelector(".ck-toolbar")).not.toBeNull();

        fireEvent("textEditorRefreshed", { ntxId: "ntxA", editor: fakeEditor(undefined) });
        expect(el.querySelector(".ck-toolbar")).toBeNull();
    });

    it("ignores editor refreshes meant for a different note context", () => {
        const el = renderComponent(<FormattingToolbar {...tabContext({ ntxId: "ntxA" })} />);
        const toolbar = document.createElement("div");
        toolbar.className = "ck-toolbar";
        fireEvent("textEditorRefreshed", { ntxId: "other", editor: fakeEditor(toolbar) });
        expect(el.querySelector(".ck-toolbar")).toBeNull();
    });
});

// --- FixedFormattingToolbar (ribbon / fixed-position toolbar) -------------------------------------

describe("FixedFormattingToolbar", () => {
    function renderFixed(note: FNote | undefined, noteContext: NoteContext) {
        Object.assign(appContext, { tabManager: { getActiveContext: () => noteContext } });
        const el = renderComponent(<FixedFormattingToolbar />);
        return el;
    }

    it("renders the toolbar container with the hidden class for a non-text active note", async () => {
        const note = buildNote({ id: "fixedImg", title: "Img", type: "image" });
        const ctx = fakeNoteContext({ note });
        const el = renderFixed(note, ctx);
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });
        const widget = el.querySelector(".classic-toolbar-widget");
        expect(widget?.className).toContain("hidden-ext");
        expect(widget?.className).not.toContain("disabled");
    });

    it("is visible (no hidden/disabled class) for an editable single text note", async () => {
        const note = buildNote({ id: "fixedText", title: "Text", type: "text" });
        const ctx = fakeNoteContext({ note, isReadOnly: vi.fn(async () => false) });
        const el = renderFixed(note, ctx);
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });
        const widget = el.querySelector(".classic-toolbar-widget");
        expect(widget?.className).not.toContain("hidden-ext");
        expect(widget?.className).not.toContain("disabled");
    });

    it("caches and renders the toolbar element on a matching textEditorRefreshed event", async () => {
        const note = buildNote({ id: "fixedCache", title: "Text", type: "text" });
        const ctx = fakeNoteContext({ note, ntxId: "ntxCache", isReadOnly: vi.fn(async () => false) });
        const el = renderFixed(note, ctx);
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });

        const toolbar = document.createElement("div");
        toolbar.className = "ck-toolbar";
        fireEvent("textEditorRefreshed", { ntxId: "ntxCache", editor: fakeEditor(toolbar) });
        expect(el.querySelector(".classic-toolbar-widget .ck-toolbar")).toBe(toolbar);
    });

    it("caches a toolbar for another context without rendering it for the active one", async () => {
        const note = buildNote({ id: "fixedOther", title: "Text", type: "text" });
        const ctx = fakeNoteContext({ note, ntxId: "ntxActive", isReadOnly: vi.fn(async () => false) });
        const el = renderFixed(note, ctx);
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });

        const toolbar = document.createElement("div");
        toolbar.className = "ck-toolbar";
        fireEvent("textEditorRefreshed", { ntxId: "ntxOtherTab", editor: fakeEditor(toolbar) });
        expect(el.querySelector(".ck-toolbar")).toBeNull();
    });

    it("ignores a textEditorRefreshed event that lacks an ntxId", async () => {
        const note = buildNote({ id: "fixedNoNtx", title: "Text", type: "text" });
        const ctx = fakeNoteContext({ note, ntxId: "ntxNoNtx", isReadOnly: vi.fn(async () => false) });
        const el = renderFixed(note, ctx);
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });

        const toolbar = document.createElement("div");
        toolbar.className = "ck-toolbar";
        fireEvent("textEditorRefreshed", { ntxId: null, editor: fakeEditor(toolbar) });
        expect(el.querySelector(".ck-toolbar")).toBeNull();
    });

    it("focuses the toolbar on toggle, then restores focus on a second toggle", async () => {
        const note = buildNote({ id: "fixedFocus", title: "Text", type: "text" });
        const ctx = fakeNoteContext({ note, ntxId: "ntxFocus", isReadOnly: vi.fn(async () => false) });
        const el = renderFixed(note, ctx);
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });

        // Build a toolbar containing a focusable button, attached to the DOM so focus works.
        const toolbar = document.createElement("div");
        toolbar.className = "ck-toolbar";
        const items = document.createElement("div");
        items.className = "ck-toolbar__items";
        const button = document.createElement("button");
        items.appendChild(button);
        toolbar.appendChild(items);
        document.body.appendChild(toolbar);

        // An external element that initially holds focus.
        const external = document.createElement("button");
        document.body.appendChild(external);
        external.focus();

        fireEvent("textEditorRefreshed", { ntxId: "ntxFocus", editor: fakeEditor(toolbar) });

        // First toggle: focus moves into the toolbar.
        fireEvent("toggleRibbonTabClassicEditor", {});
        expect(document.activeElement).toBe(button);

        // Second toggle: focus returns to the previously focused element.
        fireEvent("toggleRibbonTabClassicEditor", {});
        expect(document.activeElement).toBe(external);

        toolbar.remove();
        external.remove();
    });

    it("does nothing on toggle when no toolbar has been rendered yet", async () => {
        const note = buildNote({ id: "fixedNoToolbar", title: "Img", type: "image" });
        const ctx = fakeNoteContext({ note, ntxId: "ntxNone" });
        const el = renderFixed(note, ctx);
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });
        // No toolbar cached/rendered, so the toggle is a no-op (no throw).
        expect(() => fireEvent("toggleRibbonTabClassicEditor", {})).not.toThrow();
        expect(el.querySelector(".ck-toolbar")).toBeNull();
    });

    it("evicts a cached toolbar when its note context is removed", async () => {
        const note = buildNote({ id: "fixedRemoved", title: "Text", type: "text" });
        const ctx = fakeNoteContext({ note, ntxId: "ntxRemoved", isReadOnly: vi.fn(async () => false) });
        renderFixed(note, ctx);
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });

        const toolbar = document.createElement("div");
        toolbar.className = "ck-toolbar";
        fireEvent("textEditorRefreshed", { ntxId: "ntxRemoved", editor: fakeEditor(toolbar) });
        // Removing the context should not throw and should clear it from the cache.
        expect(() => fireEvent("noteContextRemoved", { ntxIds: [ "ntxRemoved" ] })).not.toThrow();
    });

    it("restores a previously cached toolbar on mount when the active context already has one", async () => {
        // First mount: cache a toolbar for ntxId "ntxRestore".
        const note1 = buildNote({ id: "fixedRestore1", title: "Text", type: "text" });
        const ctx1 = fakeNoteContext({ note: note1, ntxId: "ntxRestore", isReadOnly: vi.fn(async () => false) });
        renderFixed(note1, ctx1);
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });
        const toolbar = document.createElement("div");
        toolbar.className = "ck-toolbar";
        fireEvent("textEditorRefreshed", { ntxId: "ntxRestore", editor: fakeEditor(toolbar) });
        // Tear down the first instance so the next mount reads the cache fresh.
        const firstContainer = container;
        if (firstContainer) {
            act(() => render(null, firstContainer));
            firstContainer.remove();
            container = undefined;
        }

        // Second mount with the same ntxId: the mount effect should pull the cached toolbar.
        const note2 = buildNote({ id: "fixedRestore2", title: "Text2", type: "text" });
        const ctx2 = fakeNoteContext({ note: note2, ntxId: "ntxRestore", isReadOnly: vi.fn(async () => false) });
        const el = renderFixed(note2, ctx2);
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });
        expect(el.querySelector(".classic-toolbar-widget .ck-toolbar")).toBe(toolbar);
    });

    it("renders an empty container when there is no active context", async () => {
        Object.assign(appContext, { tabManager: { getActiveContext: () => null } });
        const el = renderComponent(<FixedFormattingToolbar />);
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });
        const widget = el.querySelector(".classic-toolbar-widget");
        expect(widget).not.toBeNull();
        expect(widget?.className).toContain("hidden-ext");
    });
});

// --- getFormattingToolbarState (pure async branching) --------------------------------------------

describe("getFormattingToolbarState", () => {
    it("is hidden when there is no active note context", async () => {
        expect(await getFormattingToolbarState(undefined, null, "ckeditor-classic")).toBe("hidden");
    });

    it("is hidden when the editor is not the classic CKEditor", async () => {
        const ctx = fakeNoteContext();
        expect(await getFormattingToolbarState(ctx, null, "ckeditor-balloon")).toBe("hidden");
    });

    it("single context: hidden for a non-text note", async () => {
        const note = buildNote({ id: "gfsImg", title: "I", type: "image" });
        const ctx = fakeNoteContext({ note });
        expect(await getFormattingToolbarState(ctx, note, "ckeditor-classic")).toBe("hidden");
    });

    it("single context: hidden for a text note in a non-default view mode", async () => {
        const note = buildNote({ id: "gfsSource", title: "S", type: "text" });
        const ctx = fakeNoteContext({ note, viewScope: { viewMode: "source" } });
        expect(await getFormattingToolbarState(ctx, note, "ckeditor-classic")).toBe("hidden");
    });

    it("single context: hidden for a read-only text note", async () => {
        const note = buildNote({ id: "gfsRo", title: "R", type: "text" });
        const ctx = fakeNoteContext({ note, isReadOnly: vi.fn(async () => true) });
        expect(await getFormattingToolbarState(ctx, note, "ckeditor-classic")).toBe("hidden");
    });

    it("single context: visible for an editable default-view text note", async () => {
        const note = buildNote({ id: "gfsOk", title: "OK", type: "text" });
        const ctx = fakeNoteContext({ note, isReadOnly: vi.fn(async () => false) });
        expect(await getFormattingToolbarState(ctx, note, "ckeditor-classic")).toBe("visible");
    });

    it("multiple contexts: hidden when every text note is read-only", async () => {
        const a = buildNote({ id: "gfsMa", title: "A", type: "text" });
        const b = buildNote({ id: "gfsMb", title: "B", type: "text" });
        const subA = fakeNoteContext({ note: a, ntxId: "a", isReadOnly: vi.fn(async () => true) });
        const subB = fakeNoteContext({ note: b, ntxId: "b", isReadOnly: vi.fn(async () => true) });
        const active = fakeNoteContext({
            note: a,
            ntxId: "a",
            isReadOnly: vi.fn(async () => true),
            getMainContext: () => ({ getSubContexts: () => [ subA, subB ] }),
            getSubContexts: () => [ subA, subB ]
        });
        expect(await getFormattingToolbarState(active, a, "ckeditor-classic")).toBe("hidden");
    });

    it("multiple contexts: disabled when the active subcontext is not a text note", async () => {
        const text = buildNote({ id: "gfsDt", title: "T", type: "text" });
        const img = buildNote({ id: "gfsDi", title: "I", type: "image" });
        const subText = fakeNoteContext({ note: text, ntxId: "t", isReadOnly: vi.fn(async () => false) });
        const subImg = fakeNoteContext({ note: img, ntxId: "i", isReadOnly: vi.fn(async () => false) });
        const active = fakeNoteContext({
            note: img,
            ntxId: "i",
            getMainContext: () => ({ getSubContexts: () => [ subText, subImg ] }),
            getSubContexts: () => [ subText, subImg ]
        });
        expect(await getFormattingToolbarState(active, img, "ckeditor-classic")).toBe("disabled");
    });

    it("multiple contexts: disabled when the active text subcontext is itself read-only", async () => {
        const a = buildNote({ id: "gfsRa", title: "A", type: "text" });
        const b = buildNote({ id: "gfsRb", title: "B", type: "text" });
        const subA = fakeNoteContext({ note: a, ntxId: "a", isReadOnly: vi.fn(async () => true) });
        const subB = fakeNoteContext({ note: b, ntxId: "b", isReadOnly: vi.fn(async () => false) });
        const active = fakeNoteContext({
            note: a,
            ntxId: "a",
            isReadOnly: vi.fn(async () => true),
            getMainContext: () => ({ getSubContexts: () => [ subA, subB ] }),
            getSubContexts: () => [ subA, subB ]
        });
        // The active context object must be the same reference present in the subcontexts list.
        Object.assign(subA, { getMainContext: active.getMainContext, getSubContexts: active.getSubContexts });
        const result = await getFormattingToolbarState(subA, a, "ckeditor-classic");
        expect(result).toBe("disabled");
    });

    it("multiple contexts: disabled when the active text subcontext is in a non-default view", async () => {
        const a = buildNote({ id: "gfsVa", title: "A", type: "text" });
        const b = buildNote({ id: "gfsVb", title: "B", type: "text" });
        const subB = fakeNoteContext({ note: b, ntxId: "b", isReadOnly: vi.fn(async () => false) });
        // Active is a text note, editable, but in "source" view; not part of the filtered text subcontexts.
        const active = fakeNoteContext({
            note: a,
            ntxId: "a",
            viewScope: { viewMode: "source" },
            isReadOnly: vi.fn(async () => false)
        });
        Object.assign(active, {
            getMainContext: () => ({ getSubContexts: () => [ active, subB ] }),
            getSubContexts: () => [ active, subB ]
        });
        expect(await getFormattingToolbarState(active, a, "ckeditor-classic")).toBe("disabled");
    });

    it("multiple contexts: visible when the active editable text subcontext is in default view", async () => {
        const a = buildNote({ id: "gfsViA", title: "A", type: "text" });
        const b = buildNote({ id: "gfsViB", title: "B", type: "text" });
        const subB = fakeNoteContext({ note: b, ntxId: "b", isReadOnly: vi.fn(async () => false) });
        const active = fakeNoteContext({
            note: a,
            ntxId: "a",
            viewScope: { viewMode: "default" },
            isReadOnly: vi.fn(async () => false)
        });
        Object.assign(active, {
            getMainContext: () => ({ getSubContexts: () => [ active, subB ] }),
            getSubContexts: () => [ active, subB ]
        });
        expect(await getFormattingToolbarState(active, a, "ckeditor-classic")).toBe("visible");
    });
});
