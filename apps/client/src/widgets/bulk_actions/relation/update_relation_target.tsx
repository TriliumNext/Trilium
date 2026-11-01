import AbstractBulkAction, { ActionDefinition } from "../abstract_bulk_action.js";
import { t } from "../../../services/i18n.js";
import BulkAction, { BulkActionArrow, BulkActionAttributeName, useSaveAction } from "../BulkAction.jsx";
import NoteAutocomplete from "../../react/NoteAutocomplete.jsx";
import { useState } from "preact/hooks";

function UpdateRelationTargetComponent({ bulkAction, actionDef }: { bulkAction: AbstractBulkAction, actionDef: ActionDefinition }) {
    const [ relationName, setRelationName ] = useState(actionDef.relationName);
    const [ targetNoteId, setTargetNoteId ] = useState(actionDef.targetNoteId);
    useSaveAction(bulkAction, { relationName, targetNoteId });

    return (
        <BulkAction
            bulkAction={bulkAction}
        >
            <BulkActionAttributeName
                type="relation"
                placeholder={t("update_relation_target.relation_name")}
                title={t("update_relation_target.allowed_characters")}
                currentValue={relationName} onChange={setRelationName}
            />

            <BulkActionArrow />

            <NoteAutocomplete
                placeholder={t("update_relation_target.target_note")}
                required
                noteId={targetNoteId} noteIdChanged={setTargetNoteId}
            />
        </BulkAction>
    )
}

export default class UpdateRelationTargetBulkAction extends AbstractBulkAction {

    static get actionName() {
        return "updateRelationTarget";
    }

    static get actionTitle() {
        return t("update_relation_target.update_relation_target");
    }
    static get actionIcon() {
        return "bx bx-transfer bulk-action-marker-update";
    }
    static get actionDescription() {
        return t("update_relation_target.description");
    }

    doRender() {
        return <UpdateRelationTargetComponent bulkAction={this} actionDef={this.actionDef} />
    }

}
