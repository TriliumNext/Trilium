import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const shownContext = vi.hoisted(() => ({
    current: null as import("../entities/fnote").default | null,
    parentComponent: null as import("../components/component").default | null,
}));

vi.mock("./react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./react/hooks")>()),
    useNoteContext: () => ({
        note: shownContext.current,
        notePath: shownContext.current
            ? `root/${shownContext.current.noteId}`
            : "root",
        ntxId: "ntx1",
        parentComponent: shownContext.parentComponent,
    }),
}));

vi.mock("./collections/NoteList", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./collections/NoteList")>()),
    SearchNoteList: () => null,
}));

import type Component from "../components/component";
import type FNote from "../entities/fnote";
import froca from "../services/froca";
import toast from "../services/toast";
import { buildNote } from "../test/easy-froca";
import SearchResult from "./search_result";
import { ParentComponent } from "./react/react_utils";

describe("SearchResult", () => {
    const handlers = new Map<string, (data: unknown) => void>();
    const triggerEvent = vi.fn((name: string, data: unknown) => {
        handlers.get(name)?.(data);
    });
    const parent = {
        componentId: "cid",
        registerHandler: (name: string, callback: (data: unknown) => void) =>
            handlers.set(name, callback),
        removeHandler: () => {},
        triggerEvent,
    } as unknown as Component;
    const defaultLoadSearchNote = async (noteId: string) => {
        const note =
            (froca.notes[noteId] as FNote | undefined) ?? shownContext.current;
        if (note) {
            note.searchResultsLoaded = true;
        }
        return undefined as Awaited<ReturnType<typeof froca.loadSearchNote>>;
    };
    const loadSearchNote = vi.fn(defaultLoadSearchNote);
    const showError = vi.spyOn(toast, "showError");
    let container: HTMLDivElement | null = null;

    beforeEach(() => {
        handlers.clear();
        triggerEvent.mockClear();
        loadSearchNote.mockReset();
        loadSearchNote.mockImplementation(defaultLoadSearchNote);
        showError.mockClear();
        shownContext.current = null;
        shownContext.parentComponent = parent;
        froca.loadSearchNote =
            loadSearchNote as unknown as typeof froca.loadSearchNote;
    });

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = null;
        }
    });

    function showSavedSearchButton() {
        const savedSearch = buildNote({
            title: "My search",
            type: "search",
            "#searchString": "#tcfindme",
        });
        shownContext.current = savedSearch;
        const mountedContainer = document.createElement("div");
        container = mountedContainer;
        document.body.appendChild(mountedContainer);

        act(() =>
            render(
                <ParentComponent.Provider value={parent}>
                    <SearchResult />
                </ParentComponent.Provider>,
                mountedContainer,
            ),
        );

        const button = mountedContainer.querySelector("button");
        if (!button) {
            throw new Error("Search now button not found");
        }
        return { savedSearch, button, mountedContainer };
    }

    it("surfaces errors returned by a saved search", async () => {
        const { savedSearch, button } = showSavedSearchButton();
        loadSearchNote.mockResolvedValue({ error: "Invalid saved search" });

        await act(async () => {
            button.click();
        });

        expect(loadSearchNote).toHaveBeenCalledWith(savedSearch.noteId);
        expect(showError).toHaveBeenCalledWith("Invalid saved search");
        expect(triggerEvent).toHaveBeenCalledWith("searchRefreshed", {
            ntxId: "ntx1",
        });
    });

    it("refreshes a saved search without showing an error when it succeeds", async () => {
        const { savedSearch, button, mountedContainer } =
            showSavedSearchButton();

        await act(async () => {
            button.click();
        });

        expect(loadSearchNote).toHaveBeenCalledWith(savedSearch.noteId);
        expect(showError).not.toHaveBeenCalled();
        expect(mountedContainer.querySelector("button")).toBeNull();
        expect(triggerEvent).toHaveBeenCalledWith("searchRefreshed", {
            ntxId: "ntx1",
        });
    });
});
