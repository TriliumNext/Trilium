import { useCallback, useRef, useState } from "preact/hooks";
import { getEmbedBoxSize } from "../../services/content_renderer";
import { t } from "../../services/i18n";
import FormGroup from "../react/FormGroup";
import FormRadioGroup from "../react/FormRadioGroup";
import Modal from "../react/Modal";
import NoteAutocomplete, { type NoteAutocompleteHandle } from "../react/NoteAutocomplete";
import Button from "../react/Button";
import { Suggestion } from "../../services/note_autocomplete";
import tree from "../../services/tree";
import froca from "../../services/froca";
import { useNote, useTriliumEvent } from "../react/hooks";
import type { BoxSize, CKEditorApi } from "../type_widgets/text/CKEditorWithWatchdog";

export interface ContentEmbedOpts {
    editorApi: Pick<CKEditorApi, "addContentEmbed" | "addImage">;
}

export default function ContentEmbedDialog() {
    const editorApiRef = useRef<Pick<CKEditorApi, "addContentEmbed" | "addImage">>(null);
    const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
    // The size chosen by hand, otherwise the one that suits the picked note.
    const [chosenBoxSize, setChosenBoxSize] = useState<BoxSize | null>(null);
    const [shown, setShown] = useState(false);
    const note = useNote(suggestion?.notePath ? tree.getNoteIdFromUrl(suggestion.notePath) : null);
    const boxSize = chosenBoxSize ?? (note ? getEmbedBoxSize(note) : "medium");

    useTriliumEvent("showContentEmbedDialog", ({ editorApi }) => {
        editorApiRef.current = editorApi;
        setChosenBoxSize(null);
        setShown(true);
    });

    const changeSuggestion = useCallback((newSuggestion: Suggestion | null) => {
        setSuggestion(newSuggestion);
        setChosenBoxSize(null);
    }, []);

    const autocompleteRef = useRef<NoteAutocompleteHandle>(null);

    return (
        <Modal
            className="include-note-dialog"
            title={t("include_note.dialog_title")}
            size="lg"
            onShown={() => autocompleteRef.current?.showRecentNotes()}
            onHidden={() => setShown(false)}
            onSubmit={async () => {
                if (!suggestion?.notePath || !editorApiRef.current) return;
                setShown(false);
                await embedNote(suggestion.notePath, editorApiRef.current, boxSize);
            }}
            footer={<Button text={t("include_note.button_include")} keyboardShortcut="Enter" />}
            show={shown}
        >
            <FormGroup name="note" label={t("include_note.label_note")}>
                <NoteAutocomplete
                    placeholder={t("include_note.placeholder_search")}
                    onChange={changeSuggestion}
                    handleRef={autocompleteRef}
                    opts={{
                        hideGoToSelectedNoteButton: true,
                        allowCreatingNotes: true
                    }}
                />
            </FormGroup>

            <FormGroup name="include-note-box-size" label={t("include_note.box_size_prompt")}>
                <FormRadioGroup
                    name="include-note-box-size"
                    currentValue={boxSize} onChange={(value) => setChosenBoxSize(value as BoxSize)}
                    values={[
                        { label: t("include_note.box_size_tiny"), value: "tiny" },
                        { label: t("include_note.box_size_small"), value: "small" },
                        { label: t("include_note.box_size_medium"), value: "medium" },
                        { label: t("include_note.box_size_full"), value: "full" },
                        { label: t("include_note.box_size_expandable"), value: "expandable" },
                    ]}
                />
            </FormGroup>
        </Modal>
    )
}

async function embedNote(notePath: string, editorApi: Pick<CKEditorApi, "addContentEmbed" | "addImage">, boxSize: BoxSize) {
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
        editorApi.addContentEmbed(noteId, boxSize);
    }
}
