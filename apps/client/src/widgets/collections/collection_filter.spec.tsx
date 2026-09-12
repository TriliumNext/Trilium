import { deferred } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import type FNote from "../../entities/fnote";
import type { EntityChange } from "../../server_types";
import LoadResults from "../../services/load_results";
import searchService from "../../services/search";
import { buildNote } from "../../test/easy-froca";
import { ParentComponent } from "../react/react_utils";
import {
    type CollectionFilter, CollectionFilterInput, useCollectionFilter
} from "./collection_filter";

vi.mock("../../services/i18n", () => ({
    t: (key: string) => key
}));

vi.mock("../../services/search", () => ({
    default: { searchInSubtree: vi.fn() }
}));

const searchInSubtree = vi.mocked(searchService.searchInSubtree);

let currentFilter: CollectionFilter | undefined;

function Harness({ note, persistedQuery, onQueryChanged, collectionNoteIds }: {
    note: FNote;
    persistedQuery?: string;
    onQueryChanged?: (query: string) => void;
    collectionNoteIds?: string[];
}) {
    currentFilter = useCollectionFilter(note, {
        persistedQuery,
        onQueryChanged: onQueryChanged ?? (() => {}),
        collectionNoteIds: collectionNoteIds ?? []
    });
    return null;
}

function matchResponse(noteIds: string[], error: string | null = null) {
    return {
        searchResultNoteIds: noteIds,
        highlightedTokens: [ { token: "match", type: "plain" as const } ],
        error
    };
}

function branchEntitiesReloaded(parentNoteId: string, childNoteId: string) {
    const branchId = `br-${childNoteId}`;
    const loadResults = new LoadResults([
        {
            entityName: "branches",
            entityId: branchId,
            entity: { branchId, parentNoteId, noteId: childNoteId },
            componentId: "comp-1"
        } as unknown as EntityChange
    ]);
    loadResults.addBranch(branchId, "comp-1");
    return loadResults;
}

async function flushMicrotasks() {
    await Promise.resolve();
    await Promise.resolve();
}

/**
 * Flushes the work a mutation leaves behind: the effect run at the end of the previous `act` starts
 * the search, whose resolution then has to land inside an `act` of its own to be drawn.
 */
async function settle() {
    await act(async () => {
        await flushMicrotasks();
    });
}

describe("useCollectionFilter", () => {
    let container: HTMLElement | undefined;
    let parent: Component;

    beforeEach(() => {
        currentFilter = undefined;
        searchInSubtree.mockReset();
        parent = new Component();
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        vi.useRealTimers();
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    async function mount(props: Omit<Parameters<typeof Harness>[0], "note"> & { note?: FNote }) {
        const note = props.note ?? buildNote({ title: "Board" });
        await act(async () => {
            render(
                <ParentComponent.Provider value={parent}>
                    <Harness {...props} note={note} />
                </ParentComponent.Provider>,
                container ?? document.body
            );
            await flushMicrotasks();
        });
        return note;
    }

    it("stays inactive without a query and resolves matches on submit", async () => {
        searchInSubtree.mockResolvedValue(matchResponse([ "n1", "n2" ]));
        const note = await mount({});

        expect(currentFilter?.shownNoteIds).toBeNull();
        expect(searchInSubtree).not.toHaveBeenCalled();

        await act(async () => {
            currentFilter?.setQuery("#done");
            await flushMicrotasks();
        });
        await settle();

        expect(searchInSubtree).toHaveBeenCalledWith("#done", note.noteId);
        expect([ ...(currentFilter?.shownNoteIds ?? []) ]).toEqual([ "n1", "n2" ]);
        expect(currentFilter?.highlightedTokens).toEqual([ { token: "match", type: "plain" } ]);

        await act(async () => {
            currentFilter?.setQuery("");
            await flushMicrotasks();
        });

        expect(currentFilter?.shownNoteIds).toBeNull();
        expect(currentFilter?.highlightedTokens).toBeNull();
    });

    it("reports a submitted query for persistence, trimmed", async () => {
        searchInSubtree.mockResolvedValue(matchResponse([]));
        const onQueryChanged = vi.fn();
        await mount({ onQueryChanged });

        await act(async () => {
            currentFilter?.setQuery("  #done  ");
            await flushMicrotasks();
        });

        expect(onQueryChanged).toHaveBeenCalledWith("#done");
        expect(currentFilter?.query).toBe("#done");
    });

    it("resolves a persisted query on mount", async () => {
        searchInSubtree.mockResolvedValue(matchResponse([ "n1" ]));
        const note = await mount({ persistedQuery: "#done" });

        expect(searchInSubtree).toHaveBeenCalledWith("#done", note.noteId);
        expect(currentFilter?.shownNoteIds?.has("n1")).toBe(true);
    });

    it("holds while a stored query resolves, and not for one submitted afterwards", async () => {
        const stored = deferred<ReturnType<typeof matchResponse>>();
        searchInSubtree.mockReturnValueOnce(stored);
        await mount({ persistedQuery: "#done" });

        // Nothing must be drawn yet: the matches the board would narrow to are still unknown.
        expect(currentFilter?.isResolvingStoredQuery).toBe(true);

        await act(async () => {
            stored.resolve(matchResponse([ "n1" ]));
            await flushMicrotasks();
        });
        expect(currentFilter?.isResolvingStoredQuery).toBe(false);

        // A later submit narrows a board already on screen, which must not be taken away.
        const submitted = deferred<ReturnType<typeof matchResponse>>();
        searchInSubtree.mockReturnValueOnce(submitted);
        await act(async () => { currentFilter?.setQuery("#other"); });

        expect(currentFilter?.isResolvingStoredQuery).toBe(false);
        await act(async () => {
            submitted.resolve(matchResponse([ "n2" ]));
            await flushMicrotasks();
        });
    });

    it("stops holding when a stored query cannot be run", async () => {
        searchInSubtree.mockRejectedValueOnce(new Error("offline"));
        vi.spyOn(console, "error").mockImplementation(() => {});
        await mount({ persistedQuery: "#done" });
        await settle();

        expect(currentFilter?.isResolvingStoredQuery).toBe(false);
        expect(currentFilter?.error).toBe("collection_filter.fetch-error");
    });

    it("does not hold when nothing was stored", async () => {
        await mount({});
        expect(currentFilter?.isResolvingStoredQuery).toBe(false);
    });

    // Nothing stands outside a filter that is not there, so a note reported while the collection
    // is whole must not come back marked.
    it("keeps nothing while no filter is active", async () => {
        await mount({});

        await act(async () => { currentFilter?.keepNote("made"); });

        expect(currentFilter?.keptNoteIds.size).toBe(0);
        expect(currentFilter?.shownNoteIds).toBeNull();
    });

    /** A note made in a narrowed collection is drawn although the query misses it. */
    it("draws a kept note the query misses, and marks it, until the query changes", async () => {
        vi.useFakeTimers();
        searchInSubtree.mockResolvedValue(matchResponse([ "n1" ]));
        const note = await mount({ collectionNoteIds: [ "n1" ] });

        await act(async () => {
            currentFilter?.setQuery("#done");
            await vi.advanceTimersByTimeAsync(0);
        });
        await act(async () => { currentFilter?.keepNote("made"); });

        expect([ ...(currentFilter?.shownNoteIds ?? []) ]).toEqual([ "n1", "made" ]);
        expect([ ...(currentFilter?.keptNoteIds ?? []) ]).toEqual([ "made" ]);

        // A re-run that still misses it leaves it drawn: it was made here, on this query.
        await act(async () => {
            await parent.handleEvent("entitiesReloaded", {
                loadResults: branchEntitiesReloaded(note.noteId, "made")
            });
            await vi.advanceTimersByTimeAsync(400);
        });
        expect(currentFilter?.shownNoteIds?.has("made")).toBe(true);

        // Another query is asked afresh which notes belong.
        searchInSubtree.mockResolvedValue(matchResponse([ "n2" ]));
        await act(async () => {
            currentFilter?.setQuery("#other");
            await vi.advanceTimersByTimeAsync(0);
        });
        await settle();

        expect([ ...(currentFilter?.shownNoteIds ?? []) ]).toEqual([ "n2" ]);
        expect(currentFilter?.keptNoteIds.size).toBe(0);
    });

    it("stops marking a kept note once the query comes to match it", async () => {
        vi.useFakeTimers();
        searchInSubtree.mockResolvedValue(matchResponse([ "n1" ]));
        const note = await mount({ collectionNoteIds: [ "n1" ] });

        await act(async () => {
            currentFilter?.setQuery("#done");
            await vi.advanceTimersByTimeAsync(0);
        });
        await act(async () => { currentFilter?.keepNote("made"); });
        expect(currentFilter?.keptNoteIds.has("made")).toBe(true);

        searchInSubtree.mockResolvedValue(matchResponse([ "n1", "made" ]));
        await act(async () => {
            await parent.handleEvent("entitiesReloaded", {
                loadResults: branchEntitiesReloaded(note.noteId, "made")
            });
            await vi.advanceTimersByTimeAsync(400);
        });

        expect(currentFilter?.shownNoteIds?.has("made")).toBe(true);
        expect(currentFilter?.keptNoteIds.has("made")).toBe(false);
    });

    it("keeps the previous matches when a query comes back with an error", async () => {
        searchInSubtree.mockResolvedValueOnce(matchResponse([ "n1" ]));
        await mount({});

        await act(async () => {
            currentFilter?.setQuery("#done");
            await flushMicrotasks();
        });
        await settle();

        searchInSubtree.mockResolvedValueOnce(matchResponse([ "other" ], "broken query"));
        await act(async () => {
            currentFilter?.setQuery("#done ==");
            await flushMicrotasks();
        });
        await settle();

        expect(currentFilter?.error).toBe("broken query");
        expect([ ...(currentFilter?.shownNoteIds ?? []) ]).toEqual([ "n1" ]);

        // A good query clears the error and takes over.
        searchInSubtree.mockResolvedValueOnce(matchResponse([ "n2" ]));
        await act(async () => {
            currentFilter?.setQuery("#other");
            await flushMicrotasks();
        });
        await settle();

        expect(currentFilter?.error).toBeNull();
        expect([ ...(currentFilter?.shownNoteIds ?? []) ]).toEqual([ "n2" ]);
    });

    it("lets only the newest run set the result when runs resolve out of order", async () => {
        const first = deferred<ReturnType<typeof matchResponse>>();
        const second = deferred<ReturnType<typeof matchResponse>>();
        searchInSubtree.mockReturnValueOnce(first).mockReturnValueOnce(second);
        await mount({});

        await act(async () => { currentFilter?.setQuery("#first"); });
        await act(async () => { currentFilter?.setQuery("#second"); });

        await act(async () => {
            second.resolve(matchResponse([ "newer" ]));
            await flushMicrotasks();
        });
        await act(async () => {
            first.resolve(matchResponse([ "older" ]));
            await flushMicrotasks();
        });

        expect([ ...(currentFilter?.shownNoteIds ?? []) ]).toEqual([ "newer" ]);
    });

    it("re-runs an active filter, debounced, when a change touches the collection", async () => {
        vi.useFakeTimers();
        searchInSubtree.mockResolvedValue(matchResponse([ "n1" ]));
        const note = await mount({ collectionNoteIds: [ "n1", "n2" ] });

        await act(async () => {
            currentFilter?.setQuery("#done");
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(searchInSubtree).toHaveBeenCalledTimes(1);

        // Two changes inside the debounce window collapse into one re-run.
        await act(async () => {
            await parent.handleEvent("entitiesReloaded", {
                loadResults: branchEntitiesReloaded(note.noteId, "added")
            });
            await parent.handleEvent("entitiesReloaded", {
                loadResults: branchEntitiesReloaded("n2", "nested")
            });
            await vi.advanceTimersByTimeAsync(400);
        });
        expect(searchInSubtree).toHaveBeenCalledTimes(2);

        // A change elsewhere re-runs nothing.
        await act(async () => {
            await parent.handleEvent("entitiesReloaded", {
                loadResults: branchEntitiesReloaded("unrelated", "elsewhere")
            });
            await vi.advanceTimersByTimeAsync(400);
        });
        expect(searchInSubtree).toHaveBeenCalledTimes(2);
    });

    it("does not re-run while no filter is active", async () => {
        const note = await mount({ collectionNoteIds: [ "n1" ] });
        vi.useFakeTimers();

        await act(async () => {
            await parent.handleEvent("entitiesReloaded", {
                loadResults: branchEntitiesReloaded(note.noteId, "added")
            });
            await vi.advanceTimersByTimeAsync(400);
        });

        expect(searchInSubtree).not.toHaveBeenCalled();
    });
});

describe("CollectionFilterInput", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    function mountInput(overrides: Partial<CollectionFilter> = {}) {
        const filter: CollectionFilter = {
            query: "",
            shownNoteIds: null,
            keptNoteIds: new Set<string>(),
            highlightedTokens: null,
            error: null,
            isResolvingStoredQuery: false,
            keepNote: vi.fn(),
            setQuery: vi.fn(),
            ...overrides
        };
        // Rendered inside act so the mount effects run now, not queued into the next act where
        // they would clobber what a test has typed in the meantime.
        act(() => render(<CollectionFilterInput filter={filter} />, container));
        const input = container.querySelector("input");
        expect(input).not.toBeNull();
        return { filter, input: input as HTMLInputElement };
    }

    function type(input: HTMLInputElement, value: string) {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    it("submits what is typed on Enter", async () => {
        const { filter, input } = mountInput();

        // Typed first and submitted in a pass of its own, so the keydown runs against the
        // re-rendered handler that has seen the typing.
        await act(async () => type(input, "#done"));
        await act(async () => {
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        });

        expect(filter.setQuery).toHaveBeenCalledWith("#done");
    });

    it("submits what is typed through the search button", async () => {
        const { filter, input } = mountInput();

        await act(async () => type(input, "#done"));
        const submit = container.querySelector<HTMLElement>(".collection-filter-submit");
        expect(submit).not.toBeNull();
        await act(async () => submit?.click());

        expect(filter.setQuery).toHaveBeenCalledWith("#done");
    });

    it("puts the clear button before the search button", () => {
        mountInput({ query: "#done" });

        const buttons = [ ...container.querySelectorAll("button") ].map(button => button.className);
        const clear = buttons.findIndex(name => name.includes("collection-filter-clear"));
        const submit = buttons.findIndex(name => name.includes("collection-filter-submit"));

        expect(clear).toBeGreaterThanOrEqual(0);
        expect(submit).toBe(clear + 1);
    });

    it("clears the filter through the button and refocuses the box", async () => {
        const { filter } = mountInput({ query: "#done" });

        const clear = container.querySelector<HTMLElement>(".collection-filter-clear");
        expect(clear).not.toBeNull();
        await act(async () => clear?.click());

        expect(filter.setQuery).toHaveBeenCalledWith("");
    });

    it("offers no clear button until a filter is in force, whatever is typed", async () => {
        const { input } = mountInput();
        const box = () => container.querySelector(".collection-filter");
        expect(box()?.classList.contains("active")).toBe(false);
        expect(container.querySelector(".collection-filter-clear")).toBeNull();

        // Typing is not yet a filter, so there is nothing for the button to take away.
        await act(async () => type(input, "#done"));
        expect(container.querySelector(".collection-filter-clear")).toBeNull();

        mountInput({ query: "#done" });
        expect(box()?.classList.contains("active")).toBe(true);
        expect(container.querySelector(".collection-filter-clear")).not.toBeNull();
    });

    // The box carries no tooltip, and a placeholder is gone as soon as something is typed.
    it("names the box for assistive technology", () => {
        const { input } = mountInput();
        expect(input.getAttribute("aria-label")).toBe("collection_filter.placeholder");
    });

    it("shows the query error under the box", () => {
        mountInput({ error: "broken" });
        expect(container.querySelector(".collection-filter-error")?.textContent).toBe("broken");
    });

    it("gives up unsubmitted typing on Escape without touching the filter", async () => {
        const { filter, input } = mountInput({ query: "#kept" });

        await act(async () => type(input, "#typed"));
        await act(async () => {
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        });

        expect(input.value).toBe("#kept");
        expect(filter.setQuery).not.toHaveBeenCalled();
    });
});
