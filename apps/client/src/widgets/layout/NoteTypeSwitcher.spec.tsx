import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

// Rendering TemplateNoteTypes pulls in BadgeWithDropdown → Dropdown, which wires real Bootstrap;
// a fake instance is enough since only the menu contents are asserted (same prelude as Dropdown.spec).
vi.mock("bootstrap", () => ({
    Dropdown: { getOrCreateInstance: () => ({ show() {}, hide() {}, update() {}, dispose() {}, _menu: null }) },
    Tooltip: Object.assign(class {}, { getInstance: () => null })
}));

// Stub only the Bootstrap-Tooltip hook (it drives the jQuery tooltip plugin, absent under happy-dom);
// the rest of the hooks module — notably useTriliumEvent — stays real.
const tooltipStub = vi.hoisted(() => ({ showTooltip: () => {}, hideTooltip: () => {} }));
vi.mock("../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../react/hooks")>()),
    useTooltip: () => tooltipStub
}));

import Component from "../../components/component.js";
import type FNote from "../../entities/fnote.js";
import server from "../../services/server.js";
import { buildNote } from "../../test/easy-froca.js";
import { ParentComponent } from "../react/react_utils.js";
import NoteTypeSwitcher, { TemplateNoteTypes, useBuiltinTemplates } from "./NoteTypeSwitcher.js";

// happy-dom has no ResizeObserver; Dropdown only needs observe/disconnect to exist.
class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver);

let container: HTMLDivElement;

afterEach(() => {
    act(() => render(null, container));
    container.remove();
});

function mountHook() {
    const host = new Component();
    let templates: { builtinTemplates: FNote[]; collectionTemplates: FNote[] } | undefined;

    function Harness() {
        templates = useBuiltinTemplates();
        return null;
    }

    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => render(<ParentComponent.Provider value={host}><Harness /></ParentComponent.Provider>, container));

    return { host, getTemplates: () => templates };
}

// The hook resolves the root note, re-renders, then resolves the children — each async step
// needs its own act() round so the intermediate state commits and the next effect fires.
async function flush() {
    for (let i = 0; i < 3; i++) {
        await act(async () => { await new Promise((resolve) => setTimeout(resolve)); });
    }
}

describe("NoteTypeSwitcher", () => {
    it("offers a switch on a text note, and stays away from code notes", () => {
        // The switcher resolves the built-in templates through froca on mount.
        buildNote({ id: "_templates", title: "Templates" });

        expect(renderSwitcher(buildNote({ id: "textNote", title: "Note", type: "text" }))).not.toBeNull();
        expect(renderSwitcher(buildNote({ id: "codeNote", title: "Script", type: "code", mime: "application/javascript;env=backend" }))).toBeNull();
    });
});

function renderSwitcher(note: FNote) {
    if (container?.isConnected) {
        act(() => render(null, container));
        container.remove();
    }

    const host = new Component();
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => render(
        <ParentComponent.Provider value={host}><NoteTypeSwitcher note={note} /></ParentComponent.Provider>,
        container
    ));
    return container.querySelector(".note-type-switcher");
}

describe("TemplateNoteTypes", () => {
    it("re-resolves user templates on frocaReloaded (fresh FNote refs after unlock)", async () => {
        buildNote({ id: "userTemplate1", title: "[protected]" });
        const serverGetSpy = vi.spyOn(server, "get").mockResolvedValue({ templateNoteIds: [ "userTemplate1" ], newTemplateNoteIds: [] });

        const host = new Component();
        container = document.createElement("div");
        document.body.appendChild(container);
        act(() => render(
            <ParentComponent.Provider value={host}>
                <TemplateNoteTypes noteId="someNote" builtinTemplates={[]} />
            </ParentComponent.Provider>,
            container
        ));
        await flush();
        expect(serverGetSpy).toHaveBeenCalledWith("search-templates");

        // Unlock rebuilds froca: same noteId, new FNote instance with the decrypted title.
        buildNote({ id: "userTemplate1", title: "Meeting Notes" });
        serverGetSpy.mockClear();
        await act(async () => { await host.handleEvent("frocaReloaded", {}); });
        await flush();
        expect(serverGetSpy).toHaveBeenCalledWith("search-templates");

        // The dropdown renders its items only while open; opening is driven by Bootstrap's event.
        const dropdown = container.querySelector(".dropdown");
        expect(dropdown).not.toBeNull();
        await act(async () => {
            if (dropdown) window.$(dropdown).trigger("show.bs.dropdown");
        });
        expect(container.textContent).toContain("Meeting Notes");
        expect(container.textContent).not.toContain("[protected]");

        serverGetSpy.mockRestore();
    });
});

describe("useBuiltinTemplates", () => {
    it("swaps to fresh FNote refs on frocaReloaded (protected template titles decrypt after unlock)", async () => {
        // Locked protected session: the built-in template titles are the encrypted placeholder.
        buildNote({
            id: "_templates",
            title: "Templates",
            children: [
                { id: "_templateA", title: "[protected]", "#template": "" },
                { id: "_templateB", title: "[protected]", "#template": "", "#collection": "" }
            ]
        });

        const { host, getTemplates } = mountHook();
        await flush();

        const stale = getTemplates();
        expect(stale?.builtinTemplates.map((note) => note.title)).toEqual([ "[protected]" ]);
        expect(stale?.collectionTemplates.map((note) => note.title)).toEqual([ "[protected]" ]);

        // Unlocking rebuilds froca from scratch: same noteIds, brand-new FNote instances,
        // now with decrypted titles. The old instances stay orphaned in the hook's state
        // unless frocaReloaded triggers a re-resolve.
        buildNote({
            id: "_templates",
            title: "Templates",
            children: [
                { id: "_templateA", title: "Grid View", "#template": "" },
                { id: "_templateB", title: "Board", "#template": "", "#collection": "" }
            ]
        });

        await act(async () => { await host.handleEvent("frocaReloaded", {}); });
        await flush();

        const fresh = getTemplates();
        expect(fresh?.builtinTemplates.map((note) => note.title)).toEqual([ "Grid View" ]);
        expect(fresh?.collectionTemplates.map((note) => note.title)).toEqual([ "Board" ]);
        expect(fresh?.builtinTemplates[0]).not.toBe(stale?.builtinTemplates[0]);
    });
});
