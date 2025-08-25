import { useEffect, useState } from "preact/hooks";
import { TabContext } from "./ribbon-interface";
import { EditedNotesResponse } from "@triliumnext/commons";
import server from "../../services/server";
import { t } from "../../services/i18n";
import froca from "../../services/froca";
import NoteLink from "../react/NoteLink";
import { joinElements } from "../react/react_utils";

export default function EditedNotesTab({ note }: TabContext) {
    const [ editedNotes, setEditedNotes ] = useState<EditedNotesResponse>();

    useEffect(() => {
        if (!note) return;
        server.get<EditedNotesResponse>(`edited-notes/${note.getLabelValue("dateNote")}`).then(async editedNotes => {
            editedNotes = editedNotes.filter((n) => n.noteId !== note.noteId);        
            const noteIds = editedNotes.flatMap((n) => n.noteId);            
            await froca.getNotes(noteIds, true); // preload all at once
            setEditedNotes(editedNotes);
        });
    }, [ note?.noteId ]);

    return (
        <div className="edited-notes-widget" style={{
            padding: "12px",
            maxHeight: "200px",
            width: "100%",
            overflow: "auto"
        }}>
            {editedNotes?.length ? (
                <div className="edited-notes-list use-tn-links">
                    {joinElements(editedNotes.map(editedNote => {
                        return (
                            <span className="edited-note-line">
                                {editedNote.isDeleted ? (
                                    <i>{`${editedNote.title} ${t("edited_notes.deleted")}`}</i>
                                ) : (
                                    <>
                                        {editedNote.notePath ? <NoteLink notePath={editedNote.notePath} showNotePath /> : <span>{editedNote.title}</span> }
                                    </>
                                )}
                            </span>
                        )
                    }))}
                </div>
            ) : (
                <div className="no-edited-notes-found">{t("edited_notes.no_edited_notes_found")}</div>
            )}
        </div>
    )    
}
