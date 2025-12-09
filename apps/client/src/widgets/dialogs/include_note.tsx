import { useRef, useState } from "preact/hooks";
import { t } from "../../services/i18n";
import FormGroup from "../react/FormGroup";
import FormRadioGroup from "../react/FormRadioGroup";
import Modal from "../react/Modal";
import NoteAutocomplete from "../react/NoteAutocomplete";
import Button from "../react/Button";
import { Suggestion, triggerRecentNotes } from "../../services/note_autocomplete";
import tree from "../../services/tree";
import froca from "../../services/froca";
import { useTriliumEvent } from "../react/hooks";
import { type BoxSize, CKEditorApi } from "../type_widgets/text/CKEditorWithWatchdog";

export interface IncludeNoteOpts {
    editorApi: CKEditorApi;
}

export default function IncludeNoteDialog() {
    const editorApiRef = useRef<CKEditorApi>(null);
    const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
    const [boxSize, setBoxSize] = useState<string>("medium");
    const [shown, setShown] = useState(false);

    useTriliumEvent("showIncludeNoteDialog", ({ editorApi }) => {
        editorApiRef.current = editorApi;
        setShown(true);
    });

    const autoCompleteRef = useRef<HTMLInputElement>(null);

    return (
        <Modal
            className="include-note-dialog"
            title={t("include_note.dialog_title")}
            size="lg"
            onShown={() => triggerRecentNotes(autoCompleteRef.current)}
            onHidden={() => setShown(false)}
            onSubmit={() => {
                if (!suggestion?.notePath || !editorApiRef.current) return;
                setShown(false);
                includeNote(suggestion.notePath, editorApiRef.current, boxSize as BoxSize);
            }}
            footer={<Button text={t("include_note.button_include")} keyboardShortcut="Enter" />}
            show={shown}
        >
            <FormGroup name="note" label={t("include_note.label_note")}>
                <NoteAutocomplete
                    placeholder={t("include_note.placeholder_search")}
                    onChange={setSuggestion}
                    inputRef={autoCompleteRef}
                    opts={{
                        hideGoToSelectedNoteButton: true,
                        allowCreatingNotes: true
                    }}
                />
            </FormGroup>

            <FormGroup name="include-note-box-size" label={t("include_note.box_size_prompt")}>
                <FormRadioGroup
                    name="include-note-box-size"
                    currentValue={boxSize} onChange={setBoxSize}
                    values={[
                        { label: t("include_note.box_size_small"), value: "small" },
                        { label: t("include_note.box_size_medium"), value: "medium" },
                        { label: t("include_note.box_size_full"), value: "full" },
                    ]}
                />
            </FormGroup>
        </Modal>
    )
}

async function includeNote(notePath: string, editorApi: CKEditorApi, boxSize: BoxSize) {
    const noteId = tree.getNoteIdFromUrl(notePath);
    if (!noteId) {
        return;
    }
    const note = await froca.getNote(noteId);

    if (["image", "canvas", "mermaid"].includes(note?.type ?? "")) {
        // there's no benefit to use insert note functionlity for images,
        // so we'll just add an IMG tag
        editorApi.addImage(noteId);
    } else {
        editorApi.addIncludeNote(noteId, boxSize);
    }
}
