import AbstractBulkAction, { ActionDefinition } from "../abstract_bulk_action.js";
import { t } from "../../../services/i18n.js";
import BulkAction from "../BulkAction.jsx";
import FormTextBox from "../../react/FormTextBox.jsx";
import { useEffect, useState } from "preact/hooks";
import { useSpacedUpdate } from "../../react/hooks.jsx";
import RawHtml from "../../react/RawHtml.jsx";

function RenameNoteBulkActionComponent({ bulkAction, actionDef }: { bulkAction: AbstractBulkAction, actionDef: ActionDefinition}) {
    const [ newTitle, setNewTitle ] = useState<string>(actionDef.newTitle ?? "");
    const spacedUpdate = useSpacedUpdate(() => bulkAction.saveAction({ newTitle }));
    useEffect(() => spacedUpdate.scheduleUpdate(), [ newTitle ]);

    return (
        <BulkAction
            bulkAction={bulkAction}
            label={t("rename_note.rename_note_title_to")}
            helpText={<>
                <p>{t("rename_note.evaluated_as_js_string")}</p>

                <ul>
                    <li><RawHtml html={t("rename_note.example_note")} /></li>
                    <li><RawHtml html={t("rename_note.example_new_title")} /></li>
                    <li><RawHtml html={t("rename_note.example_date_prefix")} /></li>
                </ul>

                <RawHtml html={t("rename_note.api_docs")} />
            </>}
        >
            <FormTextBox
                placeholder={t("rename_note.new_note_title")}
                title={("rename_note.click_help_icon")}
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

    doRender() {
        return <RenameNoteBulkActionComponent bulkAction={this} actionDef={this.actionDef} />
    }

}
