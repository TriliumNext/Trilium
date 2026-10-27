import { t } from "../../../services/i18n.js";
import AbstractBulkAction, { ActionDefinition } from "../abstract_bulk_action.js";
import BulkAction, { useSaveAction } from "../BulkAction.jsx";
import NoteAutocomplete from "../../react/NoteAutocomplete.jsx";
import { useState } from "preact/hooks";

function MoveNoteBulkActionComponent({ bulkAction, actionDef }: { bulkAction: AbstractBulkAction, actionDef: ActionDefinition }) {
    const [ targetParentNoteId, setTargetParentNoteId ] = useState<string | undefined>(actionDef.targetParentNoteId);
    useSaveAction(bulkAction, { targetParentNoteId });

    return (
        <BulkAction
            bulkAction={bulkAction}
        >

            <NoteAutocomplete
                placeholder={t("move_note.target_parent_note")}
                required
                noteId={targetParentNoteId} noteIdChanged={setTargetParentNoteId}
            />
        </BulkAction>
    )
}

export default class MoveNoteBulkAction extends AbstractBulkAction {
    static get actionName() {
        return "moveNote";
    }
    static get actionTitle() {
        return t("move_note.move_note");
    }
    static get actionIcon() {
        return "bx bx-note bulk-action-marker-move";
    }
    static get actionDescription() {
        return t("move_note.description");
    }

    doRender() {
        return <MoveNoteBulkActionComponent bulkAction={this} actionDef={this.actionDef} />
    }
}
