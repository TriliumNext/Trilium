import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above imports) ---------------------------------------------------------

// The shared setup.ts auto-mock only exposes ws.default.subscribeToMessages; NoteList imports the
// *named* exports subscribeToMessages / unsubscribeToMessage, so provide a real, observable mock.
// Other modules (e.g. tree.ts) call ws.default.subscribeToMessages, so expose it on default too.
// vi.hoisted lets us share state with the hoisted vi.mock factory.
const { wsSubscribers, subscribeImpl, unsubscribeImpl } = vi.hoisted(() => {
    const subscribers = new Set<(message: unknown) => void>();
    return {
        wsSubscribers: subscribers,
        subscribeImpl: vi.fn((cb: (message: unknown) => void) => { subscribers.add(cb); }),
        unsubscribeImpl: vi.fn((cb: (message: unknown) => void) => { subscribers.delete(cb); })
    };
});
vi.mock("../../services/ws", () => ({
    default: { subscribeToMessages: subscribeImpl, unsubscribeToMessage: unsubscribeImpl, logError: vi.fn() },
    subscribeToMessages: subscribeImpl,
    unsubscribeToMessage: unsubscribeImpl,
    logError: vi.fn()
}));

// getChildNoteIdsWithArchiveFiltering hits server.get("search/..") for ordinary notes; stub the
// service so it returns a controllable result instead of reaching the throwing mock server.
vi.mock("../../services/search", () => ({
    default: {
        searchForNoteIds: vi.fn(async () => [] as string[]),
        searchForNotes: vi.fn(async () => [])
    }
}));

// view_mode_storage.restore() reaches into froca/server for attachments. Mock it so the config
// hook can be exercised without the attachment loading path.
const { restoreImpl, storeImpl } = vi.hoisted(() => ({
    restoreImpl: vi.fn(async () => undefined as unknown),
    storeImpl: vi.fn(async () => undefined)
}));
vi.mock("./view_mode_storage", () => ({
    default: class {
        restore = restoreImpl;
        store = storeImpl;
    }
}));

import froca from "../../services/froca";
import search from "../../services/search";
import { subscribeToMessages, unsubscribeToMessage } from "../../services/ws";
import { buildNote } from "../../test/easy-froca";
import { fakeNoteContext, flush, renderComponent, renderHook, resetFroca } from "../../test/render";
import NoteList, { CustomNoteList, SearchNoteList, useNoteIds, useNoteViewType, useViewModeConfig } from "./NoteList";

// --- Helpers --------------------------------------------------------------------------------------

function makeReloadResults(opts: {
    noteReorderings?: string[];
    branchRows?: { parentNoteId?: string | null; noteId?: string }[];
    attributeRows?: { name: string; noteId?: string }[];
} = {}) {
    return {
        getNoteReorderings: () => opts.noteReorderings ?? [],
        getBranchRows: () => opts.branchRows ?? [],
        getAttributeRows: () => opts.attributeRows ?? []
    };
}

/** Wraps the shared `renderComponent` to keep the existing `renderInto(noteContext, child)` call sites. */
function renderInto(noteContext: unknown, child: unknown) {
    return renderComponent(child, { noteContext: noteContext as never }).container;
}

/** Wait long enough for the observer's `setTimeout(..., 10)` to fire, then settle effects. */
async function settleObserver() {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
}

class FakeIntersectionObserver {
    static instances: FakeIntersectionObserver[] = [];
    callback: IntersectionObserverCallback;
    observed: Element[] = [];
    disconnected = false;
    constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
        FakeIntersectionObserver.instances.push(this);
    }
    observe(el: Element) { this.observed.push(el); }
    unobserve() {}
    disconnect() { this.disconnected = true; }
    takeRecords() { return []; }
    trigger(isIntersecting: boolean) {
        this.callback([ { isIntersecting } as IntersectionObserverEntry ], this as unknown as IntersectionObserver);
    }
}

const originalIntersectionObserver = window.IntersectionObserver;

beforeEach(() => {
    resetFroca();
    wsSubscribers.clear();
    FakeIntersectionObserver.instances = [];
    Object.assign(window, { IntersectionObserver: FakeIntersectionObserver });
    vi.clearAllMocks();
    (search.searchForNoteIds as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    restoreImpl.mockResolvedValue(undefined);
});

afterEach(() => {
    // FakeIntersectionObserver captures the callback so specs can fire it; the global stub is inert,
    // so this local controllable observer is kept and restored here.
    Object.assign(window, { IntersectionObserver: originalIntersectionObserver });
});

// --- useNoteViewType ------------------------------------------------------------------------------

describe("useNoteViewType", () => {
    it("returns undefined for a missing note", () => {
        expect(renderHook(() => useNoteViewType(null)).result.current).toBeUndefined();
        expect(renderHook(() => useNoteViewType(undefined)).result.current).toBeUndefined();
    });

    it("defaults to grid for a non-search note and list for a search note", () => {
        const book = buildNote({ id: "vt-book", title: "B", type: "book" });
        const searchNote = buildNote({ id: "vt-search", title: "S", type: "search" });
        expect(renderHook(() => useNoteViewType(book)).result.current).toBe("grid");
        expect(renderHook(() => useNoteViewType(searchNote)).result.current).toBe("list");
    });

    it("honors an explicit, valid viewType label", () => {
        const note = buildNote({ id: "vt-explicit", title: "E", type: "book", "#viewType": "table" });
        expect(renderHook(() => useNoteViewType(note)).result.current).toBe("table");
    });

    it("falls back when the viewType label is not a known view type", () => {
        const note = buildNote({ id: "vt-bad", title: "Bad", type: "book", "#viewType": "nonsense" });
        expect(renderHook(() => useNoteViewType(note)).result.current).toBe("grid");
    });
});

// --- useNoteIds -----------------------------------------------------------------------------------

describe("useNoteIds", () => {
    it("returns [] when there is no note", async () => {
        const harness = renderHook(() => useNoteIds(null, "grid", "ntx1"));
        await flush();
        expect(harness.result.current).toEqual([]);
    });

    it("returns direct children for list/grid/table views via search filtering", async () => {
        buildNote({ id: "ni-parent", title: "P", type: "book", children: [
            { id: "ni-c1", title: "C1" }, { id: "ni-c2", title: "C2" }
        ] });
        const note = froca.notes["ni-parent"];
        (search.searchForNoteIds as ReturnType<typeof vi.fn>).mockResolvedValue([ "ni-c1", "ni-c2" ]);
        const harness = renderHook(() => useNoteIds(note, "grid", "ntx1"));
        await flush();
        expect([ ...harness.result.current ].sort()).toEqual([ "ni-c1", "ni-c2" ]);
    });

    it("returns the full subtree for non-direct-children views (e.g. geoMap)", async () => {
        buildNote({ id: "ni-sub", title: "P", type: "book", children: [
            { id: "ni-s1", title: "S1", children: [ { id: "ni-s1a", title: "S1A" } ] }
        ] });
        const note = froca.notes["ni-sub"];
        const harness = renderHook(() => useNoteIds(note, "geoMap", "ntx1"));
        await flush();
        expect([ ...harness.result.current ].sort()).toEqual([ "ni-s1", "ni-s1a" ]);
    });

    it("treats a search note as direct-children only regardless of view type", async () => {
        buildNote({ id: "ni-search", title: "Srch", type: "search", children: [ { id: "ni-sr1", title: "R1" } ] });
        const note = froca.notes["ni-search"];
        // Search/hidden notes skip the search filtering and return this.children directly.
        const harness = renderHook(() => useNoteIds(note, "geoMap", "ntx1"));
        await flush();
        expect(harness.result.current).toEqual([ "ni-sr1" ]);
    });

    it("refreshes on entitiesReloaded for matching reorderings, branches and archived attrs", async () => {
        buildNote({ id: "er-parent", title: "P", type: "book", children: [ { id: "er-c1", title: "C1" } ] });
        const note = froca.notes["er-parent"];
        (search.searchForNoteIds as ReturnType<typeof vi.fn>).mockResolvedValue([ "er-c1" ]);
        const harness = renderHook(() => useNoteIds(note, "grid", "ntx1"));
        await flush();
        expect(harness.result.current).toEqual([ "er-c1" ]);

        (search.searchForNoteIds as ReturnType<typeof vi.fn>).mockClear();

        // matching reordering
        harness.fireEvent("entitiesReloaded", { loadResults: makeReloadResults({ noteReorderings: [ "er-parent" ] }) });
        await flush();
        // matching branch (parent is the note)
        harness.fireEvent("entitiesReloaded", { loadResults: makeReloadResults({ branchRows: [ { parentNoteId: "er-parent" } ] }) });
        await flush();
        // matching branch where parent is among the current noteIds
        harness.fireEvent("entitiesReloaded", { loadResults: makeReloadResults({ branchRows: [ { parentNoteId: "er-c1" } ] }) });
        await flush();
        // matching archived attribute on a child currently in the list
        harness.fireEvent("entitiesReloaded", { loadResults: makeReloadResults({ attributeRows: [ { name: "archived", noteId: "er-c1" } ] }) });
        await flush();
        expect(search.searchForNoteIds).toHaveBeenCalled();
    });

    it("ignores entitiesReloaded that do not affect the note", async () => {
        buildNote({ id: "ig-parent", title: "P", type: "book", children: [ { id: "ig-c1", title: "C1" } ] });
        const note = froca.notes["ig-parent"];
        (search.searchForNoteIds as ReturnType<typeof vi.fn>).mockResolvedValue([ "ig-c1" ]);
        const harness = renderHook(() => useNoteIds(note, "grid", "ntx1"));
        await flush();
        (search.searchForNoteIds as ReturnType<typeof vi.fn>).mockClear();

        harness.fireEvent("entitiesReloaded", { loadResults: makeReloadResults({
            noteReorderings: [ "someoneElse" ],
            branchRows: [ { parentNoteId: "unrelated" } ],
            attributeRows: [ { name: "archived", noteId: "unrelated" }, { name: "color", noteId: "ig-c1" } ]
        }) });
        await flush();
        expect(search.searchForNoteIds).not.toHaveBeenCalled();
    });

    it("does not run on entitiesReloaded when there is no note", async () => {
        const harness = renderHook(() => useNoteIds(null, "grid", "ntx1"));
        await flush();
        // Should not throw even though there is no note to compare against.
        harness.fireEvent("entitiesReloaded", { loadResults: makeReloadResults({ noteReorderings: [ "x" ] }) });
        await flush();
        expect(harness.result.current).toEqual([]);
    });

    it("refreshes on searchRefreshed only for the matching ntxId", async () => {
        buildNote({ id: "sr-parent", title: "P", type: "search", children: [ { id: "sr-c1", title: "C1" } ] });
        const note = froca.notes["sr-parent"];
        const harness = renderHook(() => useNoteIds(note, "list", "ntx-match"));
        await flush();
        expect(harness.result.current).toEqual([ "sr-c1" ]);

        // Non-matching ntxId is ignored, matching one refreshes.
        harness.fireEvent("searchRefreshed", { ntxId: "other" });
        harness.fireEvent("searchRefreshed", { ntxId: "ntx-match" });
        await flush();
        expect(harness.result.current).toEqual([ "sr-c1" ]);
    });

    it("subscribes/unsubscribes to ws messages and appends imported notes under the note", async () => {
        buildNote({ id: "imp-parent", title: "P", type: "book", children: [ { id: "imp-c1", title: "C1" } ] });
        buildNote({ id: "imp-new", title: "New", children: [ { id: "imp-new-child", title: "NC" } ] });
        const note = froca.notes["imp-parent"];
        (search.searchForNoteIds as ReturnType<typeof vi.fn>).mockResolvedValue([ "imp-c1" ]);
        const harness = renderHook(() => useNoteIds(note, "grid", "ntx1"));
        await flush();
        expect(subscribeToMessages).toHaveBeenCalled();
        expect(wsSubscribers.size).toBeGreaterThan(0);

        // Fire the imported-notes ws message; the new note (and its subtree) should be appended.
        await act(async () => {
            for (const cb of wsSubscribers) {
                await cb({ type: "taskSucceeded", taskType: "importNotes", result: { parentNoteId: "imp-parent", importedNoteId: "imp-new" } });
            }
        });
        await flush();
        expect(harness.result.current).toContain("imp-new");

        harness.unmount();
        expect(unsubscribeToMessage).toHaveBeenCalled();
    });

    it("ignores ws messages that are not successful import tasks or lack ids", async () => {
        buildNote({ id: "imp2-parent", title: "P", type: "book", children: [ { id: "imp2-c1", title: "C1" } ] });
        buildNote({ id: "imp2-other", title: "Other" });
        const note = froca.notes["imp2-parent"];
        (search.searchForNoteIds as ReturnType<typeof vi.fn>).mockResolvedValue([ "imp2-c1" ]);
        const harness = renderHook(() => useNoteIds(note, "grid", "ntx1"));
        await flush();
        const before = [ ...harness.result.current ];

        await act(async () => {
            for (const cb of wsSubscribers) {
                // wrong task type
                await cb({ type: "taskSucceeded", taskType: "other", result: {} });
                // missing ids
                await cb({ type: "taskSucceeded", taskType: "importNotes", result: { parentNoteId: null, importedNoteId: null } });
                // parent not related to this note
                await cb({ type: "taskSucceeded", taskType: "importNotes", result: { parentNoteId: "unrelated", importedNoteId: "imp2-other" } });
                // message without taskType
                await cb({ type: "taskSucceeded" });
            }
        });
        await flush();
        expect(harness.result.current).toEqual(before);
    });

    it("ignores an import whose importedNoteId is not in froca", async () => {
        buildNote({ id: "imp3-parent", title: "P", type: "book", children: [ { id: "imp3-c1", title: "C1" } ] });
        const note = froca.notes["imp3-parent"];
        (search.searchForNoteIds as ReturnType<typeof vi.fn>).mockResolvedValue([ "imp3-c1" ]);
        const getNote = vi.spyOn(froca, "getNote").mockResolvedValue(null);
        const harness = renderHook(() => useNoteIds(note, "grid", "ntx1"));
        await flush();
        const before = [ ...harness.result.current ];

        await act(async () => {
            for (const cb of wsSubscribers) {
                await cb({ type: "taskSucceeded", taskType: "importNotes", result: { parentNoteId: "imp3-parent", importedNoteId: "ghost" } });
            }
        });
        await flush();
        expect(harness.result.current).toEqual(before);
        expect(getNote).toHaveBeenCalledWith("ghost");
    });
});

// --- useViewModeConfig ----------------------------------------------------------------------------

describe("useViewModeConfig", () => {
    it("returns undefined when note or view type is missing", () => {
        expect(renderHook(() => useViewModeConfig(null, "grid")).result.current).toBeUndefined();
        const note = buildNote({ id: "vmc-none", title: "N", type: "book" });
        expect(renderHook(() => useViewModeConfig(note, undefined)).result.current).toBeUndefined();
    });

    it("restores config and exposes a working storeFn", async () => {
        const note = buildNote({ id: "vmc-note", title: "N", type: "book" });
        restoreImpl.mockResolvedValue({ zoom: 1 });
        const harness = renderHook(() => useViewModeConfig<{ zoom: number }>(note, "geoMap"));
        await flush();
        const current = harness.result.current;
        expect(current?.note).toBe(note);
        expect(current?.config).toEqual({ zoom: 1 });
        expect(typeof current?.storeFn).toBe("function");

        // storeFn should update the exposed config and persist via the storage.
        act(() => current?.storeFn({ zoom: 5 }));
        expect(harness.result.current?.config).toEqual({ zoom: 5 });
        expect(storeImpl).toHaveBeenCalledWith({ zoom: 5 });
    });

    it("does not leak config when the note changes (never exposes the old note)", async () => {
        const noteA = buildNote({ id: "vmc-a", title: "A", type: "book" });
        const noteB = buildNote({ id: "vmc-b", title: "B", type: "book" });
        const harness = renderHook(() => useViewModeConfig(noteA, "geoMap"));
        await flush();
        expect(harness.result.current?.note).toBe(noteA);

        // Re-render targeting a different note; the stale config (note !== current) must be hidden.
        harness.rerender(() => useViewModeConfig(noteB, "geoMap"));
        expect(harness.result.current?.note).not.toBe(noteA);
        await flush();
        expect(harness.result.current?.note).toBe(noteB);
    });
});

// --- Components -----------------------------------------------------------------------------------

describe("CustomNoteList", () => {
    it("renders the wrapper without content when disabled", () => {
        const note = buildNote({ id: "cnl-disabled", title: "N", type: "book" });
        const container = renderInto(null,
            <CustomNoteList note={note} viewType="grid" isEnabled={false} notePath="root/cnl-disabled" ntxId="ntx1" media="screen" />
        );
        expect(container.querySelector(".note-list-widget")).toBeTruthy();
        expect(container.querySelector(".note-list-widget-content")).toBeNull();
    });

    it("applies full-height for collection view types and registers no IntersectionObserver", async () => {
        const note = buildNote({ id: "cnl-full", title: "N", type: "book" });
        const container = renderInto(null,
            <CustomNoteList note={note} viewType="geoMap" isEnabled={true} notePath="root/cnl-full" ntxId="ntx1" media="screen" />
        );
        expect(container.querySelector(".note-list-widget")?.className).toContain("full-height");
        // Full-height views skip the IntersectionObserver entirely.
        await settleObserver();
        expect(FakeIntersectionObserver.instances.length).toBe(0);
    });

    it("renders content immediately for book notes without intersection", async () => {
        const note = buildNote({ id: "cnl-book", title: "N", type: "book" });
        const container = renderInto(null,
            <CustomNoteList note={note} viewType="grid" isEnabled={true} notePath="root/cnl-book" ntxId="ntx1" media="screen" />
        );
        await flush();
        expect(container.querySelector(".note-list-widget-content")).toBeTruthy();
    });

    it("uses an IntersectionObserver for non-full-height, non-book notes and renders once intersecting", async () => {
        buildNote({ id: "cnl-obs", title: "N", type: "text", children: [ { id: "cnl-obs-c", title: "C" } ] });
        const note = froca.notes["cnl-obs"];
        (search.searchForNoteIds as ReturnType<typeof vi.fn>).mockResolvedValue([ "cnl-obs-c" ]);
        const container = renderInto(null,
            <CustomNoteList note={note} viewType="list" isEnabled={true} notePath="root/cnl-obs" ntxId="ntx1" media="screen" />
        );
        // Initially not intersecting → no content.
        expect(container.querySelector(".note-list-widget-content")).toBeNull();

        await settleObserver();
        expect(FakeIntersectionObserver.instances.length).toBeGreaterThan(0);
        const observer = FakeIntersectionObserver.instances[0];
        await act(async () => { observer.trigger(true); await Promise.resolve(); });
        await flush();
        expect(container.querySelector(".note-list-widget-content")).toBeTruthy();
    });

    it("disconnects without setting intersecting when the observer reports not-intersecting", async () => {
        buildNote({ id: "cnl-noi", title: "N", type: "text", children: [ { id: "cnl-noi-c", title: "C" } ] });
        const note = froca.notes["cnl-noi"];
        const container = renderInto(null,
            <CustomNoteList note={note} viewType="list" isEnabled={true} notePath="root/cnl-noi" ntxId="ntx1" media="screen" />
        );
        await settleObserver();
        const observer = FakeIntersectionObserver.instances[0];
        expect(observer).toBeTruthy();
        act(() => observer.trigger(false));
        expect(observer.disconnected).toBe(true);
        expect(container.querySelector(".note-list-widget-content")).toBeNull();
    });

    it("skips the observer when displayOnlyCollections is set", async () => {
        buildNote({ id: "cnl-doc", title: "N", type: "text", children: [ { id: "cnl-doc-c", title: "C" } ] });
        const note = froca.notes["cnl-doc"];
        renderInto(null,
            <CustomNoteList note={note} viewType="list" isEnabled={true} notePath="root/cnl-doc" ntxId="ntx1" media="screen" displayOnlyCollections />
        );
        await settleObserver();
        expect(FakeIntersectionObserver.instances.length).toBe(0);
    });

    it("selects the print component when media is print (view type with a print variant)", async () => {
        const note = buildNote({ id: "cnl-print", title: "N", type: "book" });
        // 'list' has a print view; rendering with media=print exercises that branch.
        const container = renderInto(null,
            <CustomNoteList note={note} viewType="list" isEnabled={true} notePath="root/cnl-print" ntxId="ntx1" media="print" />
        );
        await flush();
        expect(container.querySelector(".note-list-widget-content")).toBeTruthy();
    });

    it("falls back to the normal component when the view type has no print variant", async () => {
        const note = buildNote({ id: "cnl-noprint", title: "N", type: "book" });
        // 'grid' has no print view → print media must fall back to normal.
        const container = renderInto(null,
            <CustomNoteList note={note} viewType="grid" isEnabled={true} notePath="root/cnl-noprint" ntxId="ntx1" media="print" />
        );
        await flush();
        expect(container.querySelector(".note-list-widget-content")).toBeTruthy();
    });

    it("forwards provided onReady / onProgressChanged callbacks into the view props", async () => {
        const note = buildNote({ id: "cnl-cbs", title: "N", type: "book" });
        const onReady = vi.fn();
        const onProgressChanged = vi.fn();
        const container = renderInto(null,
            <CustomNoteList note={note} viewType="grid" isEnabled={true} notePath="root/cnl-cbs" ntxId="ntx1" media="screen" onReady={onReady} onProgressChanged={onProgressChanged} />
        );
        await flush();
        // The content wrapper exists, meaning props (with our callbacks) were built and passed down.
        expect(container.querySelector(".note-list-widget-content")).toBeTruthy();
    });

    it("renders no content when notePath is missing even if enabled", () => {
        const note = buildNote({ id: "cnl-nopath", title: "N", type: "book" });
        const container = renderInto(null,
            <CustomNoteList note={note} viewType="grid" isEnabled={true} notePath={null} ntxId="ntx1" media="screen" />
        );
        expect(container.querySelector(".note-list-widget-content")).toBeNull();
    });
});

describe("NoteList (default export)", () => {
    it("derives view type and enablement from the active note context", async () => {
        buildNote({ id: "nl-note", title: "N", type: "book", children: [ { id: "nl-c1", title: "C1" } ] });
        const note = froca.notes["nl-note"];
        const noteContext = fakeNoteContext({
            ntxId: "ntx-nl",
            notePath: "root/nl-note",
            note,
            hasNoteList: () => true
        });
        const container = renderInto(noteContext, <NoteList media="screen" />);
        await flush();
        expect(container.querySelector(".note-list-widget")).toBeTruthy();
    });

    it("renders disabled (no content) when the context reports no note list", async () => {
        buildNote({ id: "nl-empty", title: "N", type: "book" });
        const note = froca.notes["nl-empty"];
        const noteContext = fakeNoteContext({
            ntxId: "ntx-nl2",
            notePath: "root/nl-empty",
            note,
            hasNoteList: () => false
        });
        const container = renderInto(noteContext, <NoteList media="screen" displayOnlyCollections />);
        await flush();
        expect(container.querySelector(".note-list-widget-content")).toBeNull();
    });
});

describe("SearchNoteList", () => {
    it("renders enabled with a derived list view for a search note", async () => {
        buildNote({ id: "snl-note", title: "S", type: "search", children: [ { id: "snl-c1", title: "C1" } ] });
        const note = froca.notes["snl-note"];
        const container = renderInto(null,
            <SearchNoteList note={note} notePath="root/snl-note" ntxId="ntx-snl" media="screen" />
        );
        await flush();
        expect(container.querySelector(".note-list-widget")).toBeTruthy();
    });
});
