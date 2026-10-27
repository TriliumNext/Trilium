import { useState } from "preact/hooks";
import { t } from "../../../services/i18n.js";
import AbstractBulkAction, { ActionDefinition } from "../abstract_bulk_action.js";
import BulkAction, { BulkActionArrow, BulkActionAttributeName, useSaveAction } from "../BulkAction.jsx";

function RenameLabelBulkActionComponent({ bulkAction, actionDef }: { bulkAction: AbstractBulkAction, actionDef: ActionDefinition}) {
    const [ oldLabelName, setOldLabelName ] = useState(actionDef.oldLabelName);
    const [ newLabelName, setNewLabelName ] = useState(actionDef.newLabelName);
    useSaveAction(bulkAction, { oldLabelName, newLabelName });

    return (
        <BulkAction
            bulkAction={bulkAction}
        >
            <BulkActionAttributeName
                type="label"
                placeholder={t("rename_label.old_name_placeholder")}
                title={t("rename_label.name_title")}
                currentValue={oldLabelName} onChange={setOldLabelName}
            />

            <BulkActionArrow />

            <BulkActionAttributeName
                type="label"
                placeholder={t("rename_label.new_name_placeholder")}
                title={t("rename_label.name_title")}
                currentValue={newLabelName} onChange={setNewLabelName}
            />
        </BulkAction>
    )
}

export default class RenameLabelBulkAction extends AbstractBulkAction {
    static get actionName() {
        return "renameLabel";
    }
    static get actionTitle() {
        return t("rename_label.rename_label");
    }
    static get actionIcon() {
        return "bx bx-hash bulk-action-marker-rename";
    }
    static get actionDescription() {
        return t("rename_label.description");
    }

    doRender() {
        return <RenameLabelBulkActionComponent bulkAction={this} actionDef={this.actionDef} />
    }
}
