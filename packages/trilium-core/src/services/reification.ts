import {
    buildReificationTitle,
    formatReificationDefinition,
    formatReificationFormula,
    isReificationStructuralName,
    nextSelfReificationTitle,
    parseReificationDefinition,
    REIFICATION_BINDING,
    REIFICATION_GENERATED_TITLE,
    REIFICATION_INSTANCE,
    REIFICATION_KIND,
    REIFICATION_LITERAL,
    REIFICATION_OBJECT,
    REIFICATION_OF,
    REIFICATION_OF_PREDICATE,
    REIFICATION_PATTERN,
    REIFICATION_PREDICATE,
    REIFICATION_ROOT_ID,
    REIFICATION_SUBJECT,
    SELF_REIFICATION_GENERATED_TITLE,
    SELF_REIFICATION_OF
} from "@triliumnext/commons";
import type { ReificationDefinition, ReificationExpr, RelationMapReification } from "@triliumnext/commons";
import { t } from "i18next";

import becca from "../becca/becca.js";
import BAttribute, { isDefinitionName } from "../becca/entities/battribute.js";
import type BNote from "../becca/entities/bnote.js";
import { NotFoundError, ValidationError } from "../errors.js";
import attributeService from "./attributes.js";
import eventService from "./events.js";
import hiddenSubtreeService from "./hidden_subtree.js";
import noteService from "./notes.js";
import specialNotesService from "./special_notes.js";
import dateUtils from "./utils/date.js";

/**
 * A reification is a note that stands for one attribute row.
 *
 * The attribute stays what it was. The note is created only when something asks
 * for it, and it is filed under `_reifications` so the notes a person keeps are
 * unchanged. Other relations target that note, which is how a relation points
 * at a relation.
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

    const parent = ensureReificationRoot();
    const { note } = noteService.createNewNote({
        parentNoteId: parent.noteId,
        title: titleFor(attribute),
        type: "text",
        content: "",
        ignoreForbiddenParents: true
    });
    applyProjection(note, attribute);
    return { note, created: true };
}

export function isReificationNote(note: BNote): boolean {
    return !!note.getOwnedLabelValue(REIFICATION_OF);
}

/** The note that talks about `noteId`, one level up, if one has been made. */
export function findSelfReification(noteId: string): BNote | null {
    for (const attr of becca.findAttributes("label", SELF_REIFICATION_OF)) {
        if (attr.isDeleted || attr.value !== noteId) {
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
 * The note that talks about `noteId`. Created in the inbox the first time,
 * and opened again after that. Its title is the source title one level up.
 */
export function selfReifyNote(noteId: string): { note: BNote; created: boolean } {
    const source = becca.getNote(noteId);
    if (!source || source.isDeleted) {
        throw new NotFoundError(`Note '${noteId}' was not found.`);
    }
    const existing = findSelfReification(noteId);
    if (existing) {
        return { note: existing, created: false };
    }

    const title = nextSelfReificationTitle(source.getTitleOrProtected());
    const { note } = noteService.createNewNote({
        parentNoteId: specialNotesService.getInboxNote(dateUtils.localNowDate()).noteId,
        title,
        type: "text",
        content: ""
    });
    note.setLabel(SELF_REIFICATION_OF, noteId);
    note.setLabel(SELF_REIFICATION_GENERATED_TITLE, title);
    if (!note.getOwnedLabelValue("iconClass")) {
        note.setLabel("iconClass", "bx bx-chevrons-up");
    }
    return { note, created: true };
}

/**
 * Stores `patternText` on the concept of the name it defines.
 * A name that has a formula is sugar. A name that does not is an atom.
 */
export function defineReification(patternText: string, predicate?: string): { note: BNote; pattern: string } {
    const parsed = parseReificationDefinition(patternText);
    if (!parsed) {
        throw new ValidationError(`'${patternText}' is not a formula.`);
    }
    if (predicate && parsed.name !== predicate) {
        throw new ValidationError(`The formula must define '${predicate}'.`);
    }
    const unknown = unknownPlace(parsed);
    if (unknown) {
        throw new ValidationError(`'${unknown}' is not a place in this formula.`);
    }
    const wide = nonBinaryCall(parsed);
    if (wide) {
        throw new ValidationError(`'${wide}' is a relation, so it takes two notes.`);
    }
    assertPredicateName(parsed.name);
    const pattern = formatReificationDefinition(parsed);
    const concept = findPredicateConcept(parsed.name) ?? createPredicateConcept(parsed.name).note;
    setLabel(concept, REIFICATION_PATTERN, pattern);
    return { note: concept, pattern };
}

/**
 * Fills the formula of `predicate`.
 * A call is the relation `R(A, B)`, whether or not that name has a formula of its own.
 * A place left out stays empty. The same places filled again return the note already made for them.
 */
export function expandReification(predicate: string, notes?: Record<string, string>): { note: BNote } {
    const definition = requireDefinition(predicate);
    return { note: expandDefinition(definition, notes ?? {}) };
}

/** Reads the formula again and creates the terms the filled places now allow. */
export function refreshReificationInstance(noteId: string): {
    note: BNote;
    predicate: string;
    places: ReificationPlaceView[];
} {
    const { note, predicate } = requireInstance(noteId);
    const definition = requireDefinition(predicate);
    const bound = readBinding(note, definition);
    applyFormula(note, definition, bound);
    return { note, predicate, places: describePlaces(definition, bound) };
}

/** Fills one empty place of a formula note and creates the terms that place now makes possible. */
export function specifyReificationPlace(noteId: string, name: string, targetNoteId: string): {
    note: BNote;
    places: ReificationPlaceView[];
} {
    if (!targetNoteId) {
        throw new ValidationError("Choose a note for this place.");
    }
    const { note, predicate } = requireInstance(noteId);
    const definition = requireDefinition(predicate);
    if (!definition.params.includes(name)) {
        throw new ValidationError(`'${name}' is not a place in this formula.`);
    }
    const bound = readBinding(note, definition);
    bound.set(name, requireLiveNote(targetNoteId));
    applyFormula(note, definition, bound);
    return { note, places: describePlaces(definition, bound) };
}

export interface ReificationPlaceView {
    name: string;
    noteId: string | null;
    title: string | null;
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
 * Notes already used as the object of `predicate`.
 * Offered only once the relation name is a concept. Without that concept the
 * name has no choices of its own.
 */
export function listPredicateOptions(predicate: string): { noteId: string; title: string }[] {
    if (!findPredicateConcept(predicate)) {
        return [];
    }

    const options: { noteId: string; title: string }[] = [];
    const seen = new Set<string>();
    for (const attr of becca.findAttributes("relation", predicate)) {
        if (attr.isDeleted || !attr.value || seen.has(attr.value)) {
            continue;
        }
        const note = becca.getNote(attr.value);
        if (!note || note.isDeleted) {
            continue;
        }
        seen.add(note.noteId);
        options.push({ noteId: note.noteId, title: note.getTitleOrProtected() });
    }
    options.sort((a, b) => a.title.localeCompare(b.title));
    return options;
}

/**
 * Turns a label into a relation by giving it a note for its object.
 * With no `noteId`, that note is created in the inbox and titled with the label's text.
 */
export function specifyObject(
    attributeId: string,
    noteId?: string
): { note: BNote; attributeId: string; created: boolean } {
    const attribute = requireConvertible(attributeId);
    if (attribute.type !== "label") {
        throw new ValidationError(`Attribute '${attribute.name}' is already a relation.`);
    }

    let created = false;
    let objectNote: BNote | null;
    if (noteId) {
        objectNote = becca.getNote(noteId);
        if (!objectNote || objectNote.isDeleted) {
            throw new NotFoundError(`Note '${noteId}' was not found.`);
        }
    } else {
        const title = attribute.value.trim() || attribute.name;
        objectNote = noteService.createNewNote({
            parentNoteId: specialNotesService.getInboxNote(dateUtils.localNowDate()).noteId,
            title,
            type: "text",
            content: ""
        }).note;
        created = true;
    }

    const next = attribute.createClone("relation", attribute.name, objectNote.noteId, attribute.isInheritable);
    next.save();
    retarget(attribute, next);
    attribute.markAsDeleted();
    return { note: objectNote, attributeId: next.attributeId, created };
}

/**
 * Turns a relation back into a label. The label's text is the title of the note
 * that was the object, which is left where it is.
 */
export function unspecifyObject(attributeId: string): { attributeId: string; value: string } {
    const attribute = requireConvertible(attributeId);
    if (attribute.type !== "relation") {
        throw new ValidationError(`Attribute '${attribute.name}' is already a label.`);
    }

    const target = attribute.value ? becca.getNote(attribute.value) : null;
    const value = target && !target.isDeleted ? target.getTitleOrProtected() : "";
    const next = attribute.createClone("label", attribute.name, value, attribute.isInheritable);
    next.save();
    retarget(attribute, next);
    attribute.markAsDeleted();
    return { attributeId: next.attributeId, value };
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

function ensureReificationRoot(): BNote {
    const existing = becca.getNote(REIFICATION_ROOT_ID);
    if (existing && !existing.isDeleted) {
        return existing;
    }

    if (!becca.getNote("_hidden")) {
        hiddenSubtreeService.checkHiddenSubtree();
        const created = becca.getNote(REIFICATION_ROOT_ID);
        if (created && !created.isDeleted) {
            return created;
        }
    }

    const { note } = noteService.createNewNote({
        noteId: REIFICATION_ROOT_ID,
        parentNoteId: "_hidden",
        title: t("hidden-subtree.reifications-title"),
        type: "doc",
        content: "",
        ignoreForbiddenParents: true
    });
    return note;
}

function requireConvertible(attributeId: string): BAttribute {
    const attribute = becca.getAttribute(attributeId);
    if (!attribute || attribute.isDeleted) {
        throw new NotFoundError(`Attribute '${attributeId}' was not found.`);
    }
    if (isReificationStructuralName(attribute.name) || isDefinitionName(attribute.name)) {
        throw new ValidationError(`Attribute '${attribute.name}' cannot be converted.`);
    }
    return attribute;
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

/**
 * Writes the note's projection of `attribute`. A title the user has edited
 * (one that no longer equals the last generated title) is left alone.
 */
function applyProjection(note: BNote, attribute: BAttribute) {
    const generated = titleFor(attribute);
    const previous = note.getOwnedLabelValue(REIFICATION_GENERATED_TITLE);
    if ((previous === null || note.title === previous) && note.title !== generated) {
        note.title = generated;
        note.save();
        // A token whose object is this note repeats the title, so it has to be written again.
        refreshReificationsTouching(note.noteId);
    }

    setLabel(note, REIFICATION_OF, attribute.attributeId);
    setLabel(note, REIFICATION_KIND, attribute.type);
    setLabel(note, REIFICATION_PREDICATE, attribute.name);
    setLabel(note, REIFICATION_GENERATED_TITLE, generated);
    setRelation(note, REIFICATION_SUBJECT, attribute.noteId);

    if (attribute.type === "relation") {
        if (attribute.value) {
            setRelation(note, REIFICATION_OBJECT, attribute.value);
        }
        note.getOwnedLabel(REIFICATION_LITERAL)?.markAsDeleted();
    } else {
        setLabel(note, REIFICATION_LITERAL, attribute.value);
        note.getOwnedRelation(REIFICATION_OBJECT)?.markAsDeleted();
    }

    if (!note.getOwnedLabelValue("iconClass")) {
        note.addLabel("iconClass", "bx bx-git-commit");
    }
}

function requireDefinition(predicate: string): ReificationDefinition {
    const concept = findPredicateConcept(predicate);
    const text = concept?.getOwnedLabelValue(REIFICATION_PATTERN);
    const parsed = text ? parseReificationDefinition(text) : null;
    if (!concept || !parsed || parsed.name !== predicate) {
        throw new ValidationError(`'${predicate}' has no formula.`);
    }
    return parsed;
}

function unknownPlace(definition: ReificationDefinition): string | null {
    const params = new Set(definition.params);
    function walk(expr: ReificationExpr): string | null {
        if (!expr.args) {
            return params.has(expr.name) ? null : expr.name;
        }
        for (const arg of expr.args) {
            const unknown = walk(arg);
            if (unknown) {
                return unknown;
            }
        }
        return null;
    }
    for (const term of definition.terms) {
        const unknown = walk(term);
        if (unknown) {
            return unknown;
        }
    }
    return null;
}

/** A call on the right is a relation, which has two notes. A wider call is refused. */
function nonBinaryCall(definition: ReificationDefinition): string | null {
    function walk(expr: ReificationExpr): string | null {
        if (!expr.args) {
            return null;
        }
        if (expr.args.length !== 2) {
            return expr.name;
        }
        for (const arg of expr.args) {
            const wide = walk(arg);
            if (wide) {
                return wide;
            }
        }
        return null;
    }
    for (const term of definition.terms) {
        const wide = walk(term);
        if (wide) {
            return wide;
        }
    }
    return null;
}

function expandDefinition(definition: ReificationDefinition, given: Record<string, string>): BNote {
    const bound = new Map<string, BNote | null>();
    for (const name of definition.params) {
        const id = given[name];
        bound.set(name, id ? requireLiveNote(id) : null);
    }
    const key = formatBinding(definition.params, bound);
    const existing = findInstance(definition.name, key);
    if (existing) {
        applyFormula(existing, definition, bound);
        return existing;
    }
    const { note: instance } = noteService.createNewNote({
        parentNoteId: specialNotesService.getInboxNote(dateUtils.localNowDate()).noteId,
        title: definition.name,
        type: "text",
        content: ""
    });
    applyFormula(instance, definition, bound);
    return instance;
}

function applyFormula(
    instance: BNote,
    definition: ReificationDefinition,
    bound: Map<string, BNote | null>
) {
    const nextTitle = formulaTitle(definition, bound);
    const previous = instance.getOwnedLabelValue(REIFICATION_GENERATED_TITLE);
    if ((previous === null || instance.title === previous) && instance.title !== nextTitle) {
        instance.title = nextTitle;
        instance.save();
    }
    setLabel(instance, REIFICATION_GENERATED_TITLE, nextTitle);
    setLabel(instance, REIFICATION_INSTANCE, definition.name);
    setLabel(instance, REIFICATION_BINDING, formatBinding(definition.params, bound));
    if (!instance.getOwnedLabelValue("iconClass")) {
        instance.setLabel("iconClass", "bx bx-sitemap");
    }
    for (const name of definition.params) {
        const note = bound.get(name);
        if (note) {
            placeUnder(instance, note);
        }
    }
    for (const term of definition.terms) {
        const produced = evalExpr(term, bound);
        if (produced) {
            placeUnder(instance, produced);
        }
    }
}

function formulaTitle(definition: ReificationDefinition, bound: Map<string, BNote | null>): string {
    const args: string[] = [];
    for (const name of definition.params) {
        const note = bound.get(name);
        args.push(note ? note.getTitleOrProtected() : name);
    }
    return formatReificationFormula(definition.name, args);
}

function formatBinding(params: string[], bound: Map<string, BNote | null>): string {
    const parts: string[] = [];
    for (const name of params) {
        parts.push(`${name}=${bound.get(name)?.noteId ?? ""}`);
    }
    return parts.join(";");
}

function readBinding(
    instance: BNote,
    definition: ReificationDefinition
): Map<string, BNote | null> {
    const raw = instance.getOwnedLabelValue(REIFICATION_BINDING) ?? "";
    const bound = new Map<string, BNote | null>();
    if (raw.includes("=")) {
        const parsed = new Map<string, string>();
        for (const part of raw.split(";")) {
            const eq = part.indexOf("=");
            if (eq > 0) {
                parsed.set(part.slice(0, eq), part.slice(eq + 1));
            }
        }
        for (const name of definition.params) {
            bound.set(name, liveOrNull(parsed.get(name) ?? ""));
        }
        return bound;
    }
    const ids = raw ? raw.split(",") : [];
    for (const [index, name] of definition.params.entries()) {
        bound.set(name, liveOrNull(ids[index] ?? ""));
    }
    return bound;
}

function describePlaces(
    definition: ReificationDefinition,
    bound: Map<string, BNote | null>
): ReificationPlaceView[] {
    const places: ReificationPlaceView[] = [];
    for (const name of definition.params) {
        const note = bound.get(name);
        places.push({
            name,
            noteId: note?.noteId ?? null,
            title: note ? note.getTitleOrProtected() : null
        });
    }
    return places;
}

function requireInstance(noteId: string): { note: BNote; predicate: string } {
    const note = requireLiveNote(noteId);
    const predicate = note.getOwnedLabelValue(REIFICATION_INSTANCE);
    if (!predicate) {
        throw new ValidationError(`Note '${noteId}' is not a filled formula.`);
    }
    return { note, predicate };
}

function evalExpr(expr: ReificationExpr, scope: Map<string, BNote | null>): BNote | null {
    let base: BNote | null;
    if (expr.args) {
        const args: BNote[] = [];
        for (const arg of expr.args) {
            const value = evalExpr(arg, scope);
            if (!value) {
                return null;
            }
            args.push(value);
        }
        base = produce(expr.name, args);
    } else {
        base = scope.get(expr.name) ?? null;
    }
    if (!base) {
        return null;
    }
    return climb(base, expr.level);
}

function produce(name: string, args: BNote[]): BNote {
    if (args.length !== 2) {
        throw new ValidationError(`'${name}' is a relation, so it takes two notes.`);
    }
    return reifyBinary(name, args[0], args[1]);
}

function reifyBinary(name: string, source: BNote, target: BNote): BNote {
    if (isReificationStructuralName(name)) {
        throw new ValidationError(`'${name}' cannot be a relation in a formula.`);
    }
    const existing = source.getOwnedRelations(name).find((relation) => !relation.isDeleted && relation.value === target.noteId);
    const relation = existing ?? attributeService.createRelation(source.noteId, name, target.noteId);
    return reifyAttribute(relation.attributeId).note;
}

function climb(note: BNote, level: number): BNote {
    let current = note;
    for (let step = 0; step < level; step++) {
        current = selfReifyNote(current.noteId).note;
    }
    return current;
}

function findInstance(predicate: string, key: string): BNote | null {
    for (const attr of becca.findAttributes("label", REIFICATION_INSTANCE)) {
        if (attr.isDeleted || attr.value !== predicate) {
            continue;
        }
        const note = becca.getNote(attr.noteId);
        if (!note || note.isDeleted) {
            continue;
        }
        if (note.getOwnedLabelValue(REIFICATION_BINDING) === key) {
            return note;
        }
    }
    return null;
}

function liveOrNull(noteId: string): BNote | null {
    if (!noteId) {
        return null;
    }
    const note = becca.getNote(noteId);
    if (!note || note.isDeleted) {
        return null;
    }
    return note;
}

function requireLiveNote(noteId: string): BNote {
    const note = becca.getNote(noteId);
    if (!note || note.isDeleted) {
        throw new NotFoundError(`Note '${noteId}' was not found.`);
    }
    return note;
}

function placeUnder(parent: BNote, child: BNote) {
    if (child.noteId === parent.noteId) {
        return;
    }
    const branches = child.getParentBranches().filter((item) => !item.isDeleted);
    if (branches.some((item) => item.parentNoteId === parent.noteId)) {
        return;
    }
    const branch = branches[0];
    if (!branch) {
        return;
    }
    branch.createClone(parent.noteId).save();
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

function refreshSelfReificationTitle(source: BNote) {
    const meta = findSelfReification(source.noteId);
    if (!meta || refreshing.has(meta.noteId)) {
        return;
    }
    const generated = nextSelfReificationTitle(source.getTitleOrProtected());
    const previous = meta.getOwnedLabelValue(SELF_REIFICATION_GENERATED_TITLE);
    if ((previous !== null && meta.title !== previous) || meta.title === generated) {
        return;
    }
    refreshing.add(meta.noteId);
    try {
        meta.title = generated;
        meta.save();
        setLabel(meta, SELF_REIFICATION_GENERATED_TITLE, generated);
    } finally {
        refreshing.delete(meta.noteId);
    }
    noteService.triggerNoteTitleChanged(meta);
    refreshSelfReificationTitle(meta);
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
    refreshSelfReificationTitle(note);
});

export default {
    reifyAttribute,
    findReificationNote,
    listReificationsIncluding,
    isReificationNote,
    findSelfReification,
    selfReifyNote,
    defineReification,
    expandReification,
    refreshReificationInstance,
    specifyReificationPlace,
    findPredicateConcept,
    listPredicateOptions,
    specifyObject,
    unspecifyObject,
    createPredicateConcept,
    connectPredicateConcept,
    retarget,
    deleteReification,
    indexByAttributeId,
    toRelationMapReification,
    isMapSuppressedRelation
};
