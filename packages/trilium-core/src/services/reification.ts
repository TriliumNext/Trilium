import {
    buildReificationTitle,
    isReificationStructuralName,
    REIFICATION_GENERATED_TITLE,
    REIFICATION_KIND,
    REIFICATION_LITERAL,
    REIFICATION_OBJECT,
    REIFICATION_OF,
    REIFICATION_OF_PREDICATE,
    REIFICATION_PREDICATE,
    REIFICATION_SUBJECT
} from "@triliumnext/commons";
import type { RelationMapReification } from "@triliumnext/commons";

import becca from "../becca/becca.js";
import BAttribute from "../becca/entities/battribute.js";
import type BNote from "../becca/entities/bnote.js";
import { NotFoundError, ValidationError } from "../errors.js";
import eventService from "./events.js";
import noteService from "./notes.js";
import protectedSessionService from "./protected_session.js";
import specialNotesService from "./special_notes.js";
import dateUtils from "./utils/date.js";

/**
 * A reification is a note that stands for one attribute row.
 *
 * The attribute stays what it was. The note is created only when something asks
 * for it, and it is filed in the inbox. Other relations target that note, which
 * is how a relation points at a relation.
 */

const deleting = new Set<string>();
const refreshing = new Set<string>();

export function reifyAttribute(attributeId: string): { note: BNote; created: boolean } {
    const attribute = becca.getAttribute(attributeId);
    if (!attribute || attribute.isDeleted) {
        throw new NotFoundError(`Attribute '${attributeId}' was not found.`);
    }
    if (isReificationStructuralName(attribute.name)) {
        throw new ValidationError(`Attribute '${attribute.name}' is part of a reification and cannot itself be reified.`);
    }

    const existing = findReificationNote(attributeId);
    if (existing) {
        applyProjection(existing, attribute);
        return { note: existing, created: false };
    }

    const protect = endpointIsProtected(attribute);
    if (protect && !protectedSessionService.isProtectedSessionAvailable()) {
        throw new ValidationError("Reifying a protected note requires an active protected session.");
    }
    const { note } = noteService.createNewNote({
        parentNoteId: specialNotesService.getInboxNote(dateUtils.localNowDate()).noteId,
        title: titleFor(attribute),
        type: "text",
        content: "",
        isProtected: protect
    });
    applyProjection(note, attribute);
    return { note, created: true };
}

export function isReificationNote(note: BNote): boolean {
    return !!note.getOwnedLabelValue(REIFICATION_OF);
}

/**
 * The note that is the relation name itself, if one has been made.
 * `loves(John, Mary)` is one instance. This note is loves.
 */
export function findPredicateConcept(predicate: string): BNote | null {
    for (const attr of becca.findAttributes("label", REIFICATION_OF_PREDICATE)) {
        if (attr.isDeleted || attr.value !== predicate) {
            continue;
        }
        const note = becca.getNote(attr.noteId);
        if (!note || note.isDeleted) {
            continue;
        }
        return note;
    }
    return null;
}

/** Files a new note in the inbox and makes it the concept of `predicate`. */
export function createPredicateConcept(predicate: string): { note: BNote; created: boolean } {
    assertPredicateName(predicate);
    const existing = findPredicateConcept(predicate);
    if (existing) {
        return { note: existing, created: false };
    }

    const { note } = noteService.createNewNote({
        parentNoteId: specialNotesService.getInboxNote(dateUtils.localNowDate()).noteId,
        title: predicate,
        type: "text",
        content: ""
    });
    note.setLabel(REIFICATION_OF_PREDICATE, predicate);
    if (!note.getOwnedLabelValue("iconClass")) {
        note.setLabel("iconClass", "bx bx-cube");
    }
    return { note, created: true };
}

/**
 * Makes an existing note the concept of `predicate`.
 * A concept that already exists is left where it is.
 */
export function connectPredicateConcept(predicate: string, noteId: string): { note: BNote; created: boolean } {
    assertPredicateName(predicate);
    const existing = findPredicateConcept(predicate);
    if (existing) {
        return { note: existing, created: false };
    }

    const note = becca.getNote(noteId);
    if (!note || note.isDeleted) {
        throw new NotFoundError(`Note '${noteId}' was not found.`);
    }
    const current = note.getOwnedLabelValue(REIFICATION_OF_PREDICATE);
    if (current && current !== predicate) {
        throw new ValidationError(`'${note.getTitleOrProtected()}' is already the concept of '${current}'.`);
    }
    note.setLabel(REIFICATION_OF_PREDICATE, predicate);
    return { note, created: true };
}

export interface ReificationListing {
    noteId: string;
    title: string;
    attributeId: string;
    /** This listing is the note for the attribute that was asked about. */
    direct: boolean;
}

/**
 * The note for this attribute, plus every reification that has it somewhere in
 * its arguments. A relation of a relation shows up here, so it can be opened
 * without being drawn as another circle on the map.
 */
export function listReificationsIncluding(attributeId: string): ReificationListing[] {
    const attribute = becca.getAttribute(attributeId);
    if (!attribute || attribute.isDeleted) {
        throw new NotFoundError(`Attribute '${attributeId}' was not found.`);
    }

    const rows = new Map<string, { note: BNote; attributeId: string; subjectNoteId: string; objectNoteId: string | null }>();
    for (const attr of becca.findAttributes("label", REIFICATION_OF)) {
        if (attr.isDeleted || !attr.value || rows.has(attr.noteId)) {
            continue;
        }
        const note = becca.getNote(attr.noteId);
        if (!note || note.isDeleted) {
            continue;
        }
        const subject = note.getOwnedRelation(REIFICATION_SUBJECT);
        const object = note.getOwnedRelation(REIFICATION_OBJECT);
        rows.set(note.noteId, {
            note,
            attributeId: attr.value,
            subjectNoteId: subject?.value ?? "",
            objectNoteId: object?.value ?? null
        });
    }

    const included = new Map<string, boolean>();
    const includes = (noteId: string): boolean => {
        const known = included.get(noteId);
        if (known !== undefined) {
            return known;
        }
        const row = rows.get(noteId);
        if (!row) {
            included.set(noteId, false);
            return false;
        }
        included.set(noteId, false);
        const yes = row.attributeId === attributeId
            || (!!row.subjectNoteId && includes(row.subjectNoteId))
            || (!!row.objectNoteId && includes(row.objectNoteId));
        included.set(noteId, yes);
        return yes;
    };

    const items: ReificationListing[] = [];
    for (const row of rows.values()) {
        if (!includes(row.note.noteId)) {
            continue;
        }
        items.push({
            noteId: row.note.noteId,
            title: row.note.getTitleOrProtected(),
            attributeId: row.attributeId,
            direct: row.attributeId === attributeId
        });
    }
    items.sort((a, b) => Number(b.direct) - Number(a.direct) || a.title.localeCompare(b.title));
    return items;
}

export function findReificationNote(attributeId: string): BNote | null {
    for (const attr of becca.findAttributes("label", REIFICATION_OF)) {
        if (attr.isDeleted || attr.value !== attributeId) {
            continue;
        }
        const note = becca.getNote(attr.noteId);
        if (!note || note.isDeleted) {
            continue;
        }
        return note;
    }
    return null;
}

/**
 * Points an existing reification at the attribute that replaced `previous`.
 * Called before `previous` is deleted, so the delete does not take the note with it.
 */
export function retarget(previous: BAttribute, next: BAttribute) {
    const note = findReificationNote(previous.attributeId);
    if (!note) {
        return;
    }
    setLabel(note, REIFICATION_OF, next.attributeId);
    applyProjection(note, next);
}

export function deleteReification(attributeId: string) {
    const note = findReificationNote(attributeId);
    if (!note) {
        return;
    }
    removeReification(note);
}

export function indexByAttributeId(): Map<string, BNote> {
    const map = new Map<string, BNote>();
    for (const attr of becca.findAttributes("label", REIFICATION_OF)) {
        if (attr.isDeleted || !attr.value || map.has(attr.value)) {
            continue;
        }
        const note = becca.getNote(attr.noteId);
        if (!note || note.isDeleted) {
            continue;
        }
        map.set(attr.value, note);
    }
    return map;
}

export function toRelationMapReification(note: BNote): RelationMapReification | null {
    const attributeId = note.getOwnedLabelValue(REIFICATION_OF);
    const kind = note.getOwnedLabelValue(REIFICATION_KIND);
    const subject = note.getOwnedRelation(REIFICATION_SUBJECT);
    if (!attributeId || (kind !== "relation" && kind !== "label") || !subject?.value) {
        return null;
    }
    const object = note.getOwnedRelation(REIFICATION_OBJECT);
    return {
        noteId: note.noteId,
        attributeId,
        title: note.getTitleOrProtected(),
        kind,
        subjectNoteId: subject.value,
        objectNoteId: object?.value ?? null
    };
}

/** Subject and object links repeat the arrow the map already draws. */
export function isMapSuppressedRelation(name: string): boolean {
    return name === REIFICATION_SUBJECT || name === REIFICATION_OBJECT;
}

function assertPredicateName(predicate: string) {
    if (!predicate.trim() || isReificationStructuralName(predicate)) {
        throw new ValidationError(`'${predicate}' cannot be a concept.`);
    }
}

function titleFor(attribute: BAttribute): string {
    const subjectTitle = attribute.getNote().getTitleOrProtected();
    if (attribute.type === "relation") {
        const target = attribute.getTargetNote();
        return buildReificationTitle({
            subjectTitle,
            predicate: attribute.name,
            objectTitle: target?.getTitleOrProtected()
        });
    }
    return buildReificationTitle({
        subjectTitle,
        predicate: attribute.name,
        objectTitle: attribute.value
    });
}

/** True when a title or label value copied onto the reification would otherwise stay readable. */
function endpointIsProtected(attribute: BAttribute): boolean {
    if (attribute.getNote().isProtected) {
        return true;
    }
    return attribute.type === "relation" && attribute.getTargetNote()?.isProtected === true;
}

/**
 * A short marker for the last generated title.
 * The title itself is encrypted with the note. This label is not, so it cannot hold the sentence.
 */
function titleFingerprint(title: string): string {
    let hash = 5381;
    for (let i = 0; i < title.length; i++) {
        hash = ((hash << 5) + hash) ^ title.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
}

/**
 * Writes the note's projection of `attribute`. A title the user has edited
 * (one that no longer equals the last generated title) is left alone.
 */
function applyProjection(note: BNote, attribute: BAttribute) {
    const protect = endpointIsProtected(attribute);
    if (note.isProtected !== protect) {
        if (!protectedSessionService.isProtectedSessionAvailable()) {
            return;
        }
        const content = note.getContent();
        note.isProtected = protect;
        note.isDecrypted = true;
        note.setContent(typeof content === "string" || content instanceof Uint8Array ? content : "", { forceSave: true });
    }
    // Outside a protected session the title in memory is ciphertext, or "[protected]".
    if (!note.isContentAvailable()) {
        return;
    }

    const generated = titleFor(attribute);
    const previous = note.getOwnedLabelValue(REIFICATION_GENERATED_TITLE);
    const stillGenerated = previous === null
        || note.title === previous
        || (note.isProtected && previous === titleFingerprint(note.title));
    if (stillGenerated && note.title !== generated) {
        note.title = generated;
        note.save();
        // A token whose object is this note repeats the title, so it has to be written again.
        refreshReificationsTouching(note.noteId);
    }

    setLabel(note, REIFICATION_OF, attribute.attributeId);
    setLabel(note, REIFICATION_KIND, attribute.type);
    setLabel(note, REIFICATION_PREDICATE, attribute.name);
    setLabel(note, REIFICATION_GENERATED_TITLE, note.isProtected ? titleFingerprint(generated) : generated);
    setRelation(note, REIFICATION_SUBJECT, attribute.noteId);

    if (attribute.type === "relation") {
        if (attribute.value) {
            setRelation(note, REIFICATION_OBJECT, attribute.value);
        }
        note.getOwnedLabel(REIFICATION_LITERAL)?.markAsDeleted();
    } else if (note.isProtected) {
        note.getOwnedLabel(REIFICATION_LITERAL)?.markAsDeleted();
        note.getOwnedRelation(REIFICATION_OBJECT)?.markAsDeleted();
    } else {
        setLabel(note, REIFICATION_LITERAL, attribute.value);
        note.getOwnedRelation(REIFICATION_OBJECT)?.markAsDeleted();
    }

    if (!note.getOwnedLabelValue("iconClass")) {
        note.addLabel("iconClass", "bx bx-git-commit");
    }
}

function setLabel(note: BNote, name: string, value: string) {
    const existing = note.getOwnedLabel(name);
    if (existing) {
        if (existing.value === value) {
            return;
        }
        existing.value = value;
        existing.save();
        return;
    }
    note.addLabel(name, value);
}

function setRelation(note: BNote, name: string, targetNoteId: string) {
    const existing = note.getOwnedRelation(name);
    if (existing) {
        if (existing.value === targetNoteId) {
            return;
        }
        existing.value = targetNoteId;
        existing.save();
        return;
    }
    note.addRelation(name, targetNoteId);
}

function removeReification(note: BNote) {
    if (deleting.has(note.noteId) || note.isDeleted) {
        return;
    }
    deleting.add(note.noteId);
    try {
        note.deleteNote();
    } finally {
        deleting.delete(note.noteId);
    }
}

function refreshReificationsTouching(noteId: string) {
    if (refreshing.has(noteId)) {
        return;
    }
    refreshing.add(noteId);
    try {
        for (const attr of becca.findAttributes("label", REIFICATION_OF)) {
            if (attr.isDeleted || !attr.value) {
                continue;
            }
            const token = becca.getNote(attr.noteId);
            if (!token || token.isDeleted) {
                continue;
            }
            const subject = token.getOwnedRelation(REIFICATION_SUBJECT);
            const object = token.getOwnedRelation(REIFICATION_OBJECT);
            if (subject?.value !== noteId && object?.value !== noteId) {
                continue;
            }
            const attribute = becca.getAttribute(attr.value);
            if (!attribute || attribute.isDeleted) {
                continue;
            }
            applyProjection(token, attribute);
        }
    } finally {
        refreshing.delete(noteId);
    }
}

eventService.subscribe(eventService.ENTITY_CHANGED, ({ entityName, entity }) => {
    if (entityName !== "attributes") {
        return;
    }
    const attribute = entity as BAttribute;
    if (isReificationStructuralName(attribute.name) || attribute.isDeleted) {
        return;
    }
    const token = findReificationNote(attribute.attributeId);
    if (!token) {
        return;
    }
    applyProjection(token, attribute);
});

eventService.subscribe(eventService.ENTITY_DELETED, ({ entityName, entity }) => {
    if (entityName !== "attributes") {
        return;
    }
    const attribute = entity as BAttribute;
    if (isReificationStructuralName(attribute.name)) {
        return;
    }
    const token = findReificationNote(attribute.attributeId);
    if (!token) {
        return;
    }
    removeReification(token);
});

eventService.subscribe(eventService.NOTE_TITLE_CHANGED, (note: BNote) => {
    refreshReificationsTouching(note.noteId);
});

export default {
    reifyAttribute,
    findReificationNote,
    listReificationsIncluding,
    isReificationNote,
    findPredicateConcept,
    createPredicateConcept,
    connectPredicateConcept,
    retarget,
    deleteReification,
    indexByAttributeId,
    toRelationMapReification,
    isMapSuppressedRelation
};
