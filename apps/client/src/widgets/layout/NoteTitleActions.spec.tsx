import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------
// The real subtrees (PromotedAttributes, SearchDefinitionTab, NoteTypeSwitcher, NoteLink) pull in
// froca/server/tree async chains; stub them so only NoteTitleActions' own branches are exercised.

const promotedState = {
    cells: undefined as unknown[] | undefined,
    setCells: vi.fn()
};
vi.mock("../PromotedAttributes", () => ({
    usePromotedAttributeData: () => [ promotedState.cells, promotedState.setCells ],
    PromotedAttributesContent: ({ note }: { note: { noteId: string } | null | undefined }) => (
        <div className="mock-promoted-content" data-note-id={note?.noteId} />
    )
}));

const noteDetailState = {
    extendedNoteType: "editableText" as string | undefined,
    fullHeight: false
};
vi.mock("../NoteDetail", () => ({
    getExtendedWidgetType: vi.fn(async () => noteDetailState.extendedNoteType),
    checkFullHeight: vi.fn(() => noteDetailState.fullHeight)
}));

vi.mock("../ribbon/SearchDefinitionTab", () => ({
    default: ({ note }: { note: { noteId: string } }) => (
        <div className="mock-search-definition" data-note-id={note.noteId} />
    )
}));

vi.mock("./NoteTypeSwitcher", () => ({
    default: ({ note }: { note: { noteId: string } | null | undefined }) => (
        <div className="mock-note-type-switcher" data-note-id={note?.noteId} />
    )
}));

vi.mock("../react/NoteLink", () => ({
    NewNoteLink: ({ notePath, className }: { notePath: string; className?: string }) => (
        <a className={className} data-note-path={notePath} />
    )
}));

const editedNotesState = {
    value: undefined as { noteId: string }[] | undefined
};
vi.mock("../ribbon/EditedNotesTab", () => ({
    useEditedNotes: () => editedNotesState.value
}));

import type NoteContext from "../../components/note_context";
import Component from "../../components/component";
import { buildNote } from "../../test/easy-froca";
import { NoteContextContext, ParentComponent } from "../react/react_utils";
import { checkFullHeight, getExtendedWidgetType } from "../NoteDetail";
import NoteTitleActions from "./NoteTitleActions";

// --- Render harness -------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
let parent: Component;

function renderActions(noteContext: NoteContext | null) {
    const target = document.createElement("div");
    container = target;
    document.body.appendChild(target);
    act(() => render((
        <ParentComponent.Provider value={parent}>
            <NoteContextContext.Provider value={noteContext}>
                <NoteTitleActions />
            </NoteContextContext.Provider>
        </ParentComponent.Provider>
    ), target));
    return target;
}

async function flush() {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

function fireEvent(name: string, data: unknown) {
    act(() => {
        (parent.handleEventInChildren as unknown as (n: string, d: unknown) => void)(name, data);
    });
}

function fakeNoteContext(overrides: Record<string, unknown> = {}): NoteContext {
    return {
        ntxId: "ntx1",
        hoistedNoteId: "root",
        notePath: "root/note1",
        viewScope: { viewMode: "default" },
        note: null,
        ...overrides
    } as unknown as NoteContext;
}

beforeEach(() => {
    parent = new Component();
    promotedState.cells = undefined;
    promotedState.setCells = vi.fn();
    noteDetailState.extendedNoteType = "editableText";
    noteDetailState.fullHeight = false;
    editedNotesState.value = undefined;
    vi.clearAllMocks();
});

afterEach(() => {
    if (container) {
        act(() => render(null, container as HTMLDivElement));
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------------------------------

describe("NoteTitleActions", () => {
    it("renders the root container and promoted/note-type for a default text note", async () => {
        const note = buildNote({ id: "textNote", title: "Text", type: "text" });
        const root = renderActions(fakeNoteContext({ note }));
        await flush();

        expect(root.querySelector(".title-actions")).toBeTruthy();
        // Default view mode renders the note-type switcher with the active note.
        const switcher = root.querySelector(".mock-note-type-switcher");
        expect(switcher?.getAttribute("data-note-id")).toBe("textNote");
        // Non-search note → no search properties collapsible.
        expect(root.querySelector(".mock-search-definition")).toBeNull();
        // getExtendedWidgetType is consulted to decide promoted-attribute expansion.
        expect(getExtendedWidgetType).toHaveBeenCalled();
        expect(checkFullHeight).toHaveBeenCalled();
    });

    it("omits the note-type switcher for non-default view modes", async () => {
        const note = buildNote({ id: "srcNote", title: "Src", type: "text" });
        const root = renderActions(fakeNoteContext({ note, viewScope: { viewMode: "source" } }));
        await flush();
        expect(root.querySelector(".mock-note-type-switcher")).toBeNull();
    });

    it("renders the note-type switcher when viewScope has no view mode", async () => {
        const note = buildNote({ id: "novmNote", title: "NoVM", type: "text" });
        const root = renderActions(fakeNoteContext({ note, viewScope: {} }));
        await flush();
        expect(root.querySelector(".mock-note-type-switcher")).toBeTruthy();
    });
});

describe("SearchProperties", () => {
    it("renders a collapsible with the search definition tab for search notes", async () => {
        const note = buildNote({ id: "searchNote", title: "Search", type: "search" });
        const root = renderActions(fakeNoteContext({ note }));
        await flush();

        const searchTab = root.querySelector(".mock-search-definition");
        expect(searchTab?.getAttribute("data-note-id")).toBe("searchNote");
        // The search definition lives inside a Collapsible.
        expect(root.querySelector(".collapsible")?.contains(searchTab)).toBe(true);
    });
});

describe("PromotedAttributes", () => {
    it("renders nothing for promoted attributes when there are no cells", async () => {
        const note = buildNote({ id: "noCells", title: "NC", type: "text" });
        const root = renderActions(fakeNoteContext({ note }));
        await flush();
        expect(root.querySelector(".mock-promoted-content")).toBeNull();
    });

    it("renders the promoted-attributes collapsible when cells exist (collapsed when full height)", async () => {
        promotedState.cells = [ { uniqueId: "c1" } ];
        noteDetailState.fullHeight = true; // → expanded = false
        const note = buildNote({ id: "withCells", title: "WC", type: "text" });
        const root = renderActions(fakeNoteContext({ note }));
        await flush();

        const content = root.querySelector(".mock-promoted-content");
        expect(content?.getAttribute("data-note-id")).toBe("withCells");
        const collapsible = content?.closest(".collapsible");
        expect(collapsible).toBeTruthy();
        expect(collapsible?.classList.contains("expanded")).toBe(false);
    });

    it("expands the promoted attributes when not full height", async () => {
        promotedState.cells = [ { uniqueId: "c1" } ];
        noteDetailState.fullHeight = false; // → expanded = true
        const note = buildNote({ id: "expandedCells", title: "EC", type: "text" });
        const root = renderActions(fakeNoteContext({ note }));
        await flush();
        const collapsible = root.querySelector(".mock-promoted-content")?.closest(".collapsible");
        expect(collapsible?.classList.contains("expanded")).toBe(true);
    });

    it("toggles the expansion via the toggleRibbonTabPromotedAttributes keyboard event", async () => {
        promotedState.cells = [ { uniqueId: "c1" } ];
        noteDetailState.fullHeight = true; // start collapsed
        const note = buildNote({ id: "toggleCells", title: "TC", type: "text" });
        const root = renderActions(fakeNoteContext({ note }));
        await flush();

        const before = root.querySelector(".mock-promoted-content")?.closest(".collapsible");
        expect(before?.classList.contains("expanded")).toBe(false);

        fireEvent("toggleRibbonTabPromotedAttributes", {});
        const after = root.querySelector(".mock-promoted-content")?.closest(".collapsible");
        expect(after?.classList.contains("expanded")).toBe(true);
    });
});

describe("EditedNotes", () => {
    it("does not render the edited-notes section without a dateNote label", async () => {
        editedNotesState.value = [ { noteId: "e1" } ];
        const note = buildNote({ id: "plainNote", title: "Plain", type: "text" });
        const root = renderActions(fakeNoteContext({ note }));
        await flush();
        expect(root.querySelector(".edited-notes")).toBeNull();
    });

    it("renders edited-note badges when the note has a dateNote label", async () => {
        editedNotesState.value = [ { noteId: "ed1" }, { noteId: "ed2" } ];
        const note = buildNote({ id: "dateNote", title: "Day", type: "text", "#dateNote": "2026-06-05" });
        const root = renderActions(fakeNoteContext({ note }));
        await flush();

        const section = root.querySelector(".edited-notes");
        expect(section).toBeTruthy();
        const badges = section?.querySelectorAll("a.badge");
        expect(badges?.length).toBe(2);
        expect(badges && Array.from(badges).map(b => b.getAttribute("data-note-path"))).toEqual([ "ed1", "ed2" ]);
    });

    it("renders the no-edited-notes placeholder when the list is empty", async () => {
        editedNotesState.value = [];
        const note = buildNote({ id: "emptyEdited", title: "Empty", type: "text", "#dateNote": "2026-06-05" });
        const root = renderActions(fakeNoteContext({ note }));
        await flush();

        const section = root.querySelector(".edited-notes");
        expect(section).toBeTruthy();
        expect(section?.querySelector(".no-edited-notes-found")).toBeTruthy();
        expect(section?.querySelector("a.badge")).toBeNull();
    });

    it("renders nothing inside the edited-notes body while still loading", async () => {
        editedNotesState.value = undefined; // useEditedNotes returns undefined → render is suppressed
        const note = buildNote({ id: "loadingEdited", title: "Loading", type: "text", "#dateNote": "2026-06-05" });
        const root = renderActions(fakeNoteContext({ note }));
        await flush();

        const section = root.querySelector(".edited-notes");
        expect(section).toBeTruthy();
        expect(section?.querySelector(".no-edited-notes-found")).toBeNull();
        expect(section?.querySelector("a.badge")).toBeNull();
    });
});

describe("no note", () => {
    it("renders only the container shell when there is no note context", async () => {
        const root = renderActions(null);
        await flush();
        expect(root.querySelector(".title-actions")).toBeTruthy();
        expect(root.querySelector(".mock-note-type-switcher")).toBeTruthy();
        expect(root.querySelector(".mock-search-definition")).toBeNull();
        expect(root.querySelector(".edited-notes")).toBeNull();
    });
});
