/**
 * Tests for {@link useSearchResultDetails}: the per-page snippet fetch backing the snippet-card
 * search results view. Covers the happy path (details indexed by noteId, `loading` transitions),
 * the stale-response guard (an older in-flight response must not clobber a newer one), and the
 * re-execution refetch triggered by `searchRefreshed` for the matching ntxId.
 */
import { deferred } from "@triliumnext/commons";
import type { SearchResultDetailsResponse } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../../components/component";
import type FNote from "../../../entities/fnote";
import server from "../../../services/server";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import { useSearchResultDetails } from "./useSearchResultDetails";

function makeResponse(noteIds: string[]): SearchResultDetailsResponse {
    return {
        results: noteIds.map((noteId) => ({
            noteId,
            notePath: noteId,
            noteTitle: `Title ${noteId}`,
            notePathTitle: `Root › Title ${noteId}`,
            contentSnippet: `snippet ${noteId}`,
            highlightedContentSnippet: `snippet <b>${noteId}</b>`,
            icon: "bx bx-note"
        })),
        highlightedTokenInfos: [],
        error: null
    };
}

let observed: ReturnType<typeof useSearchResultDetails> | undefined;

function Harness({ note, pageNoteIds, ntxId }: { note: FNote; pageNoteIds: string[]; ntxId: string }) {
    observed = useSearchResultDetails(note, pageNoteIds, ntxId);
    return null;
}

describe("useSearchResultDetails", () => {
    let container: HTMLElement | undefined;
    let parent: Component;

    beforeEach(() => {
        observed = undefined;
        parent = new Component();
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    async function renderHarness(props: { note: FNote; pageNoteIds: string[]; ntxId: string }) {
        const el = container;
        if (!el) throw new Error("container not initialized");
        await act(async () => {
            render(
                <ParentComponent.Provider value={parent}>
                    <Harness {...props} />
                </ParentComponent.Provider>,
                el
            );
        });
    }

    it("fetches details for the page and indexes them by noteId", async () => {
        const post = vi.spyOn(server, "post").mockResolvedValue(makeResponse(["a", "b"]));
        const note = buildNote({ title: "Search", type: "search" });

        await renderHarness({ note, pageNoteIds: ["a", "b"], ntxId: "ntx-1" });
        expect(post).toHaveBeenCalledWith(
            `search-note/${note.noteId}/result-details`,
            { noteIds: ["a", "b"] }
        );

        await act(async () => { await Promise.resolve(); });

        expect(observed?.loading).toBe(false);
        expect(observed?.detailsByNoteId.get("a")?.noteTitle).toBe("Title a");
        expect(observed?.detailsByNoteId.get("b")?.highlightedContentSnippet).toBe("snippet <b>b</b>");
    });

    it("discards a stale response that resolves after a newer one", async () => {
        const first = deferred<SearchResultDetailsResponse>();
        const second = deferred<SearchResultDetailsResponse>();
        const post = vi.spyOn(server, "post")
            .mockReturnValueOnce(first as unknown as Promise<unknown>)
            .mockReturnValueOnce(second as unknown as Promise<unknown>);
        const note = buildNote({ title: "Search", type: "search" });

        // First page fetch.
        await renderHarness({ note, pageNoteIds: ["a"], ntxId: "ntx-1" });
        // Navigate to the next page before the first response lands: a second fetch is issued.
        await renderHarness({ note, pageNoteIds: ["b"], ntxId: "ntx-1" });
        expect(post).toHaveBeenCalledTimes(2);

        // The newer (second) response resolves first...
        await act(async () => {
            second.resolve(makeResponse(["b"]));
            await Promise.resolve();
        });
        // ...then the stale (first) response resolves and must NOT clobber it.
        await act(async () => {
            first.resolve(makeResponse(["a"]));
            await Promise.resolve();
        });

        expect(observed?.detailsByNoteId.has("a")).toBe(false);
        expect(observed?.detailsByNoteId.get("b")?.noteTitle).toBe("Title b");
    });

    it("refetches when the search note re-executes for the matching ntxId", async () => {
        const post = vi.spyOn(server, "post").mockResolvedValue(makeResponse(["a"]));
        const note = buildNote({ title: "Search", type: "search" });

        await renderHarness({ note, pageNoteIds: ["a"], ntxId: "ntx-1" });
        await act(async () => { await Promise.resolve(); });
        expect(post).toHaveBeenCalledTimes(1);

        // A re-execution with an unrelated ntxId must be ignored.
        await act(async () => {
            await parent.handleEvent("searchRefreshed", { ntxId: "other" });
        });
        expect(post).toHaveBeenCalledTimes(1);

        // A re-execution for our ntxId refetches even though the page ids are unchanged.
        await act(async () => {
            await parent.handleEvent("searchRefreshed", { ntxId: "ntx-1" });
            await Promise.resolve();
        });
        expect(post).toHaveBeenCalledTimes(2);
    });
});
