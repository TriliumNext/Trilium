import { useContext, useEffect, useRef, useState } from "preact/hooks";
import { t } from "../../services/i18n";
import FormGroup from "../react/FormGroup";
import NoteAutocomplete from "../react/NoteAutocomplete";
import "./Empty.css";
import { ParentComponent, refToJQuerySelector } from "../react/react_utils";
import note_autocomplete from "../../services/note_autocomplete";
import appContext from "../../components/app_context";
import FNote from "../../entities/fnote";
import search from "../../services/search";
import { TypeWidgetProps } from "./type_widget";

export default function Empty({ ntxId }: TypeWidgetProps) {
    return (
        <>
            <WorkspaceSwitcher />
            <NoteSearch ntxId={ntxId ?? null} />
        </>
    )
}

function NoteSearch({ ntxId }: { ntxId: string | null }) {
    const resultsContainerRef = useRef<HTMLDivElement>(null);
    const autocompleteRef = useRef<HTMLInputElement>(null);

    // Show recent notes.
    useEffect(() => {
        const $autoComplete = refToJQuerySelector(autocompleteRef);
        note_autocomplete.showRecentNotes($autoComplete);
    }, []);

    return (
        <>
            <FormGroup name="empty-tab-search" label={t("empty.open_note_instruction")} className="empty-tab-search">
                <NoteAutocomplete
                    placeholder={t("empty.search_placeholder")}
                    container={resultsContainerRef}
                    inputRef={autocompleteRef}
                    opts={{
                        hideGoToSelectedNoteButton: true,
                        allowCreatingNotes: true,
                        allowJumpToSearchNotes: true,
                    }}
                    onChange={suggestion => {
                        if (!suggestion?.notePath) {
                            return false;
                        }
                        const activeNoteContext = appContext.tabManager.getNoteContextById(ntxId) ?? appContext.tabManager.getActiveContext();
                        if (activeNoteContext) {
                            activeNoteContext.setNote(suggestion.notePath);
                        }
                    }}
                />
            </FormGroup>
            <div ref={resultsContainerRef} className="note-detail-empty-results" />
        </>
    );
}

function WorkspaceSwitcher() {
    const [ workspaceNotes, setWorkspaceNotes ] = useState<FNote[]>();
    const parentComponent = useContext(ParentComponent);

    function refresh() {
        search.searchForNotes("#workspace #!template").then(setWorkspaceNotes);
    }

    useEffect(refresh, []);

    return (
        <div class="workspace-notes">
            {workspaceNotes?.map(workspaceNote => (
                <div
                    className="workspace-note"
                    title={t("empty.enter_workspace", { title: workspaceNote.title })}
                    onClick={() => parentComponent?.triggerCommand("hoistNote", { noteId: workspaceNote.noteId })}
                >
                    <div className={`${workspaceNote.getIcon()} workspace-icon`} />
                    <div>{workspaceNote.title}</div>
                </div>
            ))}
        </div>
    );
}
