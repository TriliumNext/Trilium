import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../entities/fnote";

// The widget reads the note of the tab it sits in. Like the real hook, the mock re-renders its
// component when that note changes, which `shownNote.notify()` triggers.
const shownNote = vi.hoisted(() => ({ current: null as FNote | null, notify: () => {} }));
vi.mock("./react/hooks", async (importOriginal) => {
    const { useEffect, useState } = await import("preact/hooks");
    return {
        ...(await importOriginal<typeof import("./react/hooks")>()),
        useNoteContext: () => {
            const [ note, setNote ] = useState(shownNote.current);
            useEffect(() => {
                shownNote.notify = () => setNote(shownNote.current);
            }, []);
            return { note, notePath: note?.noteId, ntxId: "ntx1" };
        }
    };
});

import Component from "../components/component";
import server from "../services/server";
import { buildNote } from "../test/easy-froca";
import { ParentComponent } from "./react/react_utils";
import SearchResult from "./search_result";

let container: HTMLElement;
let parent: Component;

beforeEach(() => {
    parent = new Component();
    container = document.createElement("div");
    document.body.appendChild(container);
});

afterEach(() => {
    vi.restoreAllMocks();
    render(null, container);
    container.remove();
});

describe("SearchResult", () => {
    it("does not request search result details for a result note opened in the same tab", async () => {
        const post = vi.spyOn(server, "post").mockResolvedValue({ results: [] });
        const searchNote = buildNote({
            id: "searchNote",
            title: "Search",
            type: "search",
            children: [
                { id: "resultA", title: "A" },
                { id: "resultB", title: "B" }
            ]
        });
        searchNote.searchResultsLoaded = true;
        // `useNoteViewType()` reads the shown note, so only a note in list view reaches the card list;
        // a note in the default grid view mounts `SearchNoteList`, which fetches no details.
        const resultNote = buildNote({ id: "listNote", title: "List", "#viewType": "list" });

        shownNote.current = searchNote;
        await mount();
        expect(container.querySelectorAll(".search-result-card")).toHaveLength(2);
        expect(post).toHaveBeenCalledWith("search-note/searchNote/result-details", expect.anything());

        await settle(() => {
            shownNote.current = resultNote;
            shownNote.notify();
        });
        expect(post).not.toHaveBeenCalledWith("search-note/listNote/result-details", expect.anything());
        expect(container.querySelector(".search-results-list")).toBeNull();
    });
});

async function mount() {
    await settle(() => {
        render(<ParentComponent.Provider value={parent}><SearchResult /></ParentComponent.Provider>, container);
    });
}

async function settle(change: () => void) {
    await act(change);
    // Each pass flushes the effects of the re-render the previous one scheduled (`useNoteIds`
    // loading, `refresh()` updating the state, the details fetch).
    for (let pass = 0; pass < 3; pass++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    }
}
