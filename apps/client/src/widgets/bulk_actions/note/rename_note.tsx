import AbstractBulkAction, { ActionDefinition } from "../abstract_bulk_action.js";
import { t } from "../../../services/i18n.js";
import BulkAction, { useSaveAction } from "../BulkAction.jsx";
import { useState } from "preact/hooks";
import TemplateField from "../TemplateField.jsx";

/** What the server's `renameNote` handler passes to `evaluateTemplate()`. */
const RENAME_TEMPLATE_VARIABLES = { note: "note" } as const;

function RenameNoteBulkActionComponent({ bulkAction, actionDef }: { bulkAction: AbstractBulkAction, actionDef: ActionDefinition}) {
    const [ newTitle, setNewTitle ] = useState<string>(actionDef.newTitle ?? "");
    useSaveAction(bulkAction, { newTitle });

    return (
        <BulkAction
            bulkAction={bulkAction}
        >
            <TemplateField
                variables={RENAME_TEMPLATE_VARIABLES}
                placeholder={t("rename_note.placeholder")}
                ariaLabel={t("rename_note.rename_note")}
                currentValue={newTitle} onChange={setNewTitle}
            />
        </BulkAction>
    )
}

export default class RenameNoteBulkAction extends AbstractBulkAction {
    static get actionName() {
        return "renameNote";
    }

    static get actionTitle() {
        return t("rename_note.rename_note");
    }
    static get actionIcon() {
        return "bx bx-note bulk-action-marker-rename";
    }
    static get actionDescription() {
        return t("rename_note.description");
    }

    doRender() {
        return <RenameNoteBulkActionComponent bulkAction={this} actionDef={this.actionDef} />
    }

}
