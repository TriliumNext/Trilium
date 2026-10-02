import type { ResourceInput } from "fullcalendar-scheduler";

/** The part of an `FNote` that a timeline row reads. */
export interface ResourceSourceNote {
    title: string;
    getIcon(): string;
    getChildNoteIds(): string[];
}

/**
 * Builds one timeline row per note in `noteIds`, nested the way the notes are nested in the tree
 * under `rootNoteId` and ordered by branch position. A note reached by more than one path (a
 * clone) gets a single row, under the first parent the walk reaches. Notes outside the subtree,
 * such as the results of a search collection, follow as top-level rows in `noteIds` order.
 */
export function buildResources(rootNoteId: string, noteIds: string[],
    getNote: (noteId: string) => ResourceSourceNote | null | undefined): ResourceInput[] {
    const included = new Set(noteIds);
    const visited = new Set<string>();
    const resources: ResourceInput[] = [];

    function addRow(noteId: string, parentId: string | undefined) {
        const note = getNote(noteId);
        if (!note) return;

        visited.add(noteId);
        resources.push({
            id: noteId,
            parentId,
            title: note.title,
            order: resources.length,
            iconClass: note.getIcon()
        });
        walk(noteId, note);
    }

    function walk(noteId: string, note: ResourceSourceNote) {
        for (const childNoteId of note.getChildNoteIds()) {
            if (!included.has(childNoteId) || visited.has(childNoteId)) continue;
            addRow(childNoteId, noteId === rootNoteId ? undefined : noteId);
        }
    }

    const rootNote = getNote(rootNoteId);
    if (rootNote) {
        visited.add(rootNoteId);
        walk(rootNoteId, rootNote);
    }

    for (const noteId of noteIds) {
        if (!visited.has(noteId)) {
            addRow(noteId, undefined);
        }
    }

    return resources;
}
