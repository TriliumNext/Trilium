import type { MetadataResponse, NoteSizeResponse, SubtreeSizeResponse } from "@triliumnext/commons";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";

import type FNote from "../../entities/fnote";
import debounce from "../../services/debounce";
import froca from "../../services/froca";
import server from "../../services/server";
import { useTriliumEvent } from "../react/hooks/events";

export function useNoteMetadata(note: FNote | null | undefined, debounceTime = 10_000) {
    const [ isLoading, setIsLoading ] = useState(false);
    const [ noteSizeResponse, setNoteSizeResponse ] = useState<NoteSizeResponse>();
    const [ subtreeSizeResponse, setSubtreeSizeResponse ] = useState<SubtreeSizeResponse>();
    const [ metadata, setMetadata ] = useState<MetadataResponse>();

    const refresh = useCallback(() => {
        // The froca check matters because this also runs off a ten-second debounce: deleting a note is
        // itself an entity change for that note, so a refresh gets scheduled for a note that is about to
        // stop existing, and asking the server about it ten seconds later answers 404 and reports a
        // failure the user can do nothing about.
        if (note && froca.getNoteFromCache(note.noteId)) {
            server.get<MetadataResponse>(`notes/${note.noteId}/metadata`).then(setMetadata);
        }

        setNoteSizeResponse(undefined);
        setSubtreeSizeResponse(undefined);
        setIsLoading(false);
    }, [ note ]);

    const debouncedRefresh = useMemo(() => debounce(refresh, debounceTime), [ refresh, debounceTime ]);
    // Drop a pending refresh when the note changes or the tab goes away, so it can't fire against the
    // note that was showing ten seconds ago.
    useEffect(() => () => debouncedRefresh.clear(), [ debouncedRefresh ]);

    function requestSizeInfo() {
        if (!note) return;

        setIsLoading(true);
        setTimeout(async () => {
            await Promise.allSettled([
                server.get<NoteSizeResponse>(`stats/note-size/${note.noteId}`).then(setNoteSizeResponse),
                server.get<SubtreeSizeResponse>(`stats/subtree-size/${note.noteId}`).then(setSubtreeSizeResponse)
            ]);
            setIsLoading(false);
        }, 0);
    }

    useEffect(() => refresh(), [ refresh ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const noteId = note?.noteId;
        if (noteId && (loadResults.isNoteReloaded(noteId) || loadResults.isNoteContentReloaded(noteId))) {
            debouncedRefresh();
        }
    });

    return { isLoading, metadata, noteSizeResponse, subtreeSizeResponse, requestSizeInfo  };
}
