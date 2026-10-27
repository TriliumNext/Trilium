import { useState } from "preact/hooks";
import { t } from "../../../services/i18n.js";
import FormTextBox from "../../react/FormTextBox.jsx";
import { useSpacedUpdate } from "../../react/hooks.jsx";
import AbstractBulkAction, { ActionDefinition } from "../abstract_bulk_action.js";
import BulkAction from "../BulkAction.jsx";

function SaveRevisionBulkActionComponent({ bulkAction, actionDef }: { bulkAction: AbstractBulkAction, actionDef: ActionDefinition }) {
    const [ revisionName, setRevisionName ] = useState<string>(actionDef.revisionName ?? "");
    const spacedUpdate = useSpacedUpdate(() => bulkAction.saveAction({ revisionName }));

    function onChange(value: string) {
        setRevisionName(value);
        // Mirror into actionDef immediately so an Execute that fires before the debounced
        // saveAction still submits the typed name rather than a stale/undefined value.
        bulkAction.actionDef.revisionName = value;
        spacedUpdate.scheduleUpdate();
    }

    return (
        <BulkAction
            bulkAction={bulkAction}
        >
            <FormTextBox
                placeholder={t("save_revision.revision_name_placeholder")}
                currentValue={revisionName} onChange={onChange}
            />
        </BulkAction>
    );
}

export default class SaveRevisionBulkAction extends AbstractBulkAction {
    static get actionName() {
        return "saveRevision";
    }

    static get actionTitle() {
        return t("save_revision.save_revision");
    }
    static get actionIcon() {
        return "bx bx-history bulk-action-marker-add";
    }
    static get actionDescription() {
        return t("save_revision.description");
    }

    doRender() {
        return <SaveRevisionBulkActionComponent bulkAction={this} actionDef={this.actionDef} />;
    }
}
