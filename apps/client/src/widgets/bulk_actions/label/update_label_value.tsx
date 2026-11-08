import { t } from "../../../services/i18n.js";
import AbstractBulkAction, { ActionDefinition } from "../abstract_bulk_action.js";
import BulkAction, {
    BulkActionArrow, BulkActionAttributeName, BulkActionLabelValue, useSaveAction
} from "../BulkAction.jsx";
import { useState } from "preact/hooks";

function UpdateLabelValueComponent({ bulkAction, actionDef }: { bulkAction: AbstractBulkAction, actionDef: ActionDefinition}) {
    const [ labelName, setLabelName ] = useState<string>(actionDef.labelName ?? "");
    const [ labelValue, setLabelValue ] = useState<string>(actionDef.labelValue ?? "");
    useSaveAction(bulkAction, { labelName, labelValue });

    return (
        <BulkAction
            bulkAction={bulkAction}
        >
            <BulkActionAttributeName
                type="label"
                placeholder={t("update_label_value.label_name_placeholder")}
                title={t("update_label_value.label_name_title")}
                currentValue={labelName} onChange={setLabelName}
            />
            <BulkActionArrow />
            <BulkActionLabelValue
                name={labelName}
                placeholder={t("update_label_value.new_value_placeholder")}
                currentValue={labelValue} onChange={setLabelValue}
            />
        </BulkAction>
    )
}

export default class UpdateLabelValueBulkAction extends AbstractBulkAction {
    static get actionName() {
        return "updateLabelValue";
    }
    static get actionTitle() {
        return t("update_label_value.update_label_value");
    }
    static get actionIcon() {
        return "bx bx-hash bulk-action-marker-update";
    }
    static get actionDescription() {
        return t("update_label_value.description");
    }

    doRender() {
        return <UpdateLabelValueComponent bulkAction={this} actionDef={this.actionDef} />;
    }
}
