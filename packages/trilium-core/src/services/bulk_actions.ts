import { ActionHandlers, BulkAction, BulkActionData } from "@triliumnext/commons";
import branchService from "./branches";
import eraseService from "./erase.js";

import becca from "../becca/becca.js";
import type BNote from "../becca/entities/bnote.js";
import cloningService from "./cloning.js";
import { randomString } from "./utils/index.js";
import { getLog } from "./log";

type ActionHandler<T> = (action: T, note: BNote) => void;

type ActionHandlerMap = {
    [K in keyof ActionHandlers]: ActionHandler<BulkActionData<K>>;
};

const ACTION_HANDLERS: ActionHandlerMap = {
    addLabel: (action, note) => {
        note.addLabel(action.labelName, action.labelValue);
    },
    addRelation: (action, note) => {
        note.addRelation(action.relationName, action.targetNoteId);
    },
    deleteNote: (action, note) => {
        const deleteId = `searchbulkaction-${randomString(10)}`;

        note.deleteNote(deleteId);
    },
    deleteRevisions: (action, note) => {
        const revisionIds = note
            .getRevisions()
            .map((rev) => rev.revisionId)
            .filter((rev) => !!rev) as string[];
        eraseService.eraseRevisions(revisionIds);
    },
    deleteLabel: (action, note) => {
        for (const label of note.getOwnedLabels(action.labelName)) {
            label.markAsDeleted();
        }
    },
    deleteRelation: (action, note) => {
        for (const relation of note.getOwnedRelations(action.relationName)) {
            relation.markAsDeleted();
        }
    },
    renameNote: (action, note) => {
        // "officially" injected value:
        // - note

        const newTitle = eval(`\`${action.newTitle}\``);

        if (note.title !== newTitle) {
            note.title = newTitle;
            note.save();
        }
    },
    renameLabel: (action, note) => {
        for (const label of note.getOwnedLabels(action.oldLabelName)) {
            // attribute name is immutable, renaming means delete old + create new
            const newLabel = label.createClone("label", action.newLabelName, label.value);

            newLabel.save();
            label.markAsDeleted();
        }
    },
    renameRelation: (action, note) => {
        for (const relation of note.getOwnedRelations(action.oldRelationName)) {
            // attribute name is immutable, renaming means delete old + create new
            const newRelation = relation.createClone("relation", action.newRelationName, relation.value);

            newRelation.save();
            relation.markAsDeleted();
        }
    },
    updateLabelValue: (action, note) => {
        for (const label of note.getOwnedLabels(action.labelName)) {
            label.value = action.labelValue;
            label.save();
        }
    },
    updateRelationTarget: (action, note) => {
        for (const relation of note.getOwnedRelations(action.relationName)) {
            relation.value = action.targetNoteId;
            relation.save();
        }
    },
    moveNote: (action, note) => {
        const targetParentNote = becca.getNote(action.targetParentNoteId);

        if (!targetParentNote) {
            getLog().info(`Cannot execute moveNote because note ${action.targetParentNoteId} doesn't exist.`);

            return;
        }

        let res;

        if (note.getParentBranches().length > 1) {
            res = cloningService.cloneNoteToParentNote(note.noteId, action.targetParentNoteId);
        } else {
            res = branchService.moveBranchToNote(note.getParentBranches()[0], action.targetParentNoteId);
        }

        if ("success" in res && !res.success) {
            getLog().info(`Moving/cloning note ${note.noteId} to ${action.targetParentNoteId} failed with error ${JSON.stringify(res)}`);
        }
    },
    executeScript: (action, note) => {
        if (!action.script || !action.script.trim()) {
            getLog().info("Ignoring executeScript since the script is empty.");
            return;
        }

        const scriptFunc = new Function("note", action.script);
        scriptFunc(note);

        note.save();
    }
} as const;

function getActions(note: BNote) {
    return note
        .getLabels("action")
        .map((actionLabel) => {
            let action;

            try {
                action = JSON.parse(actionLabel.value);
            } catch (e) {
                getLog().error(`Cannot parse '${actionLabel.value}' into search action, skipping.`);
                return null;
            }

            if (!(action.name in ACTION_HANDLERS)) {
                getLog().error(`Cannot find '${action.name}' search action handler, skipping.`);
                return null;
            }

            return action as BulkAction;
        })
        .filter((a) => !!a);
}

/**
 * Executes the bulk actions defined in the note against the provided search result note IDs.
 * @param note the note containing the bulk actions, read from the `action` label.
 * @param noteIds the IDs of the notes to apply the actions to.
 */
function executeActionsFromNote(note: BNote, noteIds: string[] | Set<string>) {
    const actions = getActions(note);
    return executeActions(actions, noteIds);
}

function executeActions(actions: BulkAction[], noteIds: string[] | Set<string>) {
    for (const resultNoteId of noteIds) {
        const resultNote = becca.getNote(resultNoteId);

        if (!resultNote) {
            continue;
        }

        for (const action of actions) {
            try {
                getLog().info(`Applying action handler to note ${resultNote.noteId}: ${JSON.stringify(action)}`);

                const handler = ACTION_HANDLERS[action.name] as (a: typeof action, n: BNote) => void;
                handler(action, resultNote);
            } catch (e: any) {
                getLog().error(`ExecuteScript search action failed with ${e.message}`);
            }
        }
    }
}

export default {
    executeActions,
    executeActionsFromNote
};
