import { useMemo } from "preact/hooks";

import FNote from "../../../entities/fnote";

/**
 * Filters the note IDs for the legacy view to filter out subnotes that are already included in the note content such as images, included notes.
 */
export function useFilteredNoteIds(note: FNote, noteIds: string[]) {
    return useMemo(() => {
        const includedLinks = note ? note.getRelations().filter((rel) => rel.name === "imageLink" || rel.name === "includeNoteLink") : [];
        const includedNoteIds = new Set(includedLinks.map((rel) => rel.value));
        return noteIds.filter((noteId) => !includedNoteIds.has(noteId) && noteId !== "_hidden");
    }, [ note, noteIds ]);
}

export async function filterChildNotes(note: FNote, includeArchived = true) {
    const imageLinks = note.getRelations("imageLink");
    const imageLinkNoteIds = new Set(imageLinks.map(rel => rel.value));
    const childNotes = await note.getChildNotes();
    return childNotes.filter((childNote) => !imageLinkNoteIds.has(childNote.noteId) && (includeArchived || !childNote.isArchived));
}
