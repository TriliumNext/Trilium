import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The widget follows the note the tab shows; the tests hand it one directly.
const shownNote = vi.hoisted(() => ({ current: null as import("../entities/fnote").default | null }));
vi.mock("./react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./react/hooks")>()),
    useNoteContext: () => ({
        note: shownNote.current,
        notePath: shownNote.current ? `root/${shownNote.current.noteId}` : "root",
        ntxId: "ntx1"
    })
}));

// The rendered result list is a world of its own; the contract under test is the wiring around it.
vi.mock("./collections/NoteList", () => ({
    SearchNoteList: () => null
}));

import type Component from "../components/component";
import type FNote from "../entities/fnote";
import froca from "../services/froca";
import { buildNote } from "../test/easy-froca";
import SearchResult from "./search_result";
import { ParentComponent } from "./react/react_utils";

describe("SearchResult", () => {
    let container: HTMLDivElement;
    const handlers = new Map<string, (data: unknown) => void>();
    const triggerEvent = vi.fn((name: string, data: unknown) => {
        // Route the event back through the registered handler, the way a real parent would.
        handlers.get(name)?.(data);
    });
    const parent = {
        componentId: "cid",
        registerHandler: (name: string, callback: (data: unknown) => void) => handlers.set(name, callback),
        removeHandler: () => {},
        triggerEvent
    } as unknown as Component;

    const loadSearchNote = vi.fn(async (noteId: string) => {
        // Mirror what the real loader does to the note it loads.
        (froca.notes[noteId] as FNote | undefined ?? shownNote.current)!.searchResultsLoaded = true;
    });

    beforeEach(() => {
        handlers.clear();
        triggerEvent.mockClear();
        loadSearchNote.mockClear();
        froca.loadSearchNote = loadSearchNote as unknown as typeof froca.loadSearchNote;
    });

    let mounted: HTMLDivElement | null = null;

    function mount() {
        const host = document.createElement("div");
        document.body.appendChild(host);
        act(() => render(
            <ParentComponent.Provider value={parent}>
                <SearchResult />
            </ParentComponent.Provider>,
            host
        ));
        mounted = host;
        return host;
    }

    afterEach(() => {
        if (mounted) {
            render(null, mounted);
            mounted.remove();
            mounted = null;
        }
    });

    it("runs the saved search itself instead of navigating to a new empty one", async () => {
        // Regression (#11130): the "Search now" button used to trigger the global `searchNotes`
        // command, which creates a brand-new search note with an empty string and navigates to
        // it — the one affordance on this screen abandoned the search it was supposed to run.
        const savedSearch = buildNote({ title: "My search", type: "search", "#searchString": "#tcfindme" });
        shownNote.current = savedSearch;
        container = mount();

        const button = container.querySelector("button");
        expect(button).toBeTruthy();
        expect(button?.dataset.triggerCommand).toBeUndefined();

        await act(async () => {
            button?.click();
        });

        expect(loadSearchNote).toHaveBeenCalledWith(savedSearch.noteId);
        expect(triggerEvent).toHaveBeenCalledWith("searchRefreshed", { ntxId: "ntx1" });

        // The event routed back through the parent flipped the widget out of the empty state.
        expect(container.querySelector("button")).toBeNull();
    });

    it("keeps the empty state for a non-search note", () => {
        shownNote.current = buildNote({ title: "Plain text" });
        container = mount();

        expect(container.querySelector("button")).toBeNull();
        expect(loadSearchNote).not.toHaveBeenCalled();
    });
});
