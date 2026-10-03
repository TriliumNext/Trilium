import type { ResourceInput } from "fullcalendar-scheduler";
import type { AttributeDefinitionInformation } from "../table/columns";

/** A FullCalendar resource standing for one note. */
export type TimelineRow = ResourceInput & { id: string };

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
    getNote: (noteId: string) => ResourceSourceNote | null | undefined): TimelineRow[] {
    const included = new Set(noteIds);
    const visited = new Set<string>();
    const resources: TimelineRow[] = [];

    function addRow(noteId: string, parentId: string | undefined) {
        const note = getNote(noteId);
        if (!note) return;

        visited.add(noteId);
        resources.push({
            id: noteId,
            // Left out rather than undefined: FullCalendar runs `String()` on any `parentId` key.
            ...(parentId && { parentId }),
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

/** The part of an `FNote` that a timeline column reads. */
export interface ColumnSourceNote {
    getLabels(name: string): { value: string }[];
    getRelations(name: string): { value: string }[];
}

/**
 * The values a note shows in a column, as text: a label's values as they are, a relation's targets
 * by title (or by noteId while the target is not loaded). Empty values are left out.
 */
export function getColumnValues(note: ColumnSourceNote, column: AttributeDefinitionInformation,
    getTitle: (noteId: string) => string | undefined): string[] {
    if (column.type === "relation") {
        return note.getRelations(column.name).map(({ value }) => getTitle(value) ?? value);
    }
    return note.getLabels(column.name).map(({ value }) => value).filter(Boolean);
}
