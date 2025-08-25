import Modal from "../react/Modal";
import { t } from "../../services/i18n";
import NoteList from "../react/NoteList";
import FormGroup from "../react/FormGroup";
import NoteAutocomplete from "../react/NoteAutocomplete";
import Button from "../react/Button";
import { useRef, useState } from "preact/hooks";
import { Suggestion, triggerRecentNotes } from "../../services/note_autocomplete";
import tree from "../../services/tree";
import froca from "../../services/froca";
import branches from "../../services/branches";
import toast from "../../services/toast";
import { useTriliumEvent } from "../react/hooks";

export default function MoveToDialog() {
    const [ movedBranchIds, setMovedBranchIds ] = useState<string[]>();
    const [ suggestion, setSuggestion ] = useState<Suggestion | null>(null);
    const [ shown, setShown ] = useState(false);
    const autoCompleteRef = useRef<HTMLInputElement>(null);

    useTriliumEvent("moveBranchIdsTo", ({ branchIds }) => {
        setMovedBranchIds(branchIds);
        setShown(true);
    });

    async function onSubmit() {
        const notePath = suggestion?.notePath;
        if (!notePath) {
            logError(t("move_to.error_no_path"));
            return;
        }

        setShown(false);
        const { noteId, parentNoteId } = tree.getNoteIdAndParentIdFromUrl(notePath);
        if (!parentNoteId) {
            return;
        }

        const branchId = await froca.getBranchId(parentNoteId, noteId);
        if (branchId) {
            moveNotesTo(movedBranchIds, branchId);
        }
    }

    return (
        <Modal
            className="move-to-dialog"
            size="lg" maxWidth={1000}
            title={t("move_to.dialog_title")}
            footer={<Button text={t("move_to.move_button")} keyboardShortcut="Enter" />}
            onSubmit={onSubmit}
            onShown={() => triggerRecentNotes(autoCompleteRef.current)}
            onHidden={() => setShown(false)}
            show={shown}
        >
            <h5>{t("move_to.notes_to_move")}</h5>
            <NoteList branchIds={movedBranchIds} />

            <FormGroup name="parent-note" label={t("move_to.target_parent_note")}>
                <NoteAutocomplete
                    onChange={setSuggestion}
                    inputRef={autoCompleteRef}
                />
            </FormGroup>
        </Modal>
    )
}

async function moveNotesTo(movedBranchIds: string[] | undefined, parentBranchId: string) {
    if (movedBranchIds) {
        await branches.moveToParentNote(movedBranchIds, parentBranchId);
    }

    const parentBranch = froca.getBranch(parentBranchId);
    const parentNote = await parentBranch?.getNote();

    toast.showMessage(`${t("move_to.move_success_message")} ${parentNote?.title}`);
}