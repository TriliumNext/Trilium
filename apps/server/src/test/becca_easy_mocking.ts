import utils from "../services/utils.js";
import BNote from "../becca/entities/bnote.js";
import BAttribute from "../becca/entities/battribute.js";

type AttributeDefinitions = { [key in `#${string}`]: string; };
type RelationDefinitions = { [key in `~${string}`]: string; };

interface NoteDefinition extends AttributeDefinitions, RelationDefinitions {
    id?: string | undefined;
    title?: string;
    content?: string;
}

/**
 * Creates the given notes with the given title and optionally one or more attributes.
 *
 * For a label to be created, simply pass on a key prefixed with `#` and any desired value.
 *
 * The notes and attributes will be injected in the froca.
 *
 * @param notes
 * @returns an array containing the IDs of the created notes.
 * @example
 * buildNotes([
 *  { title: "A", "#startDate": "2025-05-05" },
 *  { title: "B", "#startDate": "2025-05-07" }
 * ]);
 */
export function buildNotes(notes: NoteDefinition[]) {
    const ids: string[] = [];

    for (const noteDef of notes) {
        ids.push(buildNote(noteDef).noteId);
    }

    return ids;
}

export function buildNote(noteDef: NoteDefinition) {
    const note = new BNote({
        noteId: noteDef.id ?? utils.randomString(12),
        title: noteDef.title ?? "New note",
        type: "text",
        mime: "text/html",
        isProtected: false,
        blobId: ""
    });

    // Handle content.
    if (noteDef.content) {
        note.getContent = () => noteDef.content!;
    }

    // Handle labels and relations.
    let position = 0;
    for (const [ key, value ] of Object.entries(noteDef)) {
        const attributeId = utils.randomString(12);
        const name = key.substring(1);

        let attribute: BAttribute | null = null;
        if (key.startsWith("#")) {
            attribute = new BAttribute({
                noteId: note.noteId,
                attributeId,
                type: "label",
                name,
                value,
                position,
                isInheritable: false
            });
        }

        if (key.startsWith("~")) {
            attribute = new BAttribute({
                noteId: note.noteId,
                attributeId,
                type: "relation",
                name,
                value,
                position,
                isInheritable: false
            });
        }

        if (!attribute) {
            continue;
        }

        position++;
    }
    return note;
}
