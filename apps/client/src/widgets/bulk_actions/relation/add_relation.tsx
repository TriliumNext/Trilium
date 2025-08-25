import AbstractBulkAction, { ActionDefinition } from "../abstract_bulk_action.js";
import { t } from "../../../services/i18n.js";
import BulkAction, { BulkActionText } from "../BulkAction.jsx";
import NoteAutocomplete from "../../react/NoteAutocomplete.jsx";
import FormTextBox from "../../react/FormTextBox.jsx";
import { useEffect, useState } from "preact/hooks";
import { useSpacedUpdate } from "../../react/hooks.jsx";

function AddRelationBulkActionComponent({ bulkAction, actionDef }: { bulkAction: AbstractBulkAction, actionDef: ActionDefinition }) {
    const [ relationName, setRelationName ] = useState<string>(actionDef.relationName);
    const [ targetNoteId, setTargetNoteId ] = useState<string>(actionDef.targetNoteId);
    const spacedUpdate = useSpacedUpdate(() => bulkAction.saveAction({ relationName, targetNoteId }));
    useEffect(() => spacedUpdate.scheduleUpdate(), [ relationName, targetNoteId ]);

    return (
        <BulkAction
            bulkAction={bulkAction}
            label={t("add_relation.add_relation")}
            helpText={t("add_relation.create_relation_on_all_matched_notes")}
        >
            <FormTextBox 
                placeholder={t("add_relation.relation_name")}
                pattern="[\\p{L}\\p{N}_:]+"
                style={{ flexShrink: 3 }}
                title={t("add_relation.allowed_characters")}
                currentValue={relationName} onChange={setRelationName}
            />

            <BulkActionText text={t("add_relation.to")} />

            <NoteAutocomplete
                placeholder={t("add_relation.target_note")}
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

    doRender() {
        return <AddRelationBulkActionComponent bulkAction={this} actionDef={this.actionDef} />
    }
}
