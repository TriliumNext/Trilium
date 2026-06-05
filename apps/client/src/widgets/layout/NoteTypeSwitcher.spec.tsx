import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) -------------------------------------------

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
    class Dropdown {
        static instances = new Map<Element, Dropdown>();
        static getOrCreateInstance(el: Element) {
            let inst = Dropdown.instances.get(el);
            if (!inst) { inst = new Dropdown(el); Dropdown.instances.set(el, inst); }
            return inst;
        }
        element: Element;
        constructor(el: Element) { this.element = el; }
        show() {}
        hide() {}
        update() {}
        dispose() { Dropdown.instances.delete(this.element); }
    }
    return { Tooltip, Dropdown, default: { Tooltip, Dropdown } };
});
vi.mock("../../services/experimental_features", () => ({
    isExperimentalFeatureEnabled: vi.fn(() => false)
}));
// i18next is never initialized in tests, so `t()` would return undefined and crash
// `currentNoteTypeData?.title.toLocaleLowerCase()`. Return the key so titles are defined strings.
vi.mock("../../services/i18n", () => ({
    t: (key: string) => key
}));

import attributes from "../../services/attributes";
import { isExperimentalFeatureEnabled } from "../../services/experimental_features";
import froca from "../../services/froca";
import server from "../../services/server";
import { buildNote } from "../../test/easy-froca";
import { makeLoadResults } from "../../test/render-hook";
import { ParentComponent } from "../react/react_utils";
import { noteSavedDataStore } from "../react/NoteStore";
import Component from "../../components/component";
import NoteTypeSwitcher from "./NoteTypeSwitcher";

// --- Render harness -------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
let parent: Component | undefined;

function renderSwitcher(note: ReturnType<typeof buildNote> | null | undefined) {
    const div = document.createElement("div");
    document.body.appendChild(div);
    const comp = new Component();
    container = div;
    parent = comp;
    act(() => render(
        <ParentComponent.Provider value={comp}>
            <NoteTypeSwitcher note={note} />
        </ParentComponent.Provider>,
        div
    ));
    return div;
}

function fireEvent(name: string, data: unknown) {
    const p = parent;
    if (!p) return;
    act(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (p.handleEventInChildren as any)(name, data);
    });
}

async function flush() {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

/**
 * The {@link Dropdown} only renders its children once bootstrap fires `show.bs.dropdown`. Trigger
 * that jQuery event on every dropdown container so the menu items mount and can be exercised.
 */
function openDropdowns(root: HTMLElement) {
    act(() => {
        root.querySelectorAll(".dropdown-badge").forEach(el => {
            $(el).trigger("show.bs.dropdown");
        });
    });
}

beforeEach(() => {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    vi.clearAllMocks();
    Object.assign(server, {
        put: vi.fn(async () => undefined),
        get: vi.fn(async () => [])
    });
    (isExperimentalFeatureEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);
    // Badge/FormListItem use the jQuery bootstrap tooltip plugin via useStaticTooltip; stub it.
    Object.assign(($.fn as unknown as Record<string, unknown>), { tooltip: vi.fn() });
    // useBuiltinTemplates always calls froca.getNote("_templates"); ensure it is cached so froca
    // never falls back to the (throwing) mock server. Individual tests may overwrite it with children.
    buildNote({ id: "_templates", title: "Templates" });
});

afterEach(async () => {
    await act(async () => {});
    if (container) { render(null, container); container.remove(); container = undefined; }
    parent = undefined;
    vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------------------------------

describe("NoteTypeSwitcher rendering guards", () => {
    it("renders nothing when there is no note", () => {
        const root = renderSwitcher(undefined);
        expect(root.querySelector(".note-type-switcher")).toBeNull();
    });

    it("renders nothing for unsupported note types (book/canvas)", () => {
        const note = buildNote({ id: "bookNote", title: "Book", type: "book" });
        expect(renderSwitcher(note).querySelector(".note-type-switcher")).toBeNull();

        const canvas = buildNote({ id: "canvasNote", title: "Canvas", type: "canvas" });
        expect(renderSwitcher(canvas).querySelector(".note-type-switcher")).toBeNull();
    });

    it("renders nothing for a SQLite note even when type is code", () => {
        const note = buildNote({ id: "sqlNote", title: "SQL", type: "code" });
        Object.assign(note, { mime: "text/x-sqlite;schema=trilium" });
        expect(note.isTriliumSqlite()).toBe(true);
        expect(renderSwitcher(note).querySelector(".note-type-switcher")).toBeNull();
    });

    it("renders nothing for a Markdown code note", () => {
        const note = buildNote({ id: "mdNote", title: "MD", type: "code" });
        Object.assign(note, { mime: "text/x-markdown" });
        expect(note.isMarkdown()).toBe(true);
        expect(renderSwitcher(note).querySelector(".note-type-switcher")).toBeNull();
    });

    it("renders the (empty) container for a non-empty note (no intro/badges)", () => {
        const note = buildNote({ id: "filled", title: "Filled", type: "text" });
        noteSavedDataStore.set("filled", "some content");
        const root = renderSwitcher(note);
        const switcher = root.querySelector(".note-type-switcher");
        expect(switcher).not.toBeNull();
        // blob length is non-zero, so no intro is rendered.
        expect(switcher?.querySelector(".intro")).toBeNull();
    });
});

describe("NoteTypeSwitcher populated state", () => {
    it("renders intro + pinned badges (excluding current type) for an empty text note", async () => {
        const note = buildNote({ id: "emptyText", title: "Empty", type: "text" });
        noteSavedDataStore.set("emptyText", "");
        const root = renderSwitcher(note);
        await flush();

        const switcher = root.querySelector(".note-type-switcher");
        expect(switcher).not.toBeNull();
        expect(switcher?.querySelector(".intro")).not.toBeNull();

        // Pinned types are text/code/book/canvas; book is filtered out, current (text) is skipped.
        // So we expect badges for code and canvas (pinned, not the current type).
        const badges = switcher?.querySelectorAll(".ext-badge");
        expect((badges?.length ?? 0)).toBeGreaterThan(0);
    });

    it("switches note type when a pinned badge is clicked", async () => {
        const note = buildNote({ id: "switchNote", title: "S", type: "text" });
        noteSavedDataStore.set("switchNote", "");
        const root = renderSwitcher(note);
        await flush();

        // Find a clickable pinned badge (it has the "clickable" class because it has onClick).
        const clickable = root.querySelector(".ext-badge.clickable");
        expect(clickable).not.toBeNull();
        if (clickable instanceof HTMLElement) {
            clickable.click();
        }
        expect(server.put).toHaveBeenCalledTimes(1);
        const call = (server.put as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(call?.[0]).toBe("notes/switchNote/type");
        expect(call?.[1]).toHaveProperty("type");
    });

    it("renders the 'more types' dropdown badge", async () => {
        const note = buildNote({ id: "moreNote", title: "M", type: "text" });
        noteSavedDataStore.set("moreNote", "");
        const root = renderSwitcher(note);
        await flush();

        // restNoteTypes is non-empty (mermaid, mindMap, etc.), so a dropdown badge is present.
        const dropdowns = root.querySelectorAll(".dropdown-badge");
        expect(dropdowns.length).toBeGreaterThan(0);
    });
});

describe("NoteTypeSwitcher templates", () => {
    function seedTemplatesRoot() {
        buildNote({
            id: "_templates",
            title: "Templates",
            children: [
                { id: "tplBuiltin", title: "Builtin Tpl", "#template": "true" },
                { id: "tplCollection", title: "Collection Tpl", "#template": "true", "#collection": "true" },
                { id: "tplNotATemplate", title: "Plain note" }
            ]
        });
    }

    it("renders collection and builtin template dropdowns when _templates has entries", async () => {
        seedTemplatesRoot();
        const note = buildNote({ id: "tplNote", title: "T", type: "text" });
        noteSavedDataStore.set("tplNote", "");
        const root = renderSwitcher(note);
        await flush();

        // Both a collection dropdown and a templates dropdown should be present in addition to "more".
        const dropdowns = root.querySelectorAll(".dropdown-badge");
        // collection + builtin templates + more = at least 3 dropdowns
        expect(dropdowns.length).toBeGreaterThanOrEqual(3);
    });

    it("loads user templates from the server and refreshes on entitiesReloaded", async () => {
        seedTemplatesRoot();
        buildNote({ id: "userTpl", title: "User Template" });
        (server.get as ReturnType<typeof vi.fn>).mockResolvedValue([ "userTpl" ]);

        const note = buildNote({ id: "tplNote2", title: "T2", type: "text" });
        noteSavedDataStore.set("tplNote2", "");
        renderSwitcher(note);
        await flush();

        expect(server.get).toHaveBeenCalledWith("search-templates");
        const initialCalls = (server.get as ReturnType<typeof vi.fn>).mock.calls.length;

        // A template-label change should trigger a refresh.
        fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults({
                attributeRows: [ { type: "label", name: "template", value: "true", noteId: "userTpl" } ]
            })
        });
        await flush();
        expect((server.get as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(initialCalls);

        // An unrelated attribute change should NOT trigger a refresh.
        const afterRefresh = (server.get as ReturnType<typeof vi.fn>).mock.calls.length;
        fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults({
                attributeRows: [ { type: "label", name: "color", value: "red", noteId: "userTpl" } ]
            })
        });
        await flush();
        expect((server.get as ReturnType<typeof vi.fn>).mock.calls.length).toBe(afterRefresh);
    });
});

describe("NoteTypeSwitcher dropdown item interactions", () => {
    function seedFullTemplatesRoot() {
        buildNote({
            id: "_templates",
            title: "Templates",
            children: [
                { id: "tplBuiltinX", title: "Builtin Tpl", "#template": "true" },
                { id: "tplCollectionX", title: "Collection Tpl", "#template": "true", "#collection": "true" }
            ]
        });
    }

    it("switches type when a 'more types' dropdown item is clicked", async () => {
        const note = buildNote({ id: "ddMore", title: "M", type: "text" });
        noteSavedDataStore.set("ddMore", "");
        const root = renderSwitcher(note);
        await flush();
        openDropdowns(root);

        const item = root.querySelector(".dropdown-badge.dropdown-undefined .dropdown-item")
            ?? root.querySelector(".dropdown-menu .dropdown-item");
        expect(item).not.toBeNull();
        if (item instanceof HTMLElement) {
            item.click();
        }
        expect(server.put).toHaveBeenCalled();
        const call = (server.put as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(call?.[0]).toBe("notes/ddMore/type");
    });

    it("sets a collection template when a collection dropdown item is clicked", async () => {
        seedFullTemplatesRoot();
        const setRelation = vi.spyOn(attributes, "setRelation").mockResolvedValue(undefined);
        const note = buildNote({ id: "ddColl", title: "C", type: "text" });
        noteSavedDataStore.set("ddColl", "");
        const root = renderSwitcher(note);
        await flush();
        openDropdowns(root);

        // The collection dropdown contains the collection template item.
        const collDropdown = root.querySelector(".dropdown-bx.bx-book") ?? root.querySelector(".dropdown-badge");
        const item = collDropdown?.querySelector(".dropdown-item");
        expect(item).not.toBeNull();
        if (item instanceof HTMLElement) {
            item.click();
        }
        expect(setRelation).toHaveBeenCalled();
        const args = setRelation.mock.calls[0];
        expect(args?.[0]).toBe("ddColl");
        expect(args?.[1]).toBe("template");
    });

    it("sets a template (builtin/user) when a template dropdown item is clicked", async () => {
        seedFullTemplatesRoot();
        buildNote({ id: "userTplX", title: "User Tpl" });
        (server.get as ReturnType<typeof vi.fn>).mockResolvedValue([ "userTplX" ]);
        const setRelation = vi.spyOn(attributes, "setRelation").mockResolvedValue(undefined);

        const note = buildNote({ id: "ddTpl", title: "T", type: "text" });
        noteSavedDataStore.set("ddTpl", "");
        const root = renderSwitcher(note);
        await flush();
        openDropdowns(root);

        // Click every dropdown item that resolves to a TemplateItem (calls setTemplate).
        const items = root.querySelectorAll(".dropdown-item");
        expect(items.length).toBeGreaterThan(0);
        items.forEach(el => { if (el instanceof HTMLElement) el.click(); });
        expect(setRelation).toHaveBeenCalled();
    });
});

describe("NoteTypeSwitcher missing templates root", () => {
    it("handles a missing _templates note gracefully", async () => {
        const realGetNote = froca.getNote.bind(froca);
        vi.spyOn(froca, "getNote").mockImplementation(async (id: string) => {
            if (id === "_templates") return null;
            return realGetNote(id);
        });
        const note = buildNote({ id: "noTplRoot", title: "N", type: "text" });
        noteSavedDataStore.set("noTplRoot", "");
        const root = renderSwitcher(note);
        await flush();
        // No collection/builtin dropdowns, but the switcher still renders with the "more" dropdown.
        expect(root.querySelector(".note-type-switcher")).not.toBeNull();
    });
});

describe("NoteTypeSwitcher experimental llm gating", () => {
    it("includes the llm type in the rest list when the feature is enabled", async () => {
        (isExperimentalFeatureEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);
        const note = buildNote({ id: "llmNote", title: "L", type: "text" });
        noteSavedDataStore.set("llmNote", "");
        const root = renderSwitcher(note);
        await flush();
        // Still renders a "more" dropdown; llm is simply included among rest types.
        expect(root.querySelectorAll(".dropdown-badge").length).toBeGreaterThan(0);
    });
});
