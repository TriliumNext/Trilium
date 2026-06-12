import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// Stub NoteLink so we don't trigger link.createLink / froca async loads; render an assertable element.
vi.mock("../react/NoteLink", () => ({
    default: ({ notePath, className }: { notePath: string; className?: string }) => (
        <span class={`note-link-stub ${className ?? ""}`.trim()} data-note-path={notePath} />
    )
}));

import Component from "../../components/component";
import { NotePathRecord } from "../../entities/fnote";
import { NOTE_PATH_TITLE_SEPARATOR } from "../../services/tree";
import { buildNote } from "../../test/easy-froca";
import { flush, makeLoadResults, renderComponent, renderHook, resetFroca } from "../../test/render";
import NotePathsTab, { NotePathsWidget, useSortedNotePaths } from "./NotePathsTab";

// --- Helpers -------------------------------------------------------------------------------------

function renderWidget(vnode: preact.VNode, parent: Component = new Component()) {
    return renderComponent(vnode, { parent }).container;
}

function makeRecord(overrides: Partial<NotePathRecord> = {}): NotePathRecord {
    return {
        notePath: [ "root", "a" ],
        isInHoistedSubTree: true,
        isArchived: false,
        isSearch: false,
        isHidden: false,
        ...overrides
    };
}

beforeEach(() => {
    resetFroca();
    vi.clearAllMocks();
});

// --- NotePathsWidget -----------------------------------------------------------------------------

describe("NotePathsWidget", () => {
    it("renders the 'not placed' intro and an empty list when no paths exist", () => {
        const el = renderWidget(<NotePathsWidget sortedNotePaths={[]} />);
        expect(el.querySelector(".note-paths-widget")).toBeTruthy();
        expect(el.querySelector(".note-path-intro")).toBeTruthy();
        expect(el.querySelectorAll(".note-path-list li").length).toBe(0);
        expect(el.querySelector("a.tn-link[role='button']")).toBeTruthy();
    });

    it("renders one <li> per path and joins segments with NoteLink stubs + separators", () => {
        const paths = [
            makeRecord({ notePath: [ "root", "a", "b" ] }),
            makeRecord({ notePath: [ "root", "c" ] })
        ];
        const el = renderWidget(<NotePathsWidget sortedNotePaths={paths} currentNotePath="root/a/b" />);
        const items = el.querySelectorAll(".note-path-list li");
        expect(items.length).toBe(2);

        // First path has 3 segments → 3 NoteLink stubs with cumulative full paths.
        const firstLinks = items[0]?.querySelectorAll(".note-link-stub");
        expect(firstLinks?.length).toBe(3);
        expect(Array.from(firstLinks ?? []).map(l => l.getAttribute("data-note-path")))
            .toEqual([ "root", "root/a", "root/a/b" ]);

        // The last segment is the "basename".
        expect(firstLinks?.[2]?.classList.contains("basename")).toBe(true);
        expect(firstLinks?.[0]?.classList.contains("basename")).toBe(false);

        // Separators inserted between the links.
        expect(items[0]?.textContent).toContain(NOTE_PATH_TITLE_SEPARATOR.trim());
    });

    it("marks the current path and adds the hoisted-subtree class (no outside icon)", () => {
        const paths = [ makeRecord({ notePath: [ "root", "a" ], isInHoistedSubTree: true }) ];
        const el = renderWidget(<NotePathsWidget sortedNotePaths={paths} currentNotePath="root/a" />);
        const li = el.querySelector(".note-path-list li");
        expect(li?.classList.contains("path-current")).toBe(true);
        expect(li?.classList.contains("path-in-hoisted-subtree")).toBe(true);
        // In hoisted subtree → no trending-up icon.
        expect(li?.querySelector("i.bx-trending-up")).toBeNull();
    });

    it("adds the outside-hoisted icon when not in the hoisted subtree", () => {
        const paths = [ makeRecord({ notePath: [ "root", "x" ], isInHoistedSubTree: false }) ];
        const el = renderWidget(<NotePathsWidget sortedNotePaths={paths} currentNotePath="root/other" />);
        const li = el.querySelector(".note-path-list li");
        expect(li?.classList.contains("path-current")).toBe(false);
        expect(li?.classList.contains("path-in-hoisted-subtree")).toBe(false);
        expect(li?.querySelector("i.bx-trending-up")).toBeTruthy();
    });

    it("adds archived and search classes + icons", () => {
        const paths = [
            makeRecord({ notePath: [ "root", "arch" ], isInHoistedSubTree: false, isArchived: true, isSearch: true })
        ];
        const el = renderWidget(<NotePathsWidget sortedNotePaths={paths} />);
        const li = el.querySelector(".note-path-list li");
        expect(li?.classList.contains("path-archived")).toBe(true);
        expect(li?.classList.contains("path-search")).toBe(true);
        expect(li?.querySelector("i.bx-archive")).toBeTruthy();
        expect(li?.querySelector("i.bx-search")).toBeTruthy();
        expect(li?.querySelector("i.bx-trending-up")).toBeTruthy();
    });

    it("treats an undefined notePathRecord as in-hoisted-subtree (defensive branch)", () => {
        const el = renderWidget(<NotePathsWidget sortedNotePaths={undefined} />);
        // undefined sortedNotePaths → 'not placed' intro + no list items.
        expect(el.querySelectorAll(".note-path-list li").length).toBe(0);
    });

    it("tolerates a record whose notePath is missing (nullish-fallback branches)", () => {
        // Force the `?? []` defensive branches in NotePath (notePath join + segment loop).
        const recordWithoutPath = { ...makeRecord(), notePath: undefined } as unknown as NotePathRecord;
        const el = renderWidget(<NotePathsWidget sortedNotePaths={[ recordWithoutPath ]} />);
        const li = el.querySelector(".note-path-list li");
        expect(li).toBeTruthy();
        // No segments → no NoteLink stubs rendered for this path.
        expect(li?.querySelectorAll(".note-link-stub").length).toBe(0);
    });

    it("fires the cloneNoteIdsTo command when the clone button is clicked", () => {
        const parent = new Component();
        const triggerCommand = vi.spyOn(parent, "triggerCommand").mockReturnValue(undefined);
        const el = renderWidget(<NotePathsWidget sortedNotePaths={[]} />, parent);
        const button = el.querySelector<HTMLAnchorElement>("a.tn-link[role='button']");
        expect(button).toBeTruthy();
        act(() => button?.click());
        expect(triggerCommand).toHaveBeenCalledWith("cloneNoteIdsTo");
    });
});

// --- useSortedNotePaths --------------------------------------------------------------------------

describe("useSortedNotePaths", () => {
    it("returns undefined when there is no note", () => {
        const h = renderHook(() => useSortedNotePaths(null));
        expect(h.result.current).toBeUndefined();
    });

    it("computes sorted records and filters out hidden paths", () => {
        const note = buildNote({ id: "spNote", title: "N" });
        const records: NotePathRecord[] = [
            makeRecord({ notePath: [ "root", "spNote" ], isHidden: false }),
            makeRecord({ notePath: [ "_hidden", "spNote" ], isHidden: true })
        ];
        vi.spyOn(note, "getSortedNotePathRecords").mockReturnValue(records);
        const h = renderHook(() => useSortedNotePaths(note));
        expect(note.getSortedNotePathRecords).toHaveBeenCalledWith(undefined);
        expect(h.result.current?.length).toBe(1);
        expect(h.result.current?.[0]?.isHidden).toBe(false);
    });

    it("passes the hoistedNoteId through to getSortedNotePathRecords", () => {
        const note = buildNote({ id: "spHoist", title: "N" });
        const spy = vi.spyOn(note, "getSortedNotePathRecords").mockReturnValue([]);
        renderHook(() => useSortedNotePaths(note, "hoist1"));
        expect(spy).toHaveBeenCalledWith("hoist1");
    });

    it("refreshes when a matching branch row is reloaded", () => {
        const note = buildNote({ id: "spBranch", title: "N" });
        const spy = vi.spyOn(note, "getSortedNotePathRecords").mockReturnValue([]);
        const h = renderHook(() => useSortedNotePaths(note));
        spy.mockClear();
        h.fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults({ branchRows: [ { noteId: "spBranch" } ] })
        });
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it("refreshes when the note itself is reloaded", () => {
        const note = buildNote({ id: "spReload", title: "N" });
        const spy = vi.spyOn(note, "getSortedNotePathRecords").mockReturnValue([]);
        const h = renderHook(() => useSortedNotePaths(note));
        spy.mockClear();
        h.fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults({ reloadedNoteIds: [ "spReload" ] })
        });
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it("ignores unrelated entitiesReloaded events", () => {
        const note = buildNote({ id: "spIgnore", title: "N" });
        const spy = vi.spyOn(note, "getSortedNotePathRecords").mockReturnValue([]);
        const h = renderHook(() => useSortedNotePaths(note));
        spy.mockClear();
        h.fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults({ branchRows: [ { noteId: "other" } ], reloadedNoteIds: [ "other" ] })
        });
        expect(spy).not.toHaveBeenCalled();
    });

    it("no-ops on entitiesReloaded when there is no note", () => {
        const h = renderHook(() => useSortedNotePaths(undefined));
        // Should not throw and should remain undefined.
        h.fireEvent("entitiesReloaded", {
            loadResults: makeLoadResults({ reloadedNoteIds: [ "anything" ] })
        });
        expect(h.result.current).toBeUndefined();
    });
});

// --- NotePathsTab (default export) ---------------------------------------------------------------

describe("NotePathsTab", () => {
    it("derives sorted paths from the note and renders them", async () => {
        const note = buildNote({ id: "tabNote", title: "Tab" });
        vi.spyOn(note, "getSortedNotePathRecords").mockReturnValue([
            makeRecord({ notePath: [ "root", "tabNote" ] })
        ]);
        const el = renderWidget(
            <NotePathsTab
                note={note}
                hidden={false}
                componentId="cid"
                hoistedNoteId="root"
                notePath="root/tabNote"
                activate={() => undefined}
            />
        );
        await flush();
        expect(el.querySelectorAll(".note-path-list li").length).toBe(1);
        expect(el.querySelector(".note-path-list li")?.classList.contains("path-current")).toBe(true);
    });

    it("renders the 'not placed' state when the note has no paths", () => {
        const note = buildNote({ id: "tabEmpty", title: "Empty" });
        vi.spyOn(note, "getSortedNotePathRecords").mockReturnValue([]);
        const el = renderWidget(
            <NotePathsTab note={note} hidden={false} componentId="cid" activate={() => undefined} />
        );
        expect(el.querySelectorAll(".note-path-list li").length).toBe(0);
        expect(el.querySelector(".note-path-intro")).toBeTruthy();
    });
});
