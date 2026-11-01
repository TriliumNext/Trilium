import { NoteType } from "@triliumnext/commons";

import FAttribute from "../entities/fattribute.js";
import FBlob from "../entities/fblob.js";
import FBranch from "../entities/fbranch.js";
import FNote from "../entities/fnote.js";
import froca from "../services/froca.js";
import noteAttributeCache from "../services/note_attribute_cache.js";
import utils from "../services/utils.js";

type AttributeDefinitions = { [key in `#${string}`]: string | string[]; };
type RelationDefinitions = { [key in `~${string}`]: string | string[]; };

interface NoteDefinition extends AttributeDefinitions, RelationDefinitions {
    id?: string | undefined;
    title: string;
    type?: NoteType;
    mime?: string;
    children?: NoteDefinition[];
    content?: string;
}

/**
 * Creates the given notes with the given title and optionally one or more attributes.
 *
 * For a label to be created, simply pass on a key prefixed with `#` and any desired value; `~` makes
 * a relation. An array value creates one attribute per element, since an object literal cannot repeat
 * a key. An `(inheritable)` suffix on the name marks the attribute inheritable, and the descendants
 * built here see it through `note.getAttributes()`, like in the application.
 *
 * The notes and attributes will be injected in the froca.
 *
 * @param notes
 * @returns an array containing the IDs of the created notes.
 * @example
 * buildNotes([
 *  { title: "A", "#startDate": "2025-05-05" },
 *  { title: "B", "#startDate": "2025-05-07" },
 *  { title: "C", "#shared(inheritable)": "x", "~template": ["tpl1", "tpl2"] }
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
        mime: noteDef.mime ?? "text/html",
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

    let position = 0;
    for (const [ key, rawValue ] of Object.entries(noteDef)) {
        if (!key.startsWith("#") && !key.startsWith("~")) {
            continue;
        }

        const type = key.startsWith("#") ? "label" : "relation";
        let name = key.substring(1);
        const isInheritable = name.endsWith("(inheritable)");
        if (isInheritable) {
            name = name.substring(0, name.length - "(inheritable)".length);
        }

        // An array stands for several attributes of the same name.
        const values = Array.isArray(rawValue) ? rawValue : [ rawValue as string ];
        for (const value of values) {
            const attributeId = utils.randomString(12);
            const attribute = new FAttribute(froca, {
                noteId: note.noteId,
                attributeId,
                type,
                name,
                value,
                position,
                isInheritable
            });

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
    }

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
            childNote.addParent(note.noteId, branchId, false);
            childNotePosition += 10;
        }

        spreadInheritableAttributes(note);
    }

    return note;
}

/**
 * Appends the note's inheritable attributes (own and already-inherited alike) to the cached
 * attribute list of every descendant, the way the application's attribute inheritance resolves
 * them. Needed because a note whose attributes were seeded into the cache above never computes
 * its inherited ones.
 */
function spreadInheritableAttributes(note: FNote) {
    const inheritableAttributes =
        (noteAttributeCache.attributes[note.noteId] ?? []).filter((attr) => attr.isInheritable);
    if (inheritableAttributes.length === 0) {
        return;
    }

    for (const childNoteId of note.children) {
        const childNote = froca.getNoteFromCache(childNoteId);
        if (!childNote) {
            continue;
        }

        if (!noteAttributeCache.attributes[childNoteId]) {
            noteAttributeCache.attributes[childNoteId] = [];
        }
        for (const attr of inheritableAttributes) {
            if (!noteAttributeCache.attributes[childNoteId].includes(attr)) {
                noteAttributeCache.attributes[childNoteId].push(attr);
            }
        }

        spreadInheritableAttributes(childNote);
    }
}
