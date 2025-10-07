import { useEffect, useState } from "preact/hooks";
import { TabContext } from "./ribbon-interface";
import { SimilarNoteResponse } from "@triliumnext/commons";
import server from "../../services/server";
import { t } from "../../services/i18n";
import froca from "../../services/froca";
import NoteLink from "../react/NoteLink";

export default function SimilarNotesTab({ note }: TabContext) {
    const [ similarNotes, setSimilarNotes ] = useState<SimilarNoteResponse>();

    useEffect(() => {
        if (note) {
            server.get<SimilarNoteResponse>(`similar-notes/${note.noteId}`).then(async similarNotes => {
                if (similarNotes) {
                    const noteIds = similarNotes.flatMap((note) => note.notePath);
                    await froca.getNotes(noteIds, true); // preload all at once
                }
                setSimilarNotes(similarNotes);
            });    
        }

    }, [ note?.noteId ]);

    return (
        <div className="similar-notes-widget">
            <div className="similar-notes-wrapper">
                {similarNotes?.length ? (
                    <div>
                        {similarNotes.map(({notePath, score}) => (
                            <NoteLink
                                notePath={notePath}
                                noTnLink
                                style={{
                                    "font-size": 20 * (1 - 1 / (1 + score))
                                }}
                            />
                        ))}
                    </div>
                ) : (
                    <>{t("similar_notes.no_similar_notes_found")}</>
                )}
            </div>
        </div>
    )
}