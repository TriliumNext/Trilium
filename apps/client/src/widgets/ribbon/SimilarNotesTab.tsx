import "./SimilarNotesTab.css";

import { SimilarNoteResponse } from "@triliumnext/commons";
import { useEffect, useState } from "preact/hooks";

import froca from "../../services/froca";
import { t } from "../../services/i18n";
import server from "../../services/server";
import NoItems from "../react/NoItems";
import NoteLink from "../react/NoteLink";
import { TabContext } from "./ribbon-interface";

export default function SimilarNotesTab({ note }: Pick<TabContext, "note">) {
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
            {similarNotes?.length ? (
                <div className="similar-notes-wrapper">
                    {similarNotes.map(({notePath, score}) => (
                        <NoteLink
                            key={notePath.join("/")}
                            notePath={notePath}
                            noTnLink
                            style={{
                                "font-size": (1 - 1 / (1 + score)) + "em"
                            }}
                        />
                    ))}
                </div>
            ) : similarNotes && (
                // Outside the list's wrapper, whose font size is that of the most similar link.
                <NoItems
                    size="small"
                    icon="bx bx-bar-chart"
                    text={t("similar_notes.no_similar_notes_found")}
                />
            )}
        </div>
    );
}
