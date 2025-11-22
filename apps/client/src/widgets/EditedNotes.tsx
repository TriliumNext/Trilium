import { useEffect, useState } from "preact/hooks";
import { EditedNotesResponse, EditedNote } from "@triliumnext/commons";
import server from "../services/server";
import { t } from "../services/i18n";
import froca from "../services/froca";
import NoteLink from "./react/NoteLink";
import { joinElements } from "./react/react_utils";

interface EditedNotesProps {
    noteId?: string,
    dateFilter: string,
    showNotePath?: boolean,
}

export default function EditedNotes({ noteId, dateFilter, showNotePath = true } : EditedNotesProps) {
   const [ editedNotes, setEditedNotes ] = useState<EditedNote[]>();

    useEffect(() => {
        if (!noteId || !dateFilter) return;
        server.get<EditedNotesResponse>(`edited-notes/${dateFilter}`)
            .then(async response => {
                const filteredNotes = response.notes.filter((n) => n.noteId !== noteId);
                const noteIds = filteredNotes.flatMap((n) => n.noteId);
                await froca.getNotes(noteIds, true); // preload all at once
                setEditedNotes(filteredNotes);
            })
            .catch(err => {
                console.error("Failed to fetch edited notes:", err);
                setEditedNotes([]);
            });
    }, [noteId, dateFilter]);

    return (
        <>
            {editedNotes?.length ? (
                <div className="edited-notes-list use-tn-links">
                    {joinElements(editedNotes.map(editedNote => {
                        return (
                            <span className="edited-note-line">
                                {editedNote.isDeleted ? (
                                    <i>{`${editedNote.title} ${t("edited_notes.deleted")}`}</i>
                                ) : (
                                    <>
                                        {editedNote.notePath ? <NoteLink notePath={editedNote.notePath} showNotePath={showNotePath} /> : <span>{editedNote.title}</span>}
                                    </>
                                )}
                            </span>
                        )
                    }), " ")}
                </div>
            ) : (
                <div className="no-edited-notes-found">{t("edited_notes.no_edited_notes_found")}</div>
            )}
        </>
    )
}
