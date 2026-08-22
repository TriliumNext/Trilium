import "./search_result.css";

import clsx from "clsx";
import { useContext, useEffect, useState } from "preact/hooks";

import froca from "../services/froca";
import { t } from "../services/i18n";
import toast from "../services/toast";
import { getErrorMessage } from "../services/utils";
import { SearchNoteList } from "./collections/NoteList";
import Button from "./react/Button";
import { useNoteContext, useTriliumEvent } from "./react/hooks";
import NoItems from "./react/NoItems";
import { ParentComponent } from "./react/react_utils";

enum SearchResultState {
    NO_RESULTS,
    NOT_EXECUTED,
    GOT_RESULTS
}

export default function SearchResult() {
    const { note, notePath, ntxId } = useNoteContext();
    const [ state, setState ] = useState<SearchResultState>();
    const [ highlightedTokens, setHighlightedTokens ] = useState<string[]>();
    const parentComponent = useContext(ParentComponent);

    function refresh() {
        if (note?.type !== "search") {
            setState(undefined);
        } else if (!note?.searchResultsLoaded) {
            setState(SearchResultState.NOT_EXECUTED);
        } else if (note.getChildNoteIds().length === 0) {
            setState(SearchResultState.NO_RESULTS);
        } else {
            setState(SearchResultState.GOT_RESULTS);
            setHighlightedTokens(note.highlightedTokens);
        }
    }

    // Why a dedicated handler instead of the global `searchNotes` command: that command creates
    // a brand-new (empty) search note and navigates to it, so the one affordance on the
    // "not executed" screen abandoned the saved search it was supposed to run (#11130).
    async function executeThisSearch() {
        const noteId = note?.noteId;
        if (!noteId) {
            return;
        }

        try {
            await froca.loadSearchNote(noteId);
        } catch (e: unknown) {
            toast.showError(getErrorMessage(e));
            return;
        }

        parentComponent?.triggerEvent("searchRefreshed", { ntxId });
    }

    useEffect(() => refresh(), [ note ]);
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
                    <Button text={t("search_result.search_now")} onClick={() => executeThisSearch()} />
                </NoItems>
            )}

            {state === SearchResultState.NO_RESULTS && (
                <NoItems icon="bx bx-rectangle" text={t("search_result.no_notes_found")} />
            )}

            {state === SearchResultState.GOT_RESULTS && (
                <SearchNoteList
                    media="screen"
                    note={note}
                    notePath={notePath}
                    highlightedTokens={highlightedTokens}
                    ntxId={ntxId}
                />
            )}
        </div>
    );
}
