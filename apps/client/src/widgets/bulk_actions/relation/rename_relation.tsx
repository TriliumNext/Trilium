import AbstractBulkAction, { ActionDefinition } from "../abstract_bulk_action.js";
import { t } from "../../../services/i18n.js";
import BulkAction, { BulkActionArrow, BulkActionAttributeName, useSaveAction } from "../BulkAction.jsx";
import { useState } from "preact/hooks";

function RenameRelationBulkActionComponent({ bulkAction, actionDef }: { bulkAction: AbstractBulkAction, actionDef: ActionDefinition }) {
    const [ oldRelationName, setOldRelationName ] = useState(actionDef.oldRelationName);
    const [ newRelationName, setNewRelationName ] = useState(actionDef.newRelationName);
    useSaveAction(bulkAction, { oldRelationName, newRelationName });

    return (
        <BulkAction
            bulkAction={bulkAction}
        >
            <BulkActionAttributeName
                type="relation"
                placeholder={t("rename_relation.old_name")}
                title={t("rename_relation.allowed_characters")}
                currentValue={oldRelationName} onChange={setOldRelationName}
            />

            <BulkActionArrow />

            <BulkActionAttributeName
                type="relation"
                placeholder={t("rename_relation.new_name")}
                title={t("rename_relation.allowed_characters")}
                currentValue={newRelationName} onChange={setNewRelationName}
            />
        </BulkAction>
    )
}

export default class RenameRelationBulkAction extends AbstractBulkAction {
    static get actionName() {
        return "renameRelation";
    }
    static get actionTitle() {
        return t("rename_relation.rename_relation");
    }
    static get actionIcon() {
        return "bx bx-transfer bulk-action-marker-rename";
    }
    static get actionDescription() {
        return t("rename_relation.description");
    }

    doRender() {
        return <RenameRelationBulkActionComponent bulkAction={this} actionDef={this.actionDef} />
    }
}
