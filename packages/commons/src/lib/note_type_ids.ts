import { ALLOWED_NOTE_TYPES, type NoteType } from "./rows.js";

/**
 * Naming what a note is made from, as one string.
 *
 * A feature that lets the reader choose what a new note will be has two kinds of answer to store: a
 * blank note type, and a note carrying `#template`. Both are written here as a single id, so that a
 * stored choice, a menu entry and a request all speak of it the same way.
 *
 * `type:<type>:<mime>` names a blank note type. The mime is part of it because a type alone is not
 * always enough: a Markdown note and a code note are both `code`, and only the mime tells them
 * apart. `template:<noteId>` names a note to be templated from.
 */
export type NoteTypeId = string;

/** What a {@link NoteTypeId} names, once read. */
export type NoteTypeSelection =
    | { kind: "type"; type: NoteType; mime?: string }
    | { kind: "template"; templateNoteId: string };

const TYPE_PREFIX = "type:";
const TEMPLATE_PREFIX = "template:";

/** Names a blank note type. An empty mime is written as such, so the id round-trips. */
export function buildNoteTypeId(type: NoteType, mime?: string): NoteTypeId {
    return `${TYPE_PREFIX}${type}:${mime ?? ""}`;
}

/** Names a note to be templated from. */
export function buildTemplateId(noteId: string): NoteTypeId {
    return `${TEMPLATE_PREFIX}${noteId}`;
}

export function isNoteTypeId(id: NoteTypeId) {
    return id.startsWith(TYPE_PREFIX);
}

export function isTemplateId(id: NoteTypeId) {
    return id.startsWith(TEMPLATE_PREFIX);
}

/**
 * Reads an id back, or answers with nothing where it names something this build does not know.
 *
 * A stored id outlives what it names: a note type can be dropped from the app and a template note
 * deleted, and neither is a reason to fail. The caller decides what to do with an id that resolves
 * to nothing, which is usually to leave it out of what it offers.
 */
export function parseNoteTypeId(id: NoteTypeId): NoteTypeSelection | undefined {
    if (isTemplateId(id)) {
        const noteId = id.slice(TEMPLATE_PREFIX.length);
        return noteId ? { kind: "template", templateNoteId: noteId } : undefined;
    }

    if (!isNoteTypeId(id)) {
        return undefined;
    }

    const rest = id.slice(TYPE_PREFIX.length);
    const separator = rest.indexOf(":");
    const type = separator < 0 ? rest : rest.slice(0, separator);
    const mime = separator < 0 ? "" : rest.slice(separator + 1);

    return (ALLOWED_NOTE_TYPES as readonly string[]).includes(type)
        ? { kind: "type", type: type as NoteType, mime: mime || undefined }
        : undefined;
}

/**
 * What creating a note from an id asks for, which is what `createNote` takes.
 *
 * A template answers with the note to template from; what type the new note ends up with is the
 * template's own, and the caller adds it where it has the template note to hand.
 */
export function resolveNoteType(id: NoteTypeId):
    { type?: NoteType; mime?: string; templateNoteId?: string } | undefined {
    const selection = parseNoteTypeId(id);
    if (!selection) {
        return undefined;
    }

    return selection.kind === "template"
        ? { templateNoteId: selection.templateNoteId }
        : { type: selection.type, mime: selection.mime };
}
