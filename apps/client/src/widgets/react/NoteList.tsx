import type { CSSProperties } from "preact/compat";
import { useEffect, useState } from "preact/hooks";

import type FNote from "../../entities/fnote";
import froca from "../../services/froca";
import NoteLink from "./NoteLink";

interface NoteListProps {
    noteIds?: string[];
    branchIds?: string[];
    style?: CSSProperties;
}

export default function NoteList({ noteIds, branchIds, style }: NoteListProps) {
    const [ notes, setNotes ] = useState<FNote[]>([]);

    useEffect(() => {
        let notesToLoad: string[];
        if (noteIds) {
            notesToLoad = noteIds;
        } else if (branchIds) {
            notesToLoad = froca.getBranches(branchIds).map(b => b.noteId);
        } else {
            notesToLoad = [];
        }
        froca.getNotes(notesToLoad).then((notes) => setNotes(notes));
    }, [noteIds, branchIds]);

    return (notes &&
        <ul style={style}>
            {notes.map(note => (
                <li key={note.noteId}>
                    {note.title}
                </li>
            ))}
        </ul>
    );
}

export function NoteListWithLinks({ noteIds }: {
    noteIds: string[]
}) {
    const [ notes, setNotes ] = useState<FNote[]>([]);

    useEffect(() => {
        froca.getNotes(noteIds).then((notes) => setNotes(notes));
    }, [ noteIds ]);

    return (notes &&
        <ul>
            {notes.map(note => (
                <li key={note.noteId}>
                    <NoteLink notePath={note.noteId} showNotePath showNoteIcon noPreview />
                </li>
            ))}
        </ul>
    );
}
