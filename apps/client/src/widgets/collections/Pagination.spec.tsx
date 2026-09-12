/**
 * Tests for {@link usePagination}: the additive `defaultPageSize` parameter, where the
 * caller-provided default (e.g. the synced `searchResultsPageSize` option) drives the page size
 * only while the note carries no explicit `#pageSize` label; and the page clamping that keeps a
 * shrinking result set or a growing page size from rendering a page past the end.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import type FNote from "../../entities/fnote";
import froca from "../../services/froca";
import { buildNote, buildNotes } from "../../test/easy-froca";
import { ParentComponent } from "../react/react_utils";
import { usePagination } from "./Pagination";

let observed: { pageSize: number; pageCount: number; page: number; pageNotes?: FNote[]; setPage?: (page: number) => void } | undefined;
/** Every committed render, so a test can assert on the frames between a change and its settled state. */
let renders: Array<{ page: number; pageCount: number }> = [];

// 25 real froca notes so usePagination's froca.getNotes() slice never round-trips to the server.
const NOTE_IDS = buildNotes(Array.from({ length: 25 }, (_, i) => ({ id: `pag-${i}`, title: `N${i}` })));

function Harness({ note, noteIds = NOTE_IDS, defaultPageSize }: { note: FNote; noteIds?: string[]; defaultPageSize?: number }) {
    const { page, setPage, pageNotes, pageSize, pageCount } = usePagination(note, noteIds, { defaultPageSize });
    observed = { pageSize, pageCount, page, pageNotes, setPage };
    renders.push({ page, pageCount });
    return null;
}

describe("usePagination", () => {
    let container: HTMLElement | undefined;
    let parent: Component | undefined;

    beforeEach(() => {
        observed = undefined;
        renders = [];
    });

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    async function mount(note: FNote, defaultPageSize?: number, noteIds?: string[]) {
        parent = new Component();
        container = document.createElement("div");
        document.body.appendChild(container);
        await rerender(note, defaultPageSize, noteIds);
    }

    /** Lets the pending `froca.getNotes()` promise resolve and its state update commit. */
    async function settle() {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
    }

    /** Renders into the same container, so the hook keeps its state the way a prop change would. */
    async function rerender(note: FNote, defaultPageSize?: number, noteIds?: string[]) {
        // Capture in local consts so the types stay narrowed inside the act() closure.
        const el = container;
        const parentComponent = parent;
        if (!el || !parentComponent) {
            throw new Error("mount() has to run first");
        }
        await act(async () => {
            render(
                <ParentComponent.Provider value={parentComponent}>
                    <Harness note={note} noteIds={noteIds} defaultPageSize={defaultPageSize} />
                </ParentComponent.Provider>,
                el
            );
        });
    }

    it("uses the provided default page size when the note has no #pageSize label", async () => {
        const note = buildNote({ title: "Search", type: "search" });
        await mount(note, 10);
        expect(observed?.pageSize).toBe(10);
        expect(observed?.pageCount).toBe(3); // 25 items / 10
    });

    it("lets an explicit #pageSize label override the provided default", async () => {
        const note = buildNote({ title: "Search", type: "search", "#pageSize": "5" });
        await mount(note, 50);
        expect(observed?.pageSize).toBe(5);
        expect(observed?.pageCount).toBe(5); // 25 items / 5
    });

    it("falls back to 20 when neither a label nor a positive default is given", async () => {
        const note = buildNote({ title: "Search", type: "search" });
        await mount(note, Number.NaN);
        expect(observed?.pageSize).toBe(20);
    });

    it("never renders past the last page when the result set shrinks under it", async () => {
        const note = buildNote({ title: "Search", type: "search" });
        await mount(note, 10);
        await act(async () => observed?.setPage?.(3));
        await settle();
        expect(observed?.page).toBe(3);
        expect(observed?.pageNotes?.map((n) => n.noteId)).toEqual(NOTE_IDS.slice(20, 25));

        renders = [];
        await rerender(note, 10, NOTE_IDS.slice(0, 12));
        await settle();

        // Callers slice with (page - 1) * pageSize, so a page past the end shows the previous
        // result set's notes in the list and grid views and nothing in the search cards. No
        // committed frame may carry one, not just the settled state.
        expect(renders.length).toBeGreaterThan(0);
        expect(renders.every(({ page, pageCount }) => page <= pageCount)).toBe(true);
        expect(observed?.page).toBe(2);
        expect(observed?.pageNotes?.map((n) => n.noteId)).toEqual(NOTE_IDS.slice(10, 12));
    });

    it("never renders past the last page when the page size grows past it", async () => {
        const note = buildNote({ title: "Search", type: "search" });
        await mount(note, 10);
        await act(async () => observed?.setPage?.(3));
        await settle();

        // What the "Per page" selector does: 25 notes at 25 per page collapse to a single page.
        renders = [];
        await rerender(note, 25);
        await settle();

        expect(renders.length).toBeGreaterThan(0);
        expect(renders.every(({ page, pageCount }) => page <= pageCount)).toBe(true);
        expect(observed?.page).toBe(1);
        expect(observed?.pageNotes).toHaveLength(25);
    });

    it("discards a stale note load that resolves after a newer page's load", async () => {
        // Take over froca.getNotes with manually-resolved deferreds so resolution order can be
        // inverted: rapid page flips issue overlapping loads, and the older one must not win.
        const pending: Array<{ ids: string[]; resolve: (notes: FNote[]) => void }> = [];
        const getNotesSpy = vi.spyOn(froca, "getNotes").mockImplementation((ids) =>
            new Promise((resolve) => pending.push({ ids: ids as string[], resolve }))
        );
        try {
            const note = buildNote({ title: "Search", type: "search" });
            await mount(note, 10);

            // Initial load for page 1, then flip to page 2 and quickly on to page 3.
            expect(pending.length).toBe(1);
            await act(async () => observed?.setPage?.(2));
            await act(async () => observed?.setPage?.(3));
            expect(pending.length).toBe(3);

            const [ , page2Load, page3Load ] = pending;
            const toNotes = (ids: string[]) => ids.map((id) => froca.notes[id]).filter((n): n is FNote => Boolean(n));

            // Newest (page 3) resolves first, then the stale page-2 load arrives late.
            await act(async () => page3Load.resolve(toNotes(page3Load.ids)));
            await act(async () => page2Load.resolve(toNotes(page2Load.ids)));

            expect(observed?.page).toBe(3);
            expect(observed?.pageNotes?.map((n) => n.noteId)).toEqual(page3Load.ids);
        } finally {
            getNotesSpy.mockRestore();
        }
    });
});
