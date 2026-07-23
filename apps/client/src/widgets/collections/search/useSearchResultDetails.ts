import type { SearchResultDetails, SearchResultDetailsResponse } from "@triliumnext/commons";
import { useEffect, useRef, useState } from "preact/hooks";

import type FNote from "../../../entities/fnote";
import server from "../../../services/server";
import { useTriliumEvent } from "../../react/hooks";

export interface SearchResultDetailsState {
    detailsByNoteId: Map<string, SearchResultDetails>;
    loading: boolean;
}

/**
 * Fetches the lazy per-note snippet/highlight details for a single page of search results.
 *
 * The fetch keys on the page's note-id list (encoded as a string so a freshly sliced array with the
 * same ids doesn't re-trigger it), so paging naturally refetches. That covers re-executions where
 * the matched set changes; a `searchRefreshed` for our `ntxId` additionally forces a refetch so a
 * re-execution that yields the *same* ids but updated content still refreshes the snippets.
 *
 * Responses can land out of order (a slow first page resolving after the user has paged on), so an
 * incrementing sequence ref guards against a stale response clobbering a newer one — the same
 * pattern `useNoteIds` uses for its own refreshes.
 */
export function useSearchResultDetails(
    note: FNote | null | undefined,
    pageNoteIds: string[],
    ntxId: string | null | undefined
): SearchResultDetailsState {
    const [ detailsByNoteId, setDetailsByNoteId ] = useState<Map<string, SearchResultDetails>>(new Map());
    const [ loading, setLoading ] = useState(false);
    const seqRef = useRef(0);
    const [ refreshToken, setRefreshToken ] = useState(0);

    const noteId = note?.noteId;
    const pageKey = pageNoteIds.join(",");

    useEffect(() => {
        if (!noteId || pageNoteIds.length === 0) {
            // Nothing to fetch: drop any stale details and mark the newest issued fetch as this one
            // so a still-pending older response can't land later.
            seqRef.current++;
            setDetailsByNoteId(new Map());
            setLoading(false);
            return;
        }

        const seq = ++seqRef.current;
        setLoading(true);
        server.post<SearchResultDetailsResponse>(`search-note/${noteId}/result-details`, { noteIds: pageNoteIds })
            .then((response) => {
                if (seq !== seqRef.current) return; // superseded by a newer fetch
                setDetailsByNoteId(new Map(response.results.map((result) => [ result.noteId, result ])));
                setLoading(false);
            })
            .catch(() => {
                if (seq !== seqRef.current) return;
                setDetailsByNoteId(new Map());
                setLoading(false);
            });
        // pageKey stands in for the pageNoteIds array identity; refreshToken forces a re-execution refetch.
    }, [ noteId, pageKey, refreshToken ]);

    useTriliumEvent("searchRefreshed", ({ ntxId: eventNtxId }) => {
        if (eventNtxId === ntxId) {
            setRefreshToken((token) => token + 1);
        }
    });

    return { detailsByNoteId, loading };
}
