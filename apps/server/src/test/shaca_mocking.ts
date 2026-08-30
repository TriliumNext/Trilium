import utils from "../services/utils.js";
import SAttachment from "../share/shaca/entities/sattachment.js";
import SAttribute from "../share/shaca/entities/sattribute.js";
import SBranch from "../share/shaca/entities/sbranch.js";
import SNote from "../share/shaca/entities/snote.js";
import shaca from "../share/shaca/shaca.js";

type AttributeDefinitions = { [key in `#${string}`]: string; };
type RelationDefinitions = { [key in `~${string}`]: string; };

interface AttachementDefinition {
    id?: string;
    role?: string;
    mime?: string;
    title?: string;
}

interface NoteDefinition extends AttributeDefinitions, RelationDefinitions {
    id?: string | undefined;
    title?: string;
    type?: string;
    mime?: string;
    content?: string | Buffer<ArrayBufferLike>;
    children?: NoteDefinition[];
    attachments?: AttachementDefinition[];
    isProtected?: boolean;
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
 * buildShareNotes([
 *  { title: "A", "#startDate": "2025-05-05" },
 *  { title: "B", "#startDate": "2025-05-07" }
 * ]);
 */
export function buildShareNotes(notes: NoteDefinition[]) {
    const ids: string[] = [];

    for (const noteDef of notes) {
        ids.push(buildShareNote(noteDef).noteId);
    }

    return ids;
}

export function buildShareNote(noteDef: NoteDefinition) {
    const blobId = "foo";
    const note = new SNote([
        noteDef.id ?? utils.randomString(12),
        noteDef.title ?? "New note",
        noteDef.type ?? "text",
        noteDef.mime ?? "text/html",
        blobId,
        new Date().toUTCString(),   // utcDateModified
        !!noteDef.isProtected
    ]);
    shaca.notes[note.noteId] = note;

    // Handle content: an explicitly empty content is still a content, as note types that keep
    // everything in their attributes (web view) have nothing else to return.
    if (noteDef.content !== undefined) {
        note.getContent = () => {
            if (noteDef.isProtected) return undefined;
            return noteDef.content;
        };
    }

    // Handle attachments.
    if (noteDef.attachments) {
        for (const attachmentDef of noteDef.attachments) {
            new SAttachment([
                attachmentDef.id ?? utils.randomString(12),
                note.noteId,
                attachmentDef.role ?? "file",
                attachmentDef.mime ?? "application/blob",
                attachmentDef.title ?? "New attachment",
                blobId,
                new Date().toUTCString(),   // utcDateModified
            ]);
        }
    }

    // Handle children. The SBranch constructor is what links the two notes, so getChildNotes()
    // and getVisibleChildNotes() only see a child once its branch exists.
    if (noteDef.children) {
        for (const childDef of noteDef.children) {
            const childNote = buildShareNote(childDef);

            new SBranch([
                utils.randomString(12),
                childNote.noteId,
                note.noteId,
                "",     // prefix
                "",     // isExpanded
                false   // utcDateModified
            ]);
        }
    }

    // Handle labels & relations
    let position = 0;
    for (const [ key, value ] of Object.entries(noteDef)) {
        const attributeId = utils.randomString(12);
        const name = key.substring(1);

        let attribute: SAttribute | null = null;
        if (key.startsWith("#")) {
            attribute = new SAttribute([
                attributeId,
                note.noteId,
                "label",
                name,
                value,
                false,   // isInheritable
                position // position
            ]);
        }

        if (key.startsWith("~")) {
            attribute = new SAttribute([
                attributeId,
                note.noteId,
                "relation",
                name,
                value,
                false,   // isInheritable
                position // position
            ]);
        }

        if (!attribute) {
            continue;
        }

        shaca.attributes[attributeId] = attribute;
        position++;
    }
    return note;
}
