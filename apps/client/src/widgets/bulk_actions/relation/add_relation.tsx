import AbstractBulkAction, { ActionDefinition } from "../abstract_bulk_action.js";
import { t } from "../../../services/i18n.js";
import BulkAction, { BulkActionArrow, BulkActionAttributeName, useSaveAction } from "../BulkAction.jsx";
import NoteAutocomplete from "../../react/NoteAutocomplete.jsx";
import { useState } from "preact/hooks";

function AddRelationBulkActionComponent({ bulkAction, actionDef }: { bulkAction: AbstractBulkAction, actionDef: ActionDefinition }) {
    const [ relationName, setRelationName ] = useState<string>(actionDef.relationName);
    const [ targetNoteId, setTargetNoteId ] = useState<string>(actionDef.targetNoteId);
    useSaveAction(bulkAction, { relationName, targetNoteId });

    return (
        <BulkAction
            bulkAction={bulkAction}
        >
            <BulkActionAttributeName
                type="relation"
                placeholder={t("add_relation.relation_name")}
                title={t("add_relation.allowed_characters")}
                currentValue={relationName} onChange={setRelationName}
            />

            <BulkActionArrow />

            <NoteAutocomplete
                placeholder={t("add_relation.target_note")}
                required
                noteId={targetNoteId} noteIdChanged={setTargetNoteId}
            />
        </BulkAction>
    )  
}

export default class AddRelationBulkAction extends AbstractBulkAction {

    static get actionName() {
        return "addRelation";
    }
    static get actionTitle() {
        return t("add_relation.add_relation");
    }
    static get actionIcon() {
        return "bx bx-transfer bulk-action-marker-add";
    }
    static get actionDescription() {
        return t("add_relation.description");
    }

    doRender() {
        return <AddRelationBulkActionComponent bulkAction={this} actionDef={this.actionDef} />
    }
}
