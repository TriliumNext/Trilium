import server from "./server.js";
import ws from "./ws.js";
import MoveNoteBulkAction from "../widgets/bulk_actions/note/move_note.js";
import DeleteNoteBulkAction from "../widgets/bulk_actions/note/delete_note.js";
import DeleteRevisionsBulkAction from "../widgets/bulk_actions/note/delete_revisions.js";
import DeleteLabelBulkAction from "../widgets/bulk_actions/label/delete_label.js";
import DeleteRelationBulkAction from "../widgets/bulk_actions/relation/delete_relation.js";
import RenameLabelBulkAction from "../widgets/bulk_actions/label/rename_label.js";
import RenameRelationBulkAction from "../widgets/bulk_actions/relation/rename_relation.js";
import UpdateLabelValueBulkAction from "../widgets/bulk_actions/label/update_label_value.js";
import UpdateRelationTargetBulkAction from "../widgets/bulk_actions/relation/update_relation_target.js";
import ExecuteScriptBulkAction from "../widgets/bulk_actions/execute_script.js";
import AddLabelBulkAction from "../widgets/bulk_actions/label/add_label.js";
import AddRelationBulkAction from "../widgets/bulk_actions/relation/add_relation.js";
import RenameNoteBulkAction from "../widgets/bulk_actions/note/rename_note.js";
import { t } from "./i18n.js";
import type FNote from "../entities/fnote.js";
import toast from "./toast.js";
import { BulkAction } from "@triliumnext/commons";

export const ACTION_GROUPS = [
    {
        title: t("bulk_actions.labels"),
        actions: [AddLabelBulkAction, UpdateLabelValueBulkAction, RenameLabelBulkAction, DeleteLabelBulkAction]
    },
    {
        title: t("bulk_actions.relations"),
        actions: [AddRelationBulkAction, UpdateRelationTargetBulkAction, RenameRelationBulkAction, DeleteRelationBulkAction]
    },
    {
        title: t("bulk_actions.notes"),
        actions: [RenameNoteBulkAction, MoveNoteBulkAction, DeleteNoteBulkAction, DeleteRevisionsBulkAction]
    },
    {
        title: t("bulk_actions.other"),
        actions: [ExecuteScriptBulkAction]
    }
];

const ACTION_CLASSES = [
    RenameNoteBulkAction,
    MoveNoteBulkAction,
    DeleteNoteBulkAction,
    DeleteRevisionsBulkAction,
    DeleteLabelBulkAction,
    DeleteRelationBulkAction,
    RenameLabelBulkAction,
    RenameRelationBulkAction,
    AddLabelBulkAction,
    AddRelationBulkAction,
    UpdateLabelValueBulkAction,
    UpdateRelationTargetBulkAction,
    ExecuteScriptBulkAction
];

async function addAction(noteId: string, actionName: string) {
    await server.post(`notes/${noteId}/attributes`, {
        type: "label",
        name: "action",
        value: JSON.stringify({
            name: actionName
        })
    });

    await ws.waitForMaxKnownEntityChangeId();
}

function parseActions(note: FNote) {
    const actionLabels = note.getLabels("action");

    return actionLabels
        .map((actionAttr) => {
            let actionDef;

            try {
                actionDef = JSON.parse(actionAttr.value);
            } catch (e: any) {
                logError(`Parsing of attribute: '${actionAttr.value}' failed with error: ${e.message}`);
                return null;
            }

            const ActionClass = ACTION_CLASSES.find((actionClass) => actionClass.actionName === actionDef.name);

            if (!ActionClass) {
                logError(`No action class for '${actionDef.name}' found.`);
                return null;
            }

            return new ActionClass(actionAttr, actionDef);
        })
        .filter((action) => !!action);
}

export async function executeBulkActions(targetNoteIds: string[], actions: BulkAction[], includeDescendants = false) {
    await server.post("bulk-action/execute", {
        noteIds: targetNoteIds,
        includeDescendants,
        actions
    });

    await ws.waitForMaxKnownEntityChangeId();
    toast.showMessage(t("bulk_actions.bulk_actions_executed"), 3000);
}

export default {
    addAction,
    parseActions,
    ACTION_CLASSES,
    ACTION_GROUPS
};
