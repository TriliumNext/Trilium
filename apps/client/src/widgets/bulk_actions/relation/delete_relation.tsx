import AbstractBulkAction, { ActionDefinition } from "../abstract_bulk_action.js";
import { t } from "../../../services/i18n.js";
import BulkAction, { BulkActionAttributeName, useSaveAction } from "../BulkAction.jsx";
import { useState } from "preact/hooks";

function DeleteRelationBulkActionComponent({ bulkAction, actionDef }: { bulkAction: AbstractBulkAction, actionDef: ActionDefinition }) {
    const [ relationName, setRelationName ] = useState(actionDef.relationName);
    useSaveAction(bulkAction, { relationName });

    return (
        <BulkAction
            bulkAction={bulkAction}
        >
            <BulkActionAttributeName
                type="relation"
                placeholder={t("delete_relation.relation_name")}
                title={t("delete_relation.allowed_characters")}
                currentValue={relationName} onChange={setRelationName}
            />
        </BulkAction>
    )
}

export default class DeleteRelationBulkAction extends AbstractBulkAction {

    static get actionName() {
        return "deleteRelation";
    }

    static get actionTitle() {
        return t("delete_relation.delete_relation");
    }
    static get actionIcon() {
        return "bx bx-transfer bulk-action-marker-delete";
    }
    static get actionDescription() {
        return t("delete_relation.description");
    }

    doRender() {
        return <DeleteRelationBulkActionComponent bulkAction={this} actionDef={this.actionDef} />
    }
}
