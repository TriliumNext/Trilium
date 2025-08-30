import { useEffect, useState } from "preact/hooks";
import { t } from "../services/i18n";
import Alert from "./react/Alert";
import { useNoteContext,  useTriliumEvent } from "./react/hooks";
import "./search_result.css";
import NoteList from "./collections/NoteList";
// import NoteListRenderer from "../services/note_list_renderer";

enum SearchResultState {
    NO_RESULTS,
    NOT_EXECUTED,
    GOT_RESULTS
}

export default function SearchResult() {
    const { note, ntxId } = useNoteContext();
    const [ state, setState ] = useState<SearchResultState>();
    const [ highlightedTokens, setHighlightedTokens ] = useState<string[]>();

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
        <div className="search-result-widget">
            {state === SearchResultState.NOT_EXECUTED && (
                <Alert type="info" className="search-not-executed-yet">{t("search_result.search_not_executed")}</Alert>
            )}

            {state === SearchResultState.NO_RESULTS && (
                <Alert type="info" className="search-no-results">{t("search_result.no_notes_found")}</Alert>
            )}

            {state === SearchResultState.GOT_RESULTS && (
                <NoteList note={note} highlightedTokens={highlightedTokens} />
            )}
        </div>
    );
}
