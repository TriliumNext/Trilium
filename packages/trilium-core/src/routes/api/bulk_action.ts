import type { Request } from "express";
import becca from "../../becca/becca.js";
import bulkActionService from "../../services/bulk_actions.js";

function execute(req: Request) {
    const { noteIds, includeDescendants, actions } = req.body;
    if (!Array.isArray(noteIds)) {
        throw new Error("noteIds must be an array");
    }

    const affectedNoteIds = getAffectedNoteIds(noteIds, includeDescendants);

    const bulkActionNote = becca.getNoteOrThrow("_bulkAction");

    if (actions && actions.length > 0) {
        for (const action of actions) {
            if (!action.name) {
                throw new Error("Action must have a name");
            }
        }
        bulkActionService.executeActions(actions, affectedNoteIds);
    } else {
        bulkActionService.executeActionsFromNote(bulkActionNote, affectedNoteIds);
    }
}

function getAffectedNoteCount(req: Request) {
    const { noteIds, includeDescendants } = req.body;

    const affectedNoteIds = getAffectedNoteIds(noteIds, includeDescendants);

    return {
        affectedNoteCount: affectedNoteIds.size
    };
}

function getAffectedNoteIds(noteIds: string[], includeDescendants: boolean) {
    const affectedNoteIds = new Set<string>();

    for (const noteId of noteIds) {
        const note = becca.getNote(noteId);

        if (!note) {
            continue;
        }

        affectedNoteIds.add(noteId);

        if (includeDescendants) {
            for (const descendantNoteId of note.getDescendantNoteIds()) {
                affectedNoteIds.add(descendantNoteId);
            }
        }
    }
    return affectedNoteIds;
}

export default {
    execute,
    getAffectedNoteCount
};
