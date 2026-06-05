import $ from "jquery";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

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
        static getOrCreateInstance() { return new Dropdown(); }
        static getInstance() { return null; }
        show() {}
        hide() {}
        toggle() {}
        dispose() {}
    }
    return { Tooltip, Dropdown, default: { Tooltip, Dropdown } };
});

vi.mock("../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/utils")>()),
    isMobile: vi.fn(() => false),
    isDesktop: vi.fn(() => true)
}));

vi.mock("../../services/toast", () => ({
    default: {
        showError: vi.fn(),
        showMessage: vi.fn(),
        showPersistent: vi.fn(),
        closePersistent: vi.fn()
    }
}));

import appContext from "../../components/app_context";
import Component from "../../components/component";
import attributes from "../../services/attributes";
import bulk_action from "../../services/bulk_action";
import froca from "../../services/froca";
import server from "../../services/server";
import toast from "../../services/toast";
import tree from "../../services/tree";
import { isMobile } from "../../services/utils";
import ws from "../../services/ws";
import { buildNote } from "../../test/easy-froca";
import { ParentComponent } from "../react/react_utils";
import SearchDefinitionTab from "./SearchDefinitionTab";

// --- Render helper --------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
let parent: Component;

function renderTab(props: { note: ReturnType<typeof buildNote> | null | undefined; ntxId?: string | null; hidden?: boolean }) {
    const target = document.createElement("div");
    container = target;
    document.body.appendChild(target);
    act(() => {
        render((
            <ParentComponent.Provider value={parent}>
                <SearchDefinitionTab note={props.note} ntxId={props.ntxId ?? "ntx1"} hidden={props.hidden ?? false} />
            </ParentComponent.Provider>
        ), target);
    });
    return target;
}

function fireEvent(name: string, data: unknown) {
    act(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (parent.handleEventInChildren as any)(name, data);
    });
}

async function flush() {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

let originalTooltip: unknown;

beforeEach(() => {
    // happy-dom's jQuery has no bootstrap `.tooltip()` plugin; stub it for the tooltip hook.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    originalTooltip = ($.fn as any).tooltip;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ($.fn as any).tooltip = vi.fn();
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    vi.clearAllMocks();
    parent = new Component();
    // The auto-mocked server (test/setup.ts) only defines get/post — add the write verbs used here.
    Object.assign(server, {
        put: vi.fn(async () => undefined),
        post: vi.fn(async () => ({})),
        get: vi.fn(async () => ({ searchResultNoteIds: [], highlightedTokens: [] })),
        remove: vi.fn(async () => undefined)
    });
    Object.assign(ws, { logError: vi.fn(), waitForMaxKnownEntityChangeId: vi.fn(async () => undefined) });
    (isMobile as ReturnType<typeof vi.fn>).mockReturnValue(false);
});

afterEach(async () => {
    await act(async () => {});
    if (container) { render(null, container); container.remove(); container = undefined; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ($.fn as any).tooltip = originalTooltip;
    vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------------------------------

describe("SearchDefinitionTab", () => {
    it("renders nothing meaningful when there is no note", () => {
        const el = renderTab({ note: null });
        expect(el.querySelector(".search-definition-widget")).not.toBeNull();
        // No note → the inner table is not rendered.
        expect(el.querySelector(".search-setting-table")).toBeNull();
    });

    it("does not render the table when hidden, even with a note", () => {
        const note = buildNote({ id: "sd-hidden", title: "Search", type: "search" });
        const el = renderTab({ note, hidden: true });
        expect(el.querySelector(".search-setting-table")).toBeNull();
    });

    it("lists every search option as an available add-button when none are active", () => {
        const note = buildNote({ id: "sd-empty", title: "Search", type: "search" });
        const el = renderTab({ note });
        expect(el.querySelector(".search-setting-table")).not.toBeNull();
        // All 8 search options plus the bulk-action add toggle live in the add cell.
        const addCell = el.querySelector(".add-search-option");
        expect(addCell).not.toBeNull();
        const addButtons = addCell?.querySelectorAll("button") ?? [];
        // 8 option buttons + 1 bulk-action dropdown toggle.
        expect(addButtons.length).toBeGreaterThanOrEqual(8);
        // No active options yet.
        expect(el.querySelector(".search-options")?.children.length ?? 0).toBe(0);
    });

    it("renders active options (non-input ones) and moves them out of the available list", () => {
        const note = buildNote({
            id: "sd-active",
            title: "Search",
            type: "search",
            "#fastSearch": "",
            "#debug": "",
            "#includeArchivedNotes": ""
        });
        const el = renderTab({ note });
        const activeRows = el.querySelectorAll(".search-options tr");
        // The three active options each render a row.
        expect(activeRows.length).toBe(3);
        // Three fewer available add-buttons (option buttons), so 5 option buttons remain.
        const addButtons = el.querySelector(".add-search-option")?.querySelectorAll("button") ?? [];
        // 5 remaining option buttons + bulk-action toggle.
        expect(addButtons.length).toBeGreaterThanOrEqual(5);
    });

    it("setAttribute is invoked with the option's default value when clicking an add-button", () => {
        const setAttr = vi.spyOn(attributes, "setAttribute").mockResolvedValue(undefined);
        const note = buildNote({ id: "sd-add", title: "Search", type: "search" });
        const el = renderTab({ note });
        const firstAddButton = el.querySelector(".add-search-option button");
        act(() => (firstAddButton as HTMLButtonElement | null)?.click());
        expect(setAttr).toHaveBeenCalled();
        const callArgs = setAttr.mock.calls[0];
        expect(callArgs?.[0]).toBe(note);
    });

    it("refreshes the option list when an affecting attribute row is reloaded", () => {
        const note = buildNote({ id: "sd-reload", title: "Search", type: "search" });
        const el = renderTab({ note });
        expect(el.querySelector(".search-options")?.children.length ?? 0).toBe(0);

        // Add a debug label directly, then fire the entitiesReloaded event so refreshOptions re-runs.
        buildNote({ id: "sd-reload", title: "Search", type: "search", "#debug": "" });
        fireEvent("entitiesReloaded", {
            loadResults: {
                getAttributeRows: () => [ { type: "label", name: "debug", value: "", noteId: "sd-reload", isDeleted: false } ]
            }
        });
        expect(el.querySelector(".search-options")?.children.length ?? 0).toBe(1);
    });

    it("ignores entitiesReloaded events whose attribute rows do not affect the note", () => {
        const note = buildNote({ id: "sd-ignore", title: "Search", type: "search" });
        const el = renderTab({ note });
        fireEvent("entitiesReloaded", {
            loadResults: {
                getAttributeRows: () => [ { type: "label", name: "debug", value: "", noteId: "some-other-uncached", isDeleted: false } ]
            }
        });
        // Nothing changed.
        expect(el.querySelector(".search-options")?.children.length ?? 0).toBe(0);
    });

    it("renders the mobile add-option dropdown when isMobile() is true and adds via a list item", () => {
        (isMobile as ReturnType<typeof vi.fn>).mockReturnValue(true);
        const setAttr = vi.spyOn(attributes, "setAttribute").mockResolvedValue(undefined);
        const note = buildNote({ id: "sd-mobile", title: "Search", type: "search" });
        const el = renderTab({ note });
        // Mobile: the add-option toggle dropdown is present instead of inline buttons.
        expect(el.querySelector(".add-search-option .action-add-toggle")).not.toBeNull();

        // The Dropdown renders its children only once opened (`{shown && children}`); open it by
        // firing the bootstrap show event that the component listens for on its container.
        const dropdownContainer = el.querySelector(".add-search-option .dropdown");
        expect(dropdownContainer).not.toBeNull();
        if (dropdownContainer) {
            act(() => { $(dropdownContainer).trigger("show.bs.dropdown"); });
        }
        const items = el.querySelectorAll(".add-search-option .mobile-bottom-menu li.dropdown-item");
        expect(items.length).toBeGreaterThanOrEqual(8);
        act(() => (items[0] as HTMLElement).click());
        expect(setAttr).toHaveBeenCalled();
        expect(setAttr.mock.calls[0]?.[0]).toBe(note);
    });
});

describe("SearchDefinitionTab — search actions", () => {
    it("invokes loadSearchNote and triggers searchRefreshed when the search button is clicked", async () => {
        const loadSearch = vi.spyOn(froca, "loadSearchNote").mockResolvedValue(undefined);
        const triggerSpy = vi.spyOn(parent, "triggerEvent").mockReturnValue(undefined);
        const note = buildNote({ id: "sd-search", title: "Search", type: "search" });
        const el = renderTab({ note });

        const searchButton = el.querySelector(".search-actions-container button");
        await act(async () => { (searchButton as HTMLButtonElement | null)?.click(); });
        await flush();

        expect(loadSearch).toHaveBeenCalledWith("sd-search");
        expect(triggerSpy).toHaveBeenCalledWith("searchRefreshed", { ntxId: "ntx1" });
    });

    it("sets an error and still triggers searchRefreshed when loadSearchNote returns an error", async () => {
        vi.spyOn(froca, "loadSearchNote").mockResolvedValue({ error: "boom" } as unknown as Awaited<ReturnType<typeof froca.loadSearchNote>>);
        const triggerSpy = vi.spyOn(parent, "triggerEvent").mockReturnValue(undefined);
        // Active searchString option so the error Admonition has somewhere to render.
        const note = buildNote({ id: "sd-err", title: "Search", type: "search", "#searchString": "abc" });
        const el = renderTab({ note });

        const searchButton = el.querySelector(".search-actions-container button");
        await act(async () => { (searchButton as HTMLButtonElement | null)?.click(); });
        await flush();

        expect(triggerSpy).toHaveBeenCalledWith("searchRefreshed", { ntxId: "ntx1" });
    });

    it("shows a toast error when loadSearchNote throws", async () => {
        vi.spyOn(froca, "loadSearchNote").mockRejectedValue(new Error("network down"));
        const note = buildNote({ id: "sd-throw", title: "Search", type: "search" });
        const el = renderTab({ note });

        const searchButton = el.querySelector(".search-actions-container button");
        await act(async () => { (searchButton as HTMLButtonElement | null)?.click(); });
        await flush();

        expect(toast.showError).toHaveBeenCalledWith("network down");
    });

    it("posts to search-and-execute-note and shows a message for the execute action", async () => {
        vi.spyOn(froca, "loadSearchNote").mockResolvedValue(undefined);
        const note = buildNote({ id: "sd-exec", title: "Search", type: "search" });
        const el = renderTab({ note });

        // The execute button is the second button in the desktop actions container.
        const buttons = el.querySelectorAll(".search-actions-container button");
        const executeButton = buttons[1];
        await act(async () => { (executeButton as HTMLButtonElement | null)?.click(); });
        await flush();

        expect(server.post).toHaveBeenCalledWith("search-and-execute-note/sd-exec");
        expect(toast.showMessage).toHaveBeenCalled();
    });

    it("does not render the save-to-note button for a note that is not hidden completely", () => {
        // A note whose parent is root → not hidden completely → no save button (only 2 buttons).
        buildNote({ id: "root", title: "Root", children: [ { id: "sd-visible", title: "Search", type: "search" } ] });
        const note = froca.notes["sd-visible"];
        expect(note?.isHiddenCompletely()).toBe(false);
        const el = renderTab({ note });
        const buttons = el.querySelectorAll(".search-actions-container button");
        expect(buttons.length).toBe(2);
    });

    it("renders the save-to-note button and saves when the note is hidden completely", async () => {
        buildNote({ id: "_hidden", title: "Hidden", children: [ { id: "sd-hiddenchild", title: "Search", type: "search" } ] });
        const note = froca.notes["sd-hiddenchild"];
        expect(note?.isHiddenCompletely()).toBe(true);

        (server.post as ReturnType<typeof vi.fn>).mockResolvedValue({ notePath: "root/sd-hiddenchild" });
        const setNote = vi.fn(async () => undefined);
        appContext.tabManager = { getActiveContext: vi.fn(() => ({ setNote })) } as never;
        vi.spyOn(tree, "getNotePathTitle").mockResolvedValue("Some Path");

        const el = renderTab({ note });
        const buttons = el.querySelectorAll(".search-actions-container button");
        // The save button is the third one.
        expect(buttons.length).toBe(3);
        await act(async () => { (buttons[2] as HTMLButtonElement | null)?.click(); });
        await flush();

        expect(server.post).toHaveBeenCalledWith("special-notes/save-search-note", { searchNoteId: "sd-hiddenchild" });
        expect(setNote).toHaveBeenCalledWith("root/sd-hiddenchild");
        expect(toast.showMessage).toHaveBeenCalled();
    });

    it("aborts the save flow early when the server returns no notePath", async () => {
        buildNote({ id: "_hidden", title: "Hidden", children: [ { id: "sd-nopath", title: "Search", type: "search" } ] });
        const note = froca.notes["sd-nopath"];
        (server.post as ReturnType<typeof vi.fn>).mockResolvedValue({ notePath: undefined });
        const getActiveContext = vi.fn();
        appContext.tabManager = { getActiveContext } as never;

        const el = renderTab({ note });
        const buttons = el.querySelectorAll(".search-actions-container button");
        await act(async () => { (buttons[2] as HTMLButtonElement | null)?.click(); });
        await flush();

        expect(getActiveContext).not.toHaveBeenCalled();
    });

    it("renders the mobile split button for search actions when isMobile() is true", () => {
        (isMobile as ReturnType<typeof vi.fn>).mockReturnValue(true);
        const note = buildNote({ id: "sd-mobile-actions", title: "Search", type: "search" });
        const el = renderTab({ note });
        expect(el.querySelector(".search-actions .btn-group")).not.toBeNull();
    });
});

describe("SearchDefinitionTab — bulk actions", () => {
    it("renders parsed bulk actions from the note's action labels", () => {
        const action = JSON.stringify({ name: "renameNote", newTitle: "X" });
        const note = buildNote({ id: "sd-bulk", title: "Search", type: "search", "#action": action });
        const el = renderTab({ note });
        const actionRows = el.querySelector(".action-options");
        expect(actionRows).not.toBeNull();
        expect(actionRows?.children.length ?? 0).toBe(1);
    });

    it("refreshes the bulk actions list when an affecting action label is reloaded", () => {
        const note = buildNote({ id: "sd-bulk-reload", title: "Search", type: "search" });
        const el = renderTab({ note });
        expect(el.querySelector(".action-options")?.children.length ?? 0).toBe(0);

        // Add an action label, then fire the reload so refreshBulkActions re-parses.
        buildNote({ id: "sd-bulk-reload", title: "Search", type: "search", "#action": JSON.stringify({ name: "renameNote" }) });
        fireEvent("entitiesReloaded", {
            loadResults: {
                getAttributeRows: () => [ { type: "label", name: "action", value: "", noteId: "sd-bulk-reload", isDeleted: false } ]
            }
        });
        expect(el.querySelector(".action-options")?.children.length ?? 0).toBe(1);
    });

    it("ignores entitiesReloaded events for non-action labels in the bulk actions list", () => {
        const note = buildNote({ id: "sd-bulk-ignore", title: "Search", type: "search" });
        const el = renderTab({ note });
        fireEvent("entitiesReloaded", {
            loadResults: {
                getAttributeRows: () => [ { type: "label", name: "debug", value: "", noteId: "sd-bulk-ignore", isDeleted: false } ]
            }
        });
        expect(el.querySelector(".action-options")?.children.length ?? 0).toBe(0);
    });

    it("adds a bulk action via the dropdown items", () => {
        const addAction = vi.spyOn(bulk_action, "addAction").mockResolvedValue(undefined);
        const note = buildNote({ id: "sd-add-action", title: "Search", type: "search" });
        const el = renderTab({ note });

        // Find the bulk-action Dropdown by its toggle button, then open it (children are lazy:
        // `{shown && children}`) by firing the bootstrap show event on the dropdown container.
        const toggle = el.querySelector(".add-search-option .action-add-toggle.btn-sm");
        expect(toggle).not.toBeNull();
        const dropdownContainer = toggle?.closest(".dropdown");
        expect(dropdownContainer).not.toBeNull();
        if (dropdownContainer) {
            act(() => { $(dropdownContainer).trigger("show.bs.dropdown"); });
        }

        // Each action-group entry is a FormListItem (li.dropdown-item) with an onClick that adds it.
        const items = el.querySelectorAll(".action-add-toggle.btn-sm + .dropdown-menu li.dropdown-item");
        expect(items.length).toBeGreaterThanOrEqual(1);
        act(() => (items[0] as HTMLElement).click());
        expect(addAction).toHaveBeenCalled();
        expect(addAction.mock.calls[0]?.[0]).toBe("sd-add-action");
    });
});
