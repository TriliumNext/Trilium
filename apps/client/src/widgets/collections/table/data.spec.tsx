import type { RefObject } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";

import attributes from "../../../services/attributes";
import { buildNote } from "../../../test/easy-froca";
import { flush, renderHook, resetFroca } from "../../../test/render";
import useData, { type TableConfig } from "./data";

// --- helpers --------------------------------------------------------------------------------------

/** A duck-typed LoadResults covering only the accessors `useData` reads. */
function makeLoadResults(opts: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    attributeRows?: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    branchRows?: any[];
    noteIds?: string[];
} = {}) {
    return {
        getAttributeRows: () => opts.attributeRows ?? [],
        getBranchRows: () => opts.branchRows ?? [],
        getNoteIds: () => opts.noteIds ?? []
    };
}

/** Drains the refresh/effect chain (mount -> async refresh -> movableRows effect -> re-refresh). */
async function settle() {
    for (let i = 0; i < 8; i++) {
        await flush();
    }
}

const noopRef: RefObject<number | undefined> = { current: undefined };

// Track mounted hooks so they are unmounted before froca is cleared; otherwise a still-mounted
// hook from a prior test re-renders against a wiped cache and triggers an unhandled froca load.
const mounted: { unmount: () => void }[] = [];
function mount<T>(hook: () => T) {
    const h = renderHook(hook);
    mounted.push(h);
    return h;
}

beforeEach(() => {
    resetFroca();
    vi.clearAllMocks();
    // glob.device defaults to undefined; ensure no leftover "print" value from a prior test.
    (globalThis as unknown as { glob: { device?: string } }).glob.device = undefined;
});

afterEach(async () => {
    await act(async () => {});
    for (const h of mounted.splice(0)) h.unmount();
    await act(async () => {});
    (globalThis as unknown as { glob: { device?: string } }).glob.device = undefined;
});

// --- tests ----------------------------------------------------------------------------------------

describe("useData", () => {
    it("builds column and row definitions for a parent with promoted label/relation defs and children", async () => {
        // Parent has two promoted definitions -> two extra columns (one label, one relation).
        const parent = buildNote({
            id: "parent",
            title: "Parent",
            "#label:status": "promoted,single,text",
            "#relation:owner": "promoted,single",
            children: [
                { id: "c1", title: "Child 1", "#status": "open" },
                { id: "c2", title: "Child 2" }
            ]
        });

        const reset = vi.fn();
        const h = mount(() => useData(parent, [ "c1", "c2" ], undefined, noopRef, reset));
        await flush();

        expect(h.result.current.rowData?.map(r => r.noteId)).toEqual([ "c1", "c2" ]);
        // base columns: index "#", noteId, title (3) + 2 promoted -> 5 columns.
        expect(h.result.current.columnDefs?.length).toBe(5);
        const fields = h.result.current.columnDefs?.map(c => c.field);
        expect(fields).toContain("labels.status");
        expect(fields).toContain("relations.owner");
        // No subtree -> movable rows enabled (not sorted, not search).
        expect(h.result.current.hasChildren).toBe(false);
        expect(h.result.current.movableRows).toBe(true);
        expect(reset).toHaveBeenCalled();
    });

    it("excludes archived children unless includeArchived label is set", async () => {
        const parent = buildNote({
            id: "p",
            title: "P",
            children: [
                { id: "vis", title: "Visible" },
                { id: "arch", title: "Archived", "#archived": "true" }
            ]
        });

        const h = mount(() => useData(parent, [ "vis", "arch" ], undefined, noopRef, vi.fn()));
        await flush();
        expect(h.result.current.rowData?.map(r => r.noteId)).toEqual([ "vis" ]);

        // Now with the includeArchived label present on the parent.
        const parent2 = buildNote({
            id: "p2",
            title: "P2",
            "#includeArchived": "true",
            children: [
                { id: "vis2", title: "Visible" },
                { id: "arch2", title: "Archived", "#archived": "true" }
            ]
        });
        const h2 = mount(() => useData(parent2, [ "vis2", "arch2" ], undefined, noopRef, vi.fn()));
        await flush();
        expect(h2.result.current.rowData?.map(r => r.noteId)).toEqual([ "vis2", "arch2" ]);
    });

    it("reports a subtree and disables movable rows when a child has its own children", async () => {
        const parent = buildNote({
            id: "tree",
            title: "Tree",
            children: [
                { id: "branch", title: "Branch", children: [ { id: "leaf", title: "Leaf" } ] }
            ]
        });

        const h = mount(() => useData(parent, [ "branch" ], undefined, noopRef, vi.fn()));
        await flush();
        expect(h.result.current.hasChildren).toBe(true);
        const top = h.result.current.rowData?.[0];
        expect(top?._children?.map(c => c.noteId)).toEqual([ "leaf" ]);
        expect(h.result.current.movableRows).toBe(false);
    });

    it("disables movable rows for sorted notes and for search notes", async () => {
        const sorted = buildNote({ id: "s", title: "S", "#sorted": "true", children: [ { id: "sc", title: "SC" } ] });
        const hs = mount(() => useData(sorted, [ "sc" ], undefined, noopRef, vi.fn()));
        await flush();
        expect(hs.result.current.movableRows).toBe(false);

        const search = buildNote({ id: "sr", title: "SR", type: "search", children: [ { id: "src", title: "SRC" } ] });
        const hsr = mount(() => useData(search, [ "src" ], undefined, noopRef, vi.fn()));
        await flush();
        expect(hsr.result.current.movableRows).toBe(false);
    });

    it("respects maxNestingDepth to cap recursion depth", async () => {
        const parent = buildNote({
            id: "deep",
            title: "Deep",
            "#maxNestingDepth": "0",
            children: [
                { id: "lvl1", title: "L1", children: [ { id: "lvl2", title: "L2" } ] }
            ]
        });

        const h = mount(() => useData(parent, [ "lvl1" ], undefined, noopRef, vi.fn()));
        await flush();
        // maxDepth 0 means we should not descend into lvl1's children.
        expect(h.result.current.rowData?.[0]?._children).toBeUndefined();
        // hasChildren stays falsy since no subtree was expanded.
        expect(h.result.current.hasChildren).toBe(false);
    });

    it("restores existing column data and honors newAttributePosition", async () => {
        const parent = buildNote({
            id: "cfg",
            title: "Cfg",
            "#label:status": "promoted,single,text",
            children: [ { id: "cc", title: "CC" } ]
        });

        const viewConfig: TableConfig = {
            tableData: {
                columns: [
                    { title: "#", width: 80 },
                    { title: "Title", field: "title", width: 999, visible: true }
                ]
            }
        };
        const posRef: RefObject<number | undefined> = { current: 1 };
        const reset = vi.fn(() => { posRef.current = undefined; });

        const h = mount(() => useData(parent, [ "cc" ], viewConfig, posRef, reset));
        await flush();

        const titleCol = h.result.current.columnDefs?.find(c => c.field === "title");
        expect(titleCol?.width).toBe(999); // width restored from existing data
        expect(reset).toHaveBeenCalled();
    });
});

describe("useData - entitiesReloaded handling", () => {
    function setup() {
        const parent = buildNote({
            id: "main",
            title: "Main",
            children: [ { id: "kid", title: "Kid" } ]
        });
        const reset = vi.fn();
        // Stable noteIds reference so re-renders (e.g. via fireEvent) don't re-run the mount effect.
        const noteIds = [ "kid" ];
        const h = mount(() => useData(parent, noteIds, undefined, noopRef, reset));
        return { parent, reset, h, noteIds };
    }

    it("ignores events entirely in print mode", async () => {
        (globalThis as unknown as { glob: { device?: string } }).glob.device = "print";
        const { h, reset } = setup();
        await settle();
        reset.mockClear();

        h.fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults({ noteIds: [ "kid" ] })
        });
        await flush();
        // refresh() calls resetNewAttributePosition; in print mode it must not run.
        expect(reset).not.toHaveBeenCalled();
    });

    it("refreshes on a column-definition attribute change affecting the note", async () => {
        const { h, reset, parent } = setup();
        await flush();
        reset.mockClear();
        const spy = vi.spyOn(attributes, "isAffecting").mockReturnValue(true);

        h.fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults({
                attributeRows: [ { type: "label", name: "label:status", noteId: parent.noteId, isDeleted: false } ]
            })
        });
        await flush();
        expect(spy).toHaveBeenCalled();
        expect(reset).toHaveBeenCalled();
    });

    it("refreshes when a branch row targets the parent note", async () => {
        const { h, reset, parent } = setup();
        await flush();
        reset.mockClear();

        h.fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults({
                branchRows: [ { parentNoteId: parent.noteId } ]
            })
        });
        await flush();
        expect(reset).toHaveBeenCalled();
    });

    it("refreshes when a branch row targets one of the displayed noteIds", async () => {
        const { h, reset } = setup();
        await flush();
        reset.mockClear();

        h.fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults({
                branchRows: [ { parentNoteId: "kid" } ]
            })
        });
        await flush();
        expect(reset).toHaveBeenCalled();
    });

    it("refreshes when a reloaded note id is among the displayed noteIds", async () => {
        const { h, reset } = setup();
        await flush();
        reset.mockClear();

        h.fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults({ noteIds: [ "kid" ] })
        });
        await flush();
        expect(reset).toHaveBeenCalled();
    });

    it("refreshes when an attribute row belongs to a displayed note", async () => {
        const { h, reset } = setup();
        await flush();
        reset.mockClear();

        h.fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults({
                attributeRows: [ { type: "label", name: "someLabel", noteId: "kid", isDeleted: false } ]
            })
        });
        await flush();
        expect(reset).toHaveBeenCalled();
    });

    it("refreshes when an archived attribute row affects a displayed note", async () => {
        const { h, reset } = setup();
        await flush();
        reset.mockClear();

        // Use the archived branch specifically: name === "archived" and noteId in noteIds.
        h.fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults({
                attributeRows: [ { type: "label", name: "archived", noteId: "kid", isDeleted: false } ]
            })
        });
        await flush();
        expect(reset).toHaveBeenCalled();
    });

    it("does not refresh for unrelated events", async () => {
        const { h, reset } = setup();
        await settle();
        reset.mockClear();
        vi.spyOn(attributes, "isAffecting").mockReturnValue(false);

        h.fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults({
                // Includes an archived row for an unrelated note: exercises the line-65 predicate
                // (name === "archived") while noteIds.includes() is false.
                attributeRows: [
                    { type: "label", name: "label:other", noteId: "elsewhere", isDeleted: false },
                    { type: "label", name: "archived", noteId: "elsewhere", isDeleted: false }
                ],
                branchRows: [ { parentNoteId: "elsewhere" } ],
                noteIds: [ "elsewhere" ]
            })
        });
        await flush();
        expect(reset).not.toHaveBeenCalled();
    });
});
