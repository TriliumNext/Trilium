import log from "./log.js";
import becca from "../becca/becca.js";
import cloningService from "./cloning.js";
import branchService from "./branches.js";
import { randomString } from "./utils.js";
import eraseService from "./erase.js";
import type BNote from "../becca/entities/bnote.js";
import { ActionHandlers, BulkAction, BulkActionData } from "@triliumnext/commons";
import { evaluateTemplate } from "./safe_template.js";
import { executeBundle } from "./script.js";
import { assertScriptingEnabled } from "./scripting_guard.js";

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
        // - note (the note being renamed)
        const newTitle = evaluateTemplate(action.newTitle, { note });

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
            log.info(`Cannot execute moveNote because note ${action.targetParentNoteId} doesn't exist.`);

            return;
        }

        let res;

        if (note.getParentBranches().length > 1) {
            res = cloningService.cloneNoteToParentNote(note.noteId, action.targetParentNoteId);
        } else {
            res = branchService.moveBranchToNote(note.getParentBranches()[0], action.targetParentNoteId);
        }

        if ("success" in res && !res.success) {
            log.info(`Moving/cloning note ${note.noteId} to ${action.targetParentNoteId} failed with error ${JSON.stringify(res)}`);
        }
    },
    executeScript: (action, note) => {
        assertScriptingEnabled();
        if (!action.script || !action.script.trim()) {
            log.info("Ignoring executeScript since the script is empty.");
            return;
        }

        // Route through the script service's executeBundle instead of raw
        // new Function() to get proper CLS context, logging, and error handling.
        // The preamble provides access to `note` and `api` as the UI documents.
        const noteId = note.noteId.replace(/[^a-zA-Z0-9_]/g, "");
        const preamble = `const api = apiContext.apis["${noteId}"] || {};\n` +
            `const note = apiContext.notes["${noteId}"];\n`;
        const scriptBody = `${preamble}${action.script}\nnote.save();`;

        executeBundle({
            note: note,
            script: scriptBody,
            html: "",
            allNotes: [note]
        });
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
                log.error(`Cannot parse '${actionLabel.value}' into search action, skipping.`);
                return null;
            }

            if (!(action.name in ACTION_HANDLERS)) {
                log.error(`Cannot find '${action.name}' search action handler, skipping.`);
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
                log.info(`Applying action handler to note ${resultNote.noteId}: ${JSON.stringify(action)}`);

                const handler = ACTION_HANDLERS[action.name] as (a: typeof action, n: BNote) => void;
                handler(action, resultNote);
            } catch (e: any) {
                log.error(`ExecuteScript search action failed with ${e.message}`);
            }
        }
    }
}

export default {
    executeActions,
    executeActionsFromNote
};
