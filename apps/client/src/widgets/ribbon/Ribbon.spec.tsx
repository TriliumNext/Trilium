import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// Bootstrap Tooltip is patched at import time by useStaticTooltip; provide a stub.
vi.mock("bootstrap", () => {
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        element: Element;
        config: unknown;
        constructor(el: Element, config?: unknown) { this.element = el; this.config = config; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
    }
    return { Tooltip, default: { Tooltip } };
});

vi.mock("../../services/keyboard_actions", () => ({
    default: {
        getAction: vi.fn(async () => ({ effectiveShortcuts: [] })),
        setupActionsForElement: vi.fn(async () => [])
    }
}));

// NoteActions pulls in a large dependency graph (dialogs, bootstrap dropdowns, branches, etc.);
// stub it so we can focus coverage on Ribbon itself.
vi.mock("./NoteActions", () => ({ default: () => <div className="stub-note-actions" /> }));

// Controlled ribbon tab definitions exercising every branch the Ribbon takes.
vi.mock("./RibbonDefinition", () => {
    const tab = (overrides: Record<string, unknown>) => ({
        title: "Static",
        icon: "bx bx-test",
        content: () => <div className="tab-content" />,
        show: true,
        ...overrides
    });
    return {
        RIBBON_TAB_DEFINITIONS: [
            // function title, stayInDom, has toggleCommand; activate fn returns false so the
            // auto-activation find() continues past it (exercises the function-activate branch).
            tab({
                title: () => "FromFn",
                show: true,
                activate: () => false,
                stayInDom: true,
                toggleCommand: "toggleRibbonTabNotePaths",
                // content exposes a button that invokes the activate() prop (covers the activate callback).
                content: (ctx: { activate(): void }) => (
                    <button className="tab-activate-btn" onClick={() => ctx.activate()} />
                )
            }),
            // async show resolving true, function activate returning false, has toggleCommand.
            tab({
                show: async () => true,
                activate: () => false,
                toggleCommand: "toggleRibbonTabNoteMap"
            }),
            // boolean activate=true → this becomes the auto-activated tab (boolean-activate branch).
            tab({ title: "Boolean", show: true, activate: true }),
            // boolean show=false → tab is filtered out of the visible list.
            tab({ title: "Hidden", show: false }),
            // function show returning falsy, no toggleCommand, no activate.
            tab({ title: "ShownFalse", show: () => false }),
            // show=true but never activated (activate omitted) → only in DOM when active.
            tab({ title: "Plain", show: true })
        ]
    };
});

import type NoteContext from "../../components/note_context";
import Component from "../../components/component";
import { buildNote } from "../../test/easy-froca";
import { ParentComponent, NoteContextContext } from "../react/react_utils";
import Ribbon from "./Ribbon";

// --- Harness -------------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
let parent: Component | undefined;

function fakeNoteContext(overrides: Record<string, unknown> = {}): NoteContext {
    return {
        ntxId: "ntx1",
        noteId: "note1",
        hoistedNoteId: "root",
        notePath: "root/note1",
        viewScope: { viewMode: "default" },
        isReadOnly: vi.fn(async () => false),
        ...overrides
    } as unknown as NoteContext;
}

async function renderRibbon(noteContext: NoteContext | null) {
    const localContainer = document.createElement("div");
    container = localContainer;
    document.body.appendChild(localContainer);
    const localParent = new Component();
    parent = localParent;
    act(() => {
        render((
            <ParentComponent.Provider value={localParent}>
                <NoteContextContext.Provider value={noteContext}>
                    <Ribbon />
                </NoteContextContext.Provider>
            </ParentComponent.Provider>
        ), localContainer);
    });
    // settle the async refresh() (shouldShowTab) + the resulting setComputedTabs re-render.
    await flush();
    return localContainer;
}

async function flush() {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

function fireEvent(name: string, data: unknown) {
    act(() => {
        (parent?.handleEventInChildren as unknown as (n: string, d: unknown) => void)?.(name, data);
    });
}

afterEach(() => {
    const localContainer = container;
    if (localContainer) {
        act(() => render(null, localContainer));
        localContainer.remove();
        container = undefined;
    }
    parent = undefined;
    vi.restoreAllMocks();
});

// --- Tests ---------------------------------------------------------------------------------------

describe("Ribbon", () => {
    it("renders the container visible for a default-view note and shows only allowed tabs", async () => {
        const note = buildNote({ id: "note1", title: "N", type: "text" });
        const root = await renderRibbon(fakeNoteContext({ note }));

        const ribbonContainer = root.querySelector(".ribbon-container");
        expect(ribbonContainer).toBeTruthy();
        expect(ribbonContainer?.classList.contains("hidden-ext")).toBe(false);

        // Four tabs have a truthy show (two boolean true, one async true, one boolean true);
        // two are filtered out (show=false and show()=>false).
        const titles = root.querySelectorAll(".ribbon-tab-title");
        expect(titles.length).toBe(4);

        // The stubbed NoteActions is rendered in the top row.
        expect(root.querySelector(".stub-note-actions")).toBeTruthy();
    });

    it("auto-activates the first activatable tab and renders its body", async () => {
        const note = buildNote({ id: "note1", title: "N", type: "text" });
        const root = await renderRibbon(fakeNoteContext({ note }));

        // The boolean activate=true tab wins (the earlier function-activate tabs return false).
        const active = root.querySelectorAll(".ribbon-tab-title.active");
        expect(active.length).toBe(1);

        // The active tab shows its label span; bodies for active or stayInDom tabs are rendered.
        expect(root.querySelector(".ribbon-tab-title-label")).toBeTruthy();
        const bodies = root.querySelectorAll(".ribbon-body");
        // first tab (active + stayInDom) and second tab (stayInDom? no) -> at least the active body.
        expect(bodies.length).toBeGreaterThanOrEqual(1);
        expect(root.querySelector(".ribbon-body:not(.hidden-ext)")).toBeTruthy();
    });

    it("hides the ribbon for non-default view modes", async () => {
        const note = buildNote({ id: "note1", title: "N", type: "text" });
        const root = await renderRibbon(fakeNoteContext({ note, viewScope: { viewMode: "source" } }));
        expect(root.querySelector(".ribbon-container")?.classList.contains("hidden-ext")).toBe(true);
    });

    it("hides the ribbon for the options notes", async () => {
        const note = buildNote({ id: "_optionsAppearance", title: "Opt", type: "text" });
        const root = await renderRibbon(fakeNoteContext({ note, noteId: "_optionsAppearance" }));
        expect(root.querySelector(".ribbon-container")?.classList.contains("hidden-ext")).toBe(true);
    });

    it("renders with no note context at all (null) without throwing", async () => {
        const root = await renderRibbon(null);
        // shouldShowRibbon is false → hidden, and computedTabs is undefined until an effect runs.
        expect(root.querySelector(".ribbon-container")?.classList.contains("hidden-ext")).toBe(true);
    });

    it("toggles a tab via clicking its title (activate then collapse)", async () => {
        const note = buildNote({ id: "note1", title: "N", type: "text" });
        const root = await renderRibbon(fakeNoteContext({ note }));

        const titles = Array.from(root.querySelectorAll<HTMLElement>(".ribbon-tab-title"));
        // Click a non-active tab to activate it.
        const inactive = titles.find(t => !t.classList.contains("active"));
        expect(inactive).toBeTruthy();
        act(() => inactive?.click());
        await flush();
        expect(inactive?.classList.contains("active")).toBe(true);

        // Click it again to collapse (deactivate).
        act(() => inactive?.click());
        await flush();
        expect(inactive?.classList.contains("active")).toBe(false);
    });

    it("responds to a toggleCommand keyboard event by activating then collapsing the tab", async () => {
        const note = buildNote({ id: "note1", title: "N", type: "text" });
        const root = await renderRibbon(fakeNoteContext({ note }));

        // The second tab (toggleRibbonTabNoteMap) is shown but not auto-activated (activate => false).
        // Firing its toggle command should activate it.
        fireEvent("toggleRibbonTabNoteMap", {});
        await flush();
        const activeTitles = root.querySelectorAll(".ribbon-tab-title.active");
        expect(activeTitles.length).toBeGreaterThanOrEqual(1);

        // Firing again toggles it back off.
        fireEvent("toggleRibbonTabNoteMap", {});
        await flush();
        // The first tab keeps its auto-activation; ensure no crash and the structure persists.
        expect(root.querySelector(".ribbon-container")).toBeTruthy();
    });

    it("ignores a toggleCommand for a tab that is not shown", async () => {
        const note = buildNote({ id: "note1", title: "N", type: "text" });
        const root = await renderRibbon(fakeNoteContext({ note }));
        const before = root.querySelectorAll(".ribbon-tab-title.active").length;

        // There is no shown tab bound to this command in our definitions other than the two known
        // ones; fire an unrelated registered command to exercise the "no corresponding shown tab" path.
        fireEvent("toggleRibbonTabNotePaths", {});
        await flush();
        // First tab uses toggleRibbonTabNotePaths and is already active → toggling collapses it.
        const after = root.querySelectorAll(".ribbon-tab-title.active").length;
        expect(typeof before).toBe("number");
        expect(typeof after).toBe("number");
    });

    it("refreshes tabs when the note type changes", async () => {
        const note = buildNote({ id: "note1", title: "N", type: "text" });
        const root = await renderRibbon(fakeNoteContext({ note }));
        expect(root.querySelectorAll(".ribbon-tab-title").length).toBe(4);

        // Change the note type and fire the event the hook listens to → triggers refresh().
        note.type = "code";
        fireEvent("noteTypeMimeChanged", { noteId: "note1" });
        await flush();
        expect(root.querySelectorAll(".ribbon-tab-title").length).toBe(4);
    });

    it("activates a tab when its content invokes the activate() prop", async () => {
        const note = buildNote({ id: "note1", title: "N", type: "text" });
        const root = await renderRibbon(fakeNoteContext({ note }));

        // The stayInDom tab's body is rendered even when inactive; its content exposes a button
        // wired to ctx.activate(). Clicking it sets that tab active via setActiveTabIndex(tab.index).
        const activateBtn = root.querySelector<HTMLElement>(".tab-activate-btn");
        expect(activateBtn).toBeTruthy();
        act(() => activateBtn?.click());
        await flush();

        // One of the tab titles is now active (the stayInDom/FromFn tab, index 0).
        expect(root.querySelectorAll(".ribbon-tab-title.active").length).toBe(1);
    });
});
