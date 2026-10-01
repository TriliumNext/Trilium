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

function getPredicateConcept(req: Request<{ predicate: string }>) {
    const note = reificationService.findPredicateConcept(req.params.predicate);
    return {
        noteId: note?.noteId ?? null,
        title: note ? note.getTitleOrProtected() : null
    };
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
    getPredicateConcept,
    savePredicateConcept
};
