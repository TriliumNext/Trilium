import { REIFICATION_PATTERN } from "@triliumnext/commons";

import type { Request } from "../../http_interface";
import reificationService from "../../services/reification.js";

function reifyAttribute(req: Request<{ attributeId: string }>) {
    const { note, created } = reificationService.reifyAttribute(req.params.attributeId);
    return {
        noteId: note.noteId,
        title: note.getTitleOrProtected(),
        created
    };
}

function getReification(req: Request<{ attributeId: string }>) {
    const note = reificationService.findReificationNote(req.params.attributeId);
    if (!note) {
        return;
    }
    return {
        noteId: note.noteId,
        title: note.getTitleOrProtected(),
        created: false
    };
}

function deleteReification(req: Request<{ attributeId: string }>) {
    reificationService.deleteReification(req.params.attributeId);
}

function listReifications(req: Request<{ attributeId: string }>) {
    return { items: reificationService.listReificationsIncluding(req.params.attributeId) };
}

function getSelfReification(req: Request<{ noteId: string }>) {
    const note = reificationService.findSelfReification(req.params.noteId);
    return {
        noteId: note?.noteId ?? null,
        title: note ? note.getTitleOrProtected() : null
    };
}

function saveSelfReification(req: Request<{ noteId: string }>) {
    const { note, created } = reificationService.selfReifyNote(req.params.noteId);
    return {
        noteId: note.noteId,
        title: note.getTitleOrProtected(),
        created
    };
}

function getReificationPattern(req: Request<{ predicate: string }>) {
    const concept = reificationService.findPredicateConcept(req.params.predicate);
    return { pattern: concept?.getOwnedLabelValue(REIFICATION_PATTERN) ?? null };
}

function saveReificationPattern(req: Request<{ predicate: string }>) {
    const pattern = typeof req.body?.pattern === "string" ? req.body.pattern : "";
    const result = reificationService.defineReification(pattern, req.params.predicate);
    return {
        noteId: result.note.noteId,
        title: result.note.getTitleOrProtected(),
        pattern: result.pattern
    };
}

function expandReificationPattern(req: Request<{ predicate: string }>) {
    const { note } = reificationService.expandReification(
        req.params.predicate,
        readPlaceNotes(req.body?.notes)
    );
    return {
        noteId: note.noteId,
        title: note.getTitleOrProtected()
    };
}

function refreshReificationPlaces(req: Request<{ noteId: string }>) {
    const result = reificationService.refreshReificationInstance(req.params.noteId);
    return {
        noteId: result.note.noteId,
        title: result.note.getTitleOrProtected(),
        predicate: result.predicate,
        places: result.places
    };
}

function specifyReificationPlace(req: Request<{ noteId: string; name: string }>) {
    const targetNoteId = typeof req.body?.noteId === "string" ? req.body.noteId : "";
    const result = reificationService.specifyReificationPlace(
        req.params.noteId,
        req.params.name,
        targetNoteId
    );
    return {
        noteId: result.note.noteId,
        title: result.note.getTitleOrProtected(),
        places: result.places
    };
}

function readPlaceNotes(raw: unknown): Record<string, string> {
    const notes: Record<string, string> = {};
    if (!raw || typeof raw !== "object") {
        return notes;
    }
    for (const [name, noteId] of Object.entries(raw)) {
        if (typeof noteId === "string" && noteId) {
            notes[name] = noteId;
        }
    }
    return notes;
}

function getPredicateConcept(req: Request<{ predicate: string }>) {
    const note = reificationService.findPredicateConcept(req.params.predicate);
    return {
        noteId: note?.noteId ?? null,
        title: note ? note.getTitleOrProtected() : null
    };
}

function getPredicateOptions(req: Request<{ predicate: string }>) {
    return { options: reificationService.listPredicateOptions(req.params.predicate) };
}

function specifyObject(req: Request<{ attributeId: string }>) {
    const noteId = typeof req.body?.noteId === "string" ? req.body.noteId : undefined;
    const result = reificationService.specifyObject(req.params.attributeId, noteId);
    return {
        noteId: result.note.noteId,
        title: result.note.getTitleOrProtected(),
        attributeId: result.attributeId,
        created: result.created
    };
}

function unspecifyObject(req: Request<{ attributeId: string }>) {
    return reificationService.unspecifyObject(req.params.attributeId);
}

function savePredicateConcept(req: Request<{ predicate: string }>) {
    const predicate = req.params.predicate;
    const noteId = typeof req.body?.noteId === "string" ? req.body.noteId : undefined;
    const result = noteId
        ? reificationService.connectPredicateConcept(predicate, noteId)
        : reificationService.createPredicateConcept(predicate);
    return {
        noteId: result.note.noteId,
        title: result.note.getTitleOrProtected(),
        created: result.created
    };
}

export default {
    reifyAttribute,
    getReification,
    deleteReification,
    listReifications,
    getSelfReification,
    saveSelfReification,
    getReificationPattern,
    saveReificationPattern,
    expandReificationPattern,
    refreshReificationPlaces,
    specifyReificationPlace,
    getPredicateConcept,
    getPredicateOptions,
    specifyObject,
    unspecifyObject,
    savePredicateConcept
};
