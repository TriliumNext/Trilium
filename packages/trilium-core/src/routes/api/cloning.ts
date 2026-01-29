import type { Request } from "express";
import cloningService from "../../services/cloning.js";

function cloneNoteToBranch(req: Request) {
    const { noteId, parentBranchId } = req.params;
    const { prefix } = req.body;

    return cloningService.cloneNoteToBranch(noteId, parentBranchId, prefix);
}

function cloneNoteToParentNote(req: Request) {
    const { noteId, parentNoteId } = req.params;
    const { prefix } = req.body;

    return cloningService.cloneNoteToParentNote(noteId, parentNoteId, prefix);
}

function cloneNoteAfter(req: Request) {
    const { noteId, afterBranchId } = req.params;

    return cloningService.cloneNoteAfter(noteId, afterBranchId);
}

function toggleNoteInParent(req: Request) {
    const { noteId, parentNoteId, present } = req.params;

    return cloningService.toggleNoteInParent(present === "true", noteId, parentNoteId);
}

export default {
    cloneNoteToBranch,
    cloneNoteToParentNote,
    cloneNoteAfter,
    toggleNoteInParent
};
