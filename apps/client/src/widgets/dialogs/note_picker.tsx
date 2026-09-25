import { useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import { Suggestion, triggerRecentNotes } from "../../services/note_autocomplete";
import tree from "../../services/tree";
import Button from "../react/Button";
import FormGroup from "../react/FormGroup";
import { useTriliumEvent } from "../react/hooks";
import Modal from "../react/Modal";
import NoteAutocomplete from "../react/NoteAutocomplete";

export interface NotePickerDialogOptions {
    /** Names what the note is wanted for; the stock title only asks for one. */
    title?: string;
    /** What the search box is labelled with. */
    message?: string;
    /** What accepting is called, for a caller that can name the act more plainly than "OK". */
    okLabel?: string;
    callback?: (noteId: string | null) => void;
}

/**
 * Asks for one note from anywhere in the document, reported to the caller as a note id.
 *
 * The picking is the autocomplete's, which is what every other note field in the app is built on;
 * this only wraps it in something a caller with no field of its own can open, such as a context
 * menu. Reach it through `dialog.chooseNote()` rather than the command, which is what turns the
 * answer into a promise.
 */
export default function NotePickerDialog() {
    const opts = useRef<NotePickerDialogOptions>();
    const inputRef = useRef<HTMLInputElement>(null);
    const [ suggestion, setSuggestion ] = useState<Suggestion | null>(null);
    const [ shown, setShown ] = useState(false);
    // Held apart from the suggestion because the answer is reported once the modal is out of the
    // way, by when dismissing it has already cleared what was picked.
    const pickedNoteId = useRef<string | null>(null);

    useTriliumEvent("showNotePickerDialog", (newOpts) => {
        opts.current = newOpts;
        setSuggestion(null);
        setShown(true);
    });

    return (
        <Modal
            className="note-picker-dialog"
            title={opts.current?.title ?? t("note_picker.title")}
            size="lg"
            zIndex={2000}
            onShown={() => triggerRecentNotes(inputRef.current)}
            onSubmit={() => {
                pickedNoteId.current = tree.getNoteIdFromUrl(suggestion?.notePath);
                setShown(false);
            }}
            onHidden={() => {
                setShown(false);
                opts.current?.callback?.(pickedNoteId.current);
                pickedNoteId.current = null;
                opts.current = undefined;
            }}
            footer={<>
                <Button text={t("modal.cancel")} onClick={() => setShown(false)} />
                <Button
                    text={opts.current?.okLabel ?? t("note_picker.ok")}
                    keyboardShortcut="Enter"
                    kind="primary"
                    disabled={!suggestion?.notePath}
                />
            </>}
            show={shown}
            stackable
        >
            <FormGroup
                name="note-picker-note"
                label={opts.current?.message ?? t("note_picker.label")}
            >
                <NoteAutocomplete
                    inputRef={inputRef}
                    onChange={setSuggestion}
                    opts={{ hideAllButtons: true }}
                />
            </FormGroup>
        </Modal>
    );
}
