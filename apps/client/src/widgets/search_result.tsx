import "./search_result.css";

import type { HighlightedTokenInfo } from "@triliumnext/commons";
import clsx from "clsx";
import { useEffect, useRef, useState } from "preact/hooks";

import type FNote from "../entities/fnote";
import { t } from "../services/i18n";
import search from "../services/search";
import toast from "../services/toast";
import { SearchNoteList, useNoteViewType } from "./collections/NoteList";
import SearchResultsList from "./collections/search/SearchResultsList";
import Button from "./react/Button";
import { useHasTabBeenShown, useNoteContext, useTriliumEvent } from "./react/hooks";
import NoItems from "./react/NoItems";

enum SearchResultState {
    NO_RESULTS,
    NOT_EXECUTED,
    GOT_RESULTS
}

export default function SearchResult() {
    const { note, notePath, ntxId, noteContext, parentComponent } = useNoteContext();
    const viewType = useNoteViewType(note);
    const [ , setRefreshCount ] = useState(0);
    const state = getSearchResultState(note);
    const { isSearching, runSearch } = useSavedSearchRun(
        note,
        state === SearchResultState.NOT_EXECUTED,
        { noteContext, ntxId, parentComponent }
    );
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
            {isSearching && (
                <NoItems icon="bx bx-loader-alt bx-spin" text={t("search_result.searching")} />
            )}

            {state === SearchResultState.NOT_EXECUTED && !isSearching && (
                <NoItems icon="bx bx-file-find" text={t("search_result.search_not_executed")}>
                    <Button text={t("search_result.search_now")} onClick={runSearch} />
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

type SearchRunContext = Pick<
    ReturnType<typeof useNoteContext>,
    "noteContext" | "ntxId" | "parentComponent"
>;

/**
 * Runs a saved search that has no results yet, through `search.runSearchNote()`, when it is
 * shown in a visible tab, and reports while a run is in progress. A failed request waits for
 * `runSearch()` ("Search now") or the next showing. Safe mode runs nothing on its own, so a
 * hanging search cannot hang every start-up.
 */
function useSavedSearchRun(
    note: FNote | null | undefined,
    hasNotRun: boolean,
    { noteContext, ntxId, parentComponent }: SearchRunContext
) {
    const hasTabBeenShown = useHasTabBeenShown(noteContext);
    // Tracks in-flight searches started by this hook by note ID.
    const [ runningNoteIds, setRunningNoteIds ] = useState<ReadonlySet<string>>(new Set());
    const autoRunNoteId = useRef<string | undefined>(undefined);

    async function runSearch() {
        const noteId = note?.noteId;
        if (!noteId) {
            return;
        }

        setRunningNoteIds((running) => new Set(running).add(noteId));
        try {
            const result = await search.runSearchNote(parentComponent, noteId, ntxId);
            if (result?.error) {
                toast.showError(result.error);
            }
        } finally {
            setRunningNoteIds((running) => {
                const remaining = new Set(running);
                remaining.delete(noteId);
                return remaining;
            });
        }
    }

    const isRunning = !!note && runningNoteIds.has(note.noteId);
    const runsOnShow = hasNotRun && hasTabBeenShown && !glob.TRILIUM_SAFE_MODE
        && !!note && autoRunNoteId.current !== note.noteId;
    useEffect(() => {
        if (autoRunNoteId.current !== note?.noteId) {
            autoRunNoteId.current = undefined;
        }
    }, [ note?.noteId ]);
    useEffect(() => {
        if (!runsOnShow || !note) return;

        // A run still in flight from an earlier showing counts as this showing's run.
        autoRunNoteId.current = note.noteId;
        if (!isRunning) {
            void runSearch();
        }
    }, [ runsOnShow, note ]); // eslint-disable-line react-hooks/exhaustive-deps

    return {
        isSearching: hasNotRun && (runsOnShow || isRunning),
        runSearch
    };
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
