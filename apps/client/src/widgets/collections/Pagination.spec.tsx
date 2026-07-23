/**
 * Tests for the additive `defaultPageSize` parameter added to {@link usePagination} for C7:
 * the caller-provided default (e.g. the synced `searchResultsPageSize` option) drives the page size
 * when the note has no explicit `#pageSize` label, but an explicit label always keeps winning.
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

// 25 real froca notes so usePagination's froca.getNotes() slice never round-trips to the server.
const NOTE_IDS = buildNotes(Array.from({ length: 25 }, (_, i) => ({ id: `pag-${i}`, title: `N${i}` })));

function Harness({ note, noteIds = NOTE_IDS, defaultPageSize }: { note: FNote; noteIds?: string[]; defaultPageSize?: number }) {
    const { page, setPage, pageNotes, pageSize, pageCount } = usePagination(note, noteIds, defaultPageSize);
    observed = { pageSize, pageCount, page, pageNotes, setPage };
    return null;
}

describe("usePagination default page size", () => {
    let container: HTMLElement | undefined;

    beforeEach(() => {
        observed = undefined;
    });

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    async function mount(note: FNote, defaultPageSize?: number) {
        const parent = new Component();
        // Capture in a local const so the type stays narrowed to HTMLElement inside the act() closure.
        const el = document.createElement("div");
        container = el;
        document.body.appendChild(el);
        await act(async () => {
            render(
                <ParentComponent.Provider value={parent}>
                    <Harness note={note} defaultPageSize={defaultPageSize} />
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
