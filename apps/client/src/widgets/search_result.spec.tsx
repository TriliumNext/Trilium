import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../entities/fnote";

// The widget reads the note of the tab it sits in. Like the real hook, the mock re-renders its
// component when that note changes, which `shownNote.notify()` triggers.
const shownNote = vi.hoisted(() => ({
    current: null as FNote | null,
    notify: () => {},
    parentComponent: null as import("../components/component").default | null
}));
const shownTab = vi.hoisted(() => ({ activeMainNtxId: "ntx1" as string | null }));
const tabContext = vi.hoisted(() => ({ ntxId: "ntx1", getMainContext() { return tabContext; } }));
vi.mock("./react/hooks", async (importOriginal) => {
    const { useEffect, useState } = await import("preact/hooks");
    return {
        ...(await importOriginal<typeof import("./react/hooks")>()),
        useNoteContext: () => {
            const [ note, setNote ] = useState(shownNote.current);
            useEffect(() => {
                shownNote.notify = () => setNote(shownNote.current);
            }, []);
            return {
                note,
                notePath: note?.noteId,
                ntxId: "ntx1",
                noteContext: tabContext,
                parentComponent: shownNote.parentComponent
            };
        }
    };
});

import appContext from "../components/app_context";
import Component from "../components/component";
import froca from "../services/froca";
import server from "../services/server";
import toast from "../services/toast";
import { buildNote } from "../test/easy-froca";
import { ParentComponent } from "./react/react_utils";
import SearchResult from "./search_result";

const realTabManager = appContext.tabManager;
let container: HTMLElement;
let parent: Component;

beforeEach(() => {
    shownTab.activeMainNtxId = "ntx1";
    // Client tests run without app start-up, which is what creates the tab manager.
    appContext.tabManager = {
        getActiveMainContext: () =>
            (shownTab.activeMainNtxId ? { ntxId: shownTab.activeMainNtxId } : null)
    } as never;
    window.glob.TRILIUM_SAFE_MODE = false;
    parent = new Component();
    shownNote.parentComponent = parent;
    container = document.createElement("div");
    document.body.appendChild(container);
});

afterEach(() => {
    vi.restoreAllMocks();
    appContext.tabManager = realTabManager;
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

    it("runs the shown saved search from \"Search now\" instead of opening a new search", async () => {
        const savedSearch = buildNote({ id: "savedSearch", title: "My search", type: "search", "#searchString": "#book" });
        const loadSearchNote = vi.spyOn(froca, "loadSearchNote").mockImplementation(async () => {
            savedSearch.searchResultsLoaded = true;
            return undefined;
        });
        const showError = vi.spyOn(toast, "showError").mockImplementation(() => {});
        const triggerEvent = vi.spyOn(parent, "triggerEvent").mockImplementation((name, data) => parent.handleEvent(name, data));
        window.glob.TRILIUM_SAFE_MODE = true;

        shownNote.current = savedSearch;
        await mount();
        await settle(() => clickSearchNow());

        expect(loadSearchNote).toHaveBeenCalledWith("savedSearch");
        expect(triggerEvent).toHaveBeenCalledWith("searchRefreshed", { ntxId: "ntx1" });
        expect(triggerEvent).not.toHaveBeenCalledWith("searchNotes", expect.anything());
        expect(showError).not.toHaveBeenCalled();
        expect(container.querySelector("button")).toBeNull();
    });

    it("shows the results of a saved search loaded elsewhere, such as by expanding it in the tree", async () => {
        const savedSearch = buildNote({ id: "treeSearch", title: "Tree search", type: "search", "#searchString": "#book" });
        const result = buildNote({ id: "treeResult", title: "Result" });
        vi.spyOn(server, "get").mockResolvedValue({ searchResultNoteIds: [ result.noteId ], highlightedTokens: [], error: null });
        vi.spyOn(appContext, "triggerEvent").mockImplementation(async (name, data) => parent.handleEvent(name, data));
        window.glob.TRILIUM_SAFE_MODE = true;

        shownNote.current = savedSearch;
        await mount();
        expect(container.querySelector(".no-items .bx-file-find")).not.toBeNull();

        await settle(() => { void froca.loadSearchNote(savedSearch.noteId); });

        expect(container.querySelector(".no-items")).toBeNull();
        expect(container.textContent).toContain("Result");
    });

    it("reports an error from the saved search as a toast", async () => {
        const savedSearch = buildNote({ id: "badSearch", title: "Bad search", type: "search", "#searchString": "#" });
        vi.spyOn(froca, "loadSearchNote").mockResolvedValue({ error: "Invalid saved search" });
        const showError = vi.spyOn(toast, "showError").mockImplementation(() => {});
        window.glob.TRILIUM_SAFE_MODE = true;

        shownNote.current = savedSearch;
        await mount();
        await settle(() => clickSearchNow());

        expect(showError).toHaveBeenCalledWith("Invalid saved search");
    });
});

describe("running a saved search when it is shown", () => {
    it("runs a search shown in the active tab and shows progress until it answers", async () => {
        const savedSearch = searchNote("autoSearch", "#book");
        const result = buildNote({ id: "autoResult", title: "Auto result" });
        let answer: (value: unknown) => void = () => {};
        const pending = new Promise((resolve) => { answer = resolve; });
        const get = vi.spyOn(server, "get").mockReturnValue(pending as never);
        vi.spyOn(appContext, "triggerEvent")
            .mockImplementation(async (name, data) => parent.handleEvent(name, data));

        shownNote.current = savedSearch;
        await mount();

        expect(get).toHaveBeenCalledWith("search-note/autoSearch");
        expect(container.querySelector(".no-items .bx-loader-alt")).not.toBeNull();
        expect(container.querySelector("button")).toBeNull();

        await settle(() => answer({
            searchResultNoteIds: [ result.noteId ],
            highlightedTokens: [],
            error: null
        }));
        expect(container.querySelector(".no-items")).toBeNull();
        expect(container.textContent).toContain("Auto result");
    });

    it("keeps a search's progress when an earlier one in the same tab finishes first", async () => {
        const first = searchNote("firstSearch", "#a");
        const second = searchNote("secondSearch", "#b");
        const answers: Record<string, () => void> = {};
        vi.spyOn(froca, "loadSearchNote").mockImplementation((noteId) =>
            new Promise((resolve) => { answers[noteId] = () => resolve(undefined); }));

        shownNote.current = first;
        await mount();
        await settle(() => {
            shownNote.current = second;
            shownNote.notify();
        });
        await settle(() => answers.firstSearch());

        expect(container.querySelector(".no-items .bx-loader-alt")).not.toBeNull();
        expect(container.querySelector("button")).toBeNull();
    });

    it("does not run a search shown again while its first run is pending", async () => {
        const savedSearch = searchNote("pendingSearch", "#book");
        let fail: () => void = () => {};
        const loadSearchNote = vi.spyOn(froca, "loadSearchNote").mockImplementation(() =>
            new Promise((_, reject) => { fail = () => reject(new Error("Network down")); }));
        vi.spyOn(toast, "showError").mockImplementation(() => {});

        shownNote.current = savedSearch;
        await mount();
        await settle(() => {
            shownNote.current = buildNote({ id: "otherNote", title: "Other" });
            shownNote.notify();
        });
        await settle(() => {
            shownNote.current = savedSearch;
            shownNote.notify();
        });

        expect(loadSearchNote).toHaveBeenCalledOnce();
        expect(container.querySelector(".no-items .bx-loader-alt")).not.toBeNull();

        await settle(() => fail());
        expect(container.querySelector("button")).not.toBeNull();
    });

    it("waits for a background tab to be shown before running its saved search", async () => {
        const savedSearch = searchNote("backgroundSearch", "#book");
        const loadSearchNote = vi.spyOn(froca, "loadSearchNote").mockResolvedValue(undefined);
        shownTab.activeMainNtxId = "otherTab";

        shownNote.current = savedSearch;
        await mount();
        expect(loadSearchNote).not.toHaveBeenCalled();

        await settle(() => {
            shownTab.activeMainNtxId = "ntx1";
            void parent.handleEvent("activeNoteChanged", { ntxId: "ntx1" });
        });
        expect(loadSearchNote).toHaveBeenCalledExactlyOnceWith("backgroundSearch");
    });

    it("leaves the search to \"Search now\" in safe mode and after a failed request", async () => {
        const safeSearch = searchNote("safeSearch", "#book");
        const loadSearchNote = vi.spyOn(froca, "loadSearchNote")
            .mockRejectedValue(new Error("Network down"));
        vi.spyOn(toast, "showError").mockImplementation(() => {});
        window.glob.TRILIUM_SAFE_MODE = true;

        shownNote.current = safeSearch;
        await mount();
        expect(loadSearchNote).not.toHaveBeenCalled();
        expect(container.querySelector(".no-items .bx-file-find")).not.toBeNull();

        render(null, container);
        window.glob.TRILIUM_SAFE_MODE = false;
        const failingSearch = searchNote("failingSearch", "#book");
        shownNote.current = failingSearch;
        await mount();

        expect(loadSearchNote).toHaveBeenCalledExactlyOnceWith("failingSearch");
        expect(container.querySelector(".no-items .bx-file-find")).not.toBeNull();
        expect(container.querySelector("button")).not.toBeNull();

        // Showing the note again, after another one, tries once more.
        await settle(() => {
            shownNote.current = buildNote({ id: "otherNote", title: "Other" });
            shownNote.notify();
        });
        await settle(() => {
            shownNote.current = failingSearch;
            shownNote.notify();
        });
        expect(loadSearchNote).toHaveBeenCalledTimes(2);
    });
});

function searchNote(id: string, searchString: string) {
    return buildNote({ id, title: id, type: "search", "#searchString": searchString });
}

async function mount() {
    await settle(() => {
        render(<ParentComponent.Provider value={parent}><SearchResult /></ParentComponent.Provider>, container);
    });
}

function clickSearchNow() {
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    button?.click();
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
