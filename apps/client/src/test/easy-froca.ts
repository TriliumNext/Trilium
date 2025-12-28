import { NoteType } from "@triliumnext/commons";

import FAttribute from "../entities/fattribute.js";
import FBlob from "../entities/fblob.js";
import FBranch from "../entities/fbranch.js";
import FNote from "../entities/fnote.js";
import froca from "../services/froca.js";
import noteAttributeCache from "../services/note_attribute_cache.js";
import utils from "../services/utils.js";

type AttributeDefinitions = { [key in `#${string}`]: string; };
type RelationDefinitions = { [key in `~${string}`]: string; };

interface NoteDefinition extends AttributeDefinitions, RelationDefinitions {
    id?: string | undefined;
    title: string;
    type?: NoteType;
    children?: NoteDefinition[];
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
    const note = new FNote(froca, {
        noteId: noteDef.id ?? utils.randomString(12),
        title: noteDef.title,
        type: noteDef.type ?? "text",
        mime: "text/html",
        isProtected: false,
        blobId: ""
    });
    froca.notes[note.noteId] = note;
    let childNotePosition = 0;

    // Manage content.
    const content = noteDef.content ?? "";
    note.getContent = async () => content;

    const blob = new FBlob({
        blobId: utils.randomString(10),
        content,
        contentLength: content.length,
        dateModified: new Date().toISOString(),
        utcDateModified: new Date().toISOString()
    });
    note.getBlob = async () => blob;

    // Manage children.
    if (noteDef.children) {
        for (const childDef of noteDef.children) {
            const childNote = buildNote(childDef);
            const branchId = `${note.noteId}_${childNote.noteId}`;
            const branch = new FBranch(froca, {
                branchId,
                noteId: childNote.noteId,
                parentNoteId: note.noteId,
                notePosition: childNotePosition,
                fromSearchNote: false
            });
            froca.branches[branchId] = branch;
            note.addChild(childNote.noteId, branchId, false);
            childNotePosition += 10;
        }
    }

    let position = 0;
    for (const [ key, value ] of Object.entries(noteDef)) {
        const attributeId = utils.randomString(12);
        let name = key.substring(1);
        const isInheritable = key.endsWith("(inheritable)");
        if (isInheritable) {
            name = name.substring(0, name.length - "(inheritable)".length);
        }

        let attribute: FAttribute | null = null;
        if (key.startsWith("#")) {
            attribute = new FAttribute(froca, {
                noteId: note.noteId,
                attributeId,
                type: "label",
                name,
                value,
                position,
                isInheritable
            });
        }

        if (key.startsWith("~")) {
            attribute = new FAttribute(froca, {
                noteId: note.noteId,
                attributeId,
                type: "relation",
                name,
                value,
                position,
                isInheritable
            });
        }

        if (!attribute) {
            continue;
        }

        froca.attributes[attributeId] = attribute;
        note.attributes.push(attributeId);
        position++;

        // Inject the attribute into the note attribute cache, since FNote.getAttribute() doesn't always work.
        // If we add support for templates into froca, this might cause issues.
        if (!noteAttributeCache.attributes[note.noteId]) {
            noteAttributeCache.attributes[note.noteId] = [];
        }
        noteAttributeCache.attributes[note.noteId].push(attribute);
    }
    return note;
}
