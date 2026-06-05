import type { OptionNames } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => {
    class Tooltip {
        static getInstance() { return null; }
        dispose() {}
        hide() {}
        show() {}
    }
    return { Tooltip, default: { Tooltip } };
});

// Control isIOS() (read both in the JSX className and the positioning effect) while keeping the rest
// of the utils module (randomString used by easy-froca, etc.) real.
const iosState = { value: false };
vi.mock("../../../services/utils", async (importOriginal) => {
    const original = await importOriginal<typeof import("../../../services/utils")>();
    return {
        ...original,
        default: { ...original.default, isIOS: () => iosState.value },
        isIOS: () => iosState.value
    };
});

vi.mock("../../../services/protected_session_holder", () => ({
    default: { touchProtectedSessionIfNecessary: vi.fn(), isProtectedSessionAvailable: vi.fn(() => true) }
}));

import Component from "../../../components/component";
import type NoteContext from "../../../components/note_context";
import FNote from "../../../entities/fnote";
import options from "../../../services/options";
import { buildNote } from "../../../test/easy-froca";
import { NoteContextContext, ParentComponent } from "../../react/react_utils";
import MobileEditorToolbar from "./mobile_editor_toolbar";

// --- Render helper -------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
let parent: Component | undefined;

function renderComponent(vnode: preact.VNode, noteContext: NoteContext | null) {
    const newParent = new Component();
    const el = document.createElement("div");
    parent = newParent;
    container = el;
    document.body.appendChild(el);
    act(() => {
        render((
            <ParentComponent.Provider value={newParent}>
                <NoteContextContext.Provider value={noteContext}>
                    {vnode}
                </NoteContextContext.Provider>
            </ParentComponent.Provider>
        ), el);
    });
    return el;
}

function fireEvent(name: string, data: unknown) {
    act(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (parent?.handleEventInChildren as any)?.(name, data);
    });
}

async function flush() {
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

function setOptions(values: Record<string, string>) {
    options.load(values as Record<OptionNames, string>);
}

/** Builds a CKTextEditor-shaped object exposing (or omitting) a toolbar element. */
function fakeEditor(toolbar?: HTMLElement) {
    return { ui: { view: { toolbar: toolbar ? { element: toolbar, items: [] } : { items: [] } } } } as unknown as never;
}

/** A minimal `NoteContext`-shaped object; only the fields the component/hooks touch are present. */
function fakeNoteContext(overrides: Record<string, unknown> = {}): NoteContext {
    const note: FNote | undefined = overrides.note as FNote | undefined;
    return {
        ntxId: "ntx1",
        note,
        notePath: note ? `root/${note.noteId}` : "root/note1",
        hoistedNoteId: "root",
        viewScope: { viewMode: "default" },
        isReadOnly: vi.fn(async () => false),
        ...overrides
    } as unknown as NoteContext;
}

beforeEach(() => {
    iosState.value = false;
    setOptions({});
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

// --- Tests ---------------------------------------------------------------------------------------

describe("MobileEditorToolbar", () => {
    it("is visible (non-iOS) for an editable text note", async () => {
        const note = buildNote({ id: "meVisible", title: "T", type: "text" });
        const ctx = fakeNoteContext({ note, isReadOnly: vi.fn(async () => false) });
        const el = renderComponent(<MobileEditorToolbar />, ctx);
        await flush();

        const outer = el.querySelector(".classic-toolbar-outer-container");
        expect(outer).not.toBeNull();
        expect(outer?.className).toContain("visible");
        expect(outer?.className).not.toContain("hidden-ext");
        expect(outer?.className).not.toContain("ios");
        expect(el.querySelector(".classic-toolbar-widget")).not.toBeNull();
    });

    it("is hidden for a non-text note", async () => {
        const note = buildNote({ id: "meImg", title: "I", type: "image" });
        const ctx = fakeNoteContext({ note, isReadOnly: vi.fn(async () => false) });
        const el = renderComponent(<MobileEditorToolbar />, ctx);
        await flush();

        const outer = el.querySelector(".classic-toolbar-outer-container");
        expect(outer?.className).toContain("hidden-ext");
        expect(outer?.className).not.toContain("visible");
    });

    it("is hidden for a read-only text note", async () => {
        const note = buildNote({ id: "meRo", title: "R", type: "text" });
        const ctx = fakeNoteContext({ note, isReadOnly: vi.fn(async () => true) });
        const el = renderComponent(<MobileEditorToolbar />, ctx);
        await flush();

        const outer = el.querySelector(".classic-toolbar-outer-container");
        expect(outer?.className).toContain("hidden-ext");
    });

    it("applies the ios class when running under iOS", async () => {
        iosState.value = true;
        const note = buildNote({ id: "meIos", title: "T", type: "text" });
        const ctx = fakeNoteContext({ note, isReadOnly: vi.fn(async () => false) });
        const el = renderComponent(<MobileEditorToolbar />, ctx);
        await flush();

        const outer = el.querySelector(".classic-toolbar-outer-container");
        expect(outer?.className).toContain("ios");
    });

    it("attaches the CKEditor toolbar when an editor refresh matches the ntxId", async () => {
        const note = buildNote({ id: "meAttach", title: "T", type: "text" });
        const ctx = fakeNoteContext({ note, ntxId: "ntxA", isReadOnly: vi.fn(async () => false) });
        const el = renderComponent(<MobileEditorToolbar />, ctx);
        await flush();

        const toolbar = document.createElement("div");
        toolbar.className = "ck-toolbar";
        fireEvent("textEditorRefreshed", { ntxId: "ntxA", editor: fakeEditor(toolbar) });
        expect(el.querySelector(".classic-toolbar-widget .ck-toolbar")).toBe(toolbar);
    });

    it("clears its children when the matching editor has no toolbar element", async () => {
        const note = buildNote({ id: "meClear", title: "T", type: "text" });
        const ctx = fakeNoteContext({ note, ntxId: "ntxA", isReadOnly: vi.fn(async () => false) });
        const el = renderComponent(<MobileEditorToolbar />, ctx);
        await flush();

        const toolbar = document.createElement("div");
        toolbar.className = "ck-toolbar";
        fireEvent("textEditorRefreshed", { ntxId: "ntxA", editor: fakeEditor(toolbar) });
        expect(el.querySelector(".ck-toolbar")).not.toBeNull();

        fireEvent("textEditorRefreshed", { ntxId: "ntxA", editor: fakeEditor(undefined) });
        expect(el.querySelector(".ck-toolbar")).toBeNull();
    });

    it("ignores editor refreshes meant for a different note context", async () => {
        const note = buildNote({ id: "meOther", title: "T", type: "text" });
        const ctx = fakeNoteContext({ note, ntxId: "ntxA", isReadOnly: vi.fn(async () => false) });
        const el = renderComponent(<MobileEditorToolbar />, ctx);
        await flush();

        const toolbar = document.createElement("div");
        toolbar.className = "ck-toolbar";
        fireEvent("textEditorRefreshed", { ntxId: "other", editor: fakeEditor(toolbar) });
        expect(el.querySelector(".ck-toolbar")).toBeNull();
    });

    it("repositions dropdowns to point upwards on a matching refresh (non-popup)", async () => {
        const note = buildNote({ id: "meDrop", title: "T", type: "text" });
        const ctx = fakeNoteContext({ note, ntxId: "ntxDrop", isReadOnly: vi.fn(async () => false) });
        const el = renderComponent(<MobileEditorToolbar />, ctx);
        await flush();

        // A toolbar item exposing a panelView + change:isOpen subscription.
        // The source rewrites the first "s" → "n" (e.g. CKEditor "se" → "ne").
        const onHandlers: Record<string, () => void> = {};
        const panelView = { position: "se" };
        const item = {
            panelView,
            isOpen: true,
            on: (name: string, cb: () => void) => { onHandlers[name] = cb; }
        };
        const toolbar = document.createElement("div");
        toolbar.className = "ck-toolbar";
        const editor = {
            ui: { view: { toolbar: { element: toolbar, items: [ item, { /* no panelView */ } ] } } }
        } as unknown as never;

        fireEvent("textEditorRefreshed", { ntxId: "ntxDrop", editor });
        // Open the dropdown → handler rewrites the "s" to "n".
        act(() => onHandlers["change:isOpen"]?.());
        expect(panelView.position).toBe("ne");
        expect(el.querySelector(".classic-toolbar-widget .ck-toolbar")).toBe(toolbar);
    });

    it("does not reposition dropdowns when in the popup editor", async () => {
        const note = buildNote({ id: "mePopup", title: "T", type: "text" });
        const ctx = fakeNoteContext({ note, ntxId: "ntxPopup", isReadOnly: vi.fn(async () => false) });
        const el = renderComponent(<MobileEditorToolbar inPopupEditor />, ctx);
        await flush();

        let subscribed = false;
        const item = { panelView: { position: "south" }, isOpen: true, on: () => { subscribed = true; } };
        const toolbar = document.createElement("div");
        toolbar.className = "ck-toolbar";
        const editor = {
            ui: { view: { toolbar: { element: toolbar, items: [ item ] } } }
        } as unknown as never;

        fireEvent("textEditorRefreshed", { ntxId: "ntxPopup", editor });
        expect(subscribed).toBe(false);
        expect(el.querySelector(".classic-toolbar-widget .ck-toolbar")).toBe(toolbar);
    });

    it("ignores a dropdown open event when the item is not actually open", async () => {
        const note = buildNote({ id: "meDropClosed", title: "T", type: "text" });
        const ctx = fakeNoteContext({ note, ntxId: "ntxDropC", isReadOnly: vi.fn(async () => false) });
        renderComponent(<MobileEditorToolbar />, ctx);
        await flush();

        const onHandlers: Record<string, () => void> = {};
        const panelView = { position: "se" };
        const item = {
            panelView,
            isOpen: false,
            on: (name: string, cb: () => void) => { onHandlers[name] = cb; }
        };
        const toolbar = document.createElement("div");
        toolbar.className = "ck-toolbar";
        const editor = {
            ui: { view: { toolbar: { element: toolbar, items: [ item ] } } }
        } as unknown as never;

        fireEvent("textEditorRefreshed", { ntxId: "ntxDropC", editor });
        act(() => onHandlers["change:isOpen"]?.());
        // Position untouched because the item reported itself closed.
        expect(panelView.position).toBe("se");
    });

    it("toggles the dropdown-active class via the aria-expanded MutationObserver", async () => {
        const note = buildNote({ id: "meObserver", title: "T", type: "text" });
        const ctx = fakeNoteContext({ note, ntxId: "ntxObs", isReadOnly: vi.fn(async () => false) });
        const el = renderComponent(<MobileEditorToolbar />, ctx);
        await flush();

        const widget = el.querySelector<HTMLDivElement>(".classic-toolbar-widget");
        expect(widget).not.toBeNull();
        const button = document.createElement("button");
        widget?.appendChild(button);

        // The observer callback reads the `ariaExpanded` IDL property (happy-dom does not reflect the
        // attribute to it), while the attribute mutation is what triggers the observer. Set both.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (button as any).ariaExpanded = "true";
        button.setAttribute("aria-expanded", "true");
        await flush();
        expect(widget?.className).toContain("dropdown-active");

        // Collapse → dropdown-active removed.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (button as any).ariaExpanded = "false";
        button.setAttribute("aria-expanded", "false");
        await flush();
        expect(widget?.className).not.toContain("dropdown-active");
    });

    it("AND-reduces multiple aria-expanded targets in a single mutation batch", async () => {
        const note = buildNote({ id: "meObsMulti", title: "T", type: "text" });
        const ctx = fakeNoteContext({ note, ntxId: "ntxObsMulti", isReadOnly: vi.fn(async () => false) });
        const el = renderComponent(<MobileEditorToolbar />, ctx);
        await flush();

        const widget = el.querySelector<HTMLDivElement>(".classic-toolbar-widget");
        const open = document.createElement("button");
        const closed = document.createElement("button");
        widget?.append(open, closed);

        // Two targets mutate in the same batch → the reduce callback runs; one is closed → AND is false.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (open as any).ariaExpanded = "true";
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (closed as any).ariaExpanded = "false";
        open.setAttribute("aria-expanded", "true");
        closed.setAttribute("aria-expanded", "false");
        await flush();
        expect(widget?.className).not.toContain("dropdown-active");

        // Now both open → AND is true.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (closed as any).ariaExpanded = "true";
        closed.setAttribute("aria-expanded", "true");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (open as any).ariaExpanded = "true";
        open.setAttribute("aria-expanded", "true");
        await flush();
        expect(widget?.className).toContain("dropdown-active");
    });

    it("repositions on iOS visualViewport resize and clears the inline style when the keyboard hides", async () => {
        iosState.value = true;
        const listeners: Record<string, Array<(e: unknown) => void>> = {};
        const visualViewport = {
            height: 800,
            offsetTop: 0,
            addEventListener: (name: string, cb: (e: unknown) => void) => {
                (listeners[name] ??= []).push(cb);
            },
            removeEventListener: vi.fn()
        };
        const originalVV = (window as unknown as { visualViewport?: unknown }).visualViewport;
        const originalInner = window.innerHeight;
        Object.defineProperty(window, "visualViewport", { value: visualViewport, configurable: true });
        Object.defineProperty(window, "innerHeight", { value: 1000, configurable: true, writable: true });

        try {
            const note = buildNote({ id: "meIosPos", title: "T", type: "text" });
            const ctx = fakeNoteContext({ note, ntxId: "ntxIosPos", isReadOnly: vi.fn(async () => false) });
            const el = renderComponent(<MobileEditorToolbar />, ctx);
            await flush();

            const outer = el.querySelector<HTMLDivElement>(".classic-toolbar-outer-container");
            const wrapper = el.querySelector<HTMLDivElement>(".classic-toolbar-widget");
            expect(outer?.className).toContain("ios");
            expect(wrapper).not.toBeNull();

            // Keyboard appears: viewport shrinks → inline bottom set.
            visualViewport.height = 600; // innerHeight(1000) - 600 - 0 = 400 > baseline(0)
            act(() => listeners["resize"]?.forEach(cb => cb({})));
            expect(wrapper?.style.bottom).toBe("400px");

            // Keyboard hides: viewport back to full → inline bottom removed.
            visualViewport.height = 1000; // bottom = 0 <= baseline → removeProperty
            act(() => listeners["resize"]?.forEach(cb => cb({})));
            expect(wrapper?.style.bottom).toBe("");
        } finally {
            Object.defineProperty(window, "visualViewport", { value: originalVV, configurable: true });
            Object.defineProperty(window, "innerHeight", { value: originalInner, configurable: true, writable: true });
        }
    });

    it("scroll handler is a no-op on iOS when there is no visualViewport", async () => {
        iosState.value = true;
        const originalVV = (window as unknown as { visualViewport?: unknown }).visualViewport;
        Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true });

        try {
            const note = buildNote({ id: "meIosNoVV", title: "T", type: "text" });
            const ctx = fakeNoteContext({ note, ntxId: "ntxIosNoVV", isReadOnly: vi.fn(async () => false) });
            const el = renderComponent(<MobileEditorToolbar />, ctx);
            await flush();

            const wrapper = el.querySelector<HTMLDivElement>(".classic-toolbar-widget");
            // adjustPosition runs but returns early (no viewport) → no inline bottom applied.
            act(() => { window.dispatchEvent(new Event("scroll")); });
            expect(wrapper?.style.bottom).toBe("");
        } finally {
            Object.defineProperty(window, "visualViewport", { value: originalVV, configurable: true });
        }
    });

    it("does not attach iOS positioning listeners when inside the popup editor", async () => {
        iosState.value = true;
        const addEventListener = vi.fn();
        const visualViewport = {
            height: 800,
            offsetTop: 0,
            addEventListener,
            removeEventListener: vi.fn()
        };
        const originalVV = (window as unknown as { visualViewport?: unknown }).visualViewport;
        Object.defineProperty(window, "visualViewport", { value: visualViewport, configurable: true });

        try {
            const note = buildNote({ id: "meIosPopup", title: "T", type: "text" });
            const ctx = fakeNoteContext({ note, ntxId: "ntxIosPopup", isReadOnly: vi.fn(async () => false) });
            renderComponent(<MobileEditorToolbar inPopupEditor />, ctx);
            await flush();
            // enabled = !inPopupEditor = false → effect returns early, never subscribes.
            expect(addEventListener).not.toHaveBeenCalled();
        } finally {
            Object.defineProperty(window, "visualViewport", { value: originalVV, configurable: true });
        }
    });

    it("renders an empty (hidden) container when there is no note context", async () => {
        const el = renderComponent(<MobileEditorToolbar />, null);
        await flush();
        const outer = el.querySelector(".classic-toolbar-outer-container");
        expect(outer).not.toBeNull();
        // No note → not a text note → hidden.
        expect(outer?.className).toContain("hidden-ext");
    });
});
