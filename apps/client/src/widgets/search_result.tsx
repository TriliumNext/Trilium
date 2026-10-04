import "./search_result.css";

import type { HighlightedTokenInfo } from "@triliumnext/commons";
import clsx from "clsx";
import { useState } from "preact/hooks";

import type FNote from "../entities/fnote";
import { t } from "../services/i18n";
import { SearchNoteList, useNoteViewType } from "./collections/NoteList";
import SearchResultsList from "./collections/search/SearchResultsList";
import Button from "./react/Button";
import { useNoteContext,  useTriliumEvent } from "./react/hooks";
import NoItems from "./react/NoItems";

enum SearchResultState {
    NO_RESULTS,
    NOT_EXECUTED,
    GOT_RESULTS
}

export default function SearchResult() {
    const { note, notePath, ntxId } = useNoteContext();
    const viewType = useNoteViewType(note);
    const [ , setRefreshCount ] = useState(0);
    const state = getSearchResultState(note);
    const highlightedTokens = note?.highlightedTokenInfos ?? note?.highlightedTokens;

    // The search note is updated in place, so a re-render picks up the new results.
    function refresh() {
        setRefreshCount((count) => count + 1);
    }

    useTriliumEvent("searchRefreshed", ({ ntxId: eventNtxId }) => {
        if (eventNtxId === ntxId) {
            refresh();
        }
    });
    useTriliumEvent("notesReloaded", ({ noteIds }) => {
        if (note?.noteId && noteIds.includes(note.noteId)) {
            refresh();
        }
    });

    return (
        <div className={clsx("search-result-widget", state === undefined && "hidden-ext")}>
            {state === SearchResultState.NOT_EXECUTED && (
                <NoItems icon="bx bx-file-find" text={t("search_result.search_not_executed")}>
                    <Button text={t("search_result.search_now")} triggerCommand="searchNotes" />
                </NoItems>
            )}

            {state === SearchResultState.NO_RESULTS && (
                <NoItems icon="bx bx-rectangle" text={t("search_result.no_notes_found")} />
            )}

            {state === SearchResultState.GOT_RESULTS && (
                viewType === "list"
                    ? (
                        <SearchResultsList
                            media="screen"
                            note={note}
                            notePath={notePath}
                            highlightedTokens={highlightedTokens}
                            ntxId={ntxId}
                        />
                    )
                    : (
                        <SearchNoteList
                            media="screen"
                            note={note}
                            notePath={notePath}
                            highlightedTokens={highlightedTokens}
                            ntxId={ntxId}
                        />
                    )
            )}
        </div>
    );
}

/**
 * Derives the state from the note being rendered rather than from an effect, so the results never
 * render for a note that is not a search note, not even for the render that switches to one.
 */
function getSearchResultState(note: FNote | null | undefined) {
    if (note?.type !== "search") {
        return undefined;
    } else if (!note.searchResultsLoaded) {
        return SearchResultState.NOT_EXECUTED;
    } else if (note.getChildNoteIds().length === 0) {
        return SearchResultState.NO_RESULTS;
    }
    return SearchResultState.GOT_RESULTS;
}
