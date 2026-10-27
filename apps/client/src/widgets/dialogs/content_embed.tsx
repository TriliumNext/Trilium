import "./content_embed.css";

import clsx from "clsx";
import type { JSX } from "preact";
import { useCallback, useRef, useState } from "preact/hooks";
import { getEmbedBoxSize } from "../../services/content_renderer";
import { t } from "../../services/i18n";
import { Card, OptionCardSection } from "../react/Card";
import Modal from "../react/Modal";
import NoteAutocomplete, { type NoteAutocompleteHandle } from "../react/NoteAutocomplete";
import Button from "../react/Button";
import { Suggestion } from "../../services/note_autocomplete";
import tree from "../../services/tree";
import froca from "../../services/froca";
import type FNote from "../../entities/fnote";
import { useNote, useTriliumEvent } from "../react/hooks";
import SegmentedChoice from "../react/SegmentedChoice";
import type { BoxSize, CKEditorApi } from "../type_widgets/text/CKEditor";

export interface ContentEmbedOpts {
    editorApi: Pick<CKEditorApi, "addContentEmbed" | "addImage">;
    /** Whether the editor can change the size of an include or an image after it is inserted. */
    sizeEditable?: boolean;
}

export default function ContentEmbedDialog() {
    const editorApiRef = useRef<Pick<CKEditorApi, "addContentEmbed" | "addImage">>(null);
    const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
    // The size chosen by hand, otherwise the one that suits the picked note.
    const [chosenBoxSize, setChosenBoxSize] = useState<BoxSize | null>(null);
    const [shown, setShown] = useState(false);
    const [sizeEditable, setSizeEditable] = useState(false);
    const note = useNote(suggestion?.notePath ? tree.getNoteIdFromUrl(suggestion.notePath) : null);
    const boxSize = chosenBoxSize ?? (note ? getEmbedBoxSize(note) : "medium");

    useTriliumEvent("showContentEmbedDialog", ({ editorApi, sizeEditable }) => {
        editorApiRef.current = editorApi;
        setSizeEditable(!!sizeEditable);
        autocompleteRef.current?.clear();
        setSuggestion(null);
        setChosenBoxSize(null);
        setShown(true);
    });

    const changeSuggestion = useCallback((newSuggestion: Suggestion | null) => {
        setSuggestion(newSuggestion);
        setChosenBoxSize(null);
    }, []);

    const autocompleteRef = useRef<NoteAutocompleteHandle>(null);
    const asImage = !!note && insertsAsImage(note);

    return (
        <Modal
            className="include-note-dialog"
            title={t("include_note.dialog_title")}
            size="lg"
            helpPageId="nBAXQFj20hS1"
            onShown={() => autocompleteRef.current?.showRecentNotes()}
            onHidden={() => setShown(false)}
            onSubmit={async () => {
                if (!suggestion?.notePath || !editorApiRef.current) return;
                setShown(false);
                await embedNote(suggestion.notePath, editorApiRef.current, boxSize);
            }}
            footer={<Button
                text={t("include_note.button_include")}
                keyboardShortcut="Enter"
                disabled={!suggestion?.notePath}
            />}
            show={shown}
        >
            <Card>
                <OptionCardSection
                    className="include-note-note" name="note" label={t("include_note.label_note")}
                >
                    <NoteAutocomplete
                        onChange={changeSuggestion}
                        handleRef={autocompleteRef}
                        opts={{
                            hideGoToSelectedNoteButton: true,
                            allowCreatingNotes: true
                        }}
                    />
                </OptionCardSection>

                <OptionCardSection className="include-note-size" label={t("include_note.box_size")}>
                    <div className="include-note-size-control">
                        {asImage ? (
                            <p className="include-note-as-image">{t("include_note.inserted_as_image")}</p>
                        ) : (<>
                            <SegmentedChoice<BoxSize>
                                className="include-note-size-choice"
                                options={BOX_SIZES.map((size) => ({
                                    value: size,
                                    label: t(`include_note.size_${size}`),
                                    glyph: <BoxSizeGlyph size={size} />
                                }))}
                                currentValue={boxSize}
                                onChange={setChosenBoxSize}
                            />
                            {/* All laid out in one cell, so the row has the height of the longest. */}
                            <div className="include-note-size-description">
                                {BOX_SIZES.map((size) => (
                                    <small
                                        key={size}
                                        className={clsx({ active: size === boxSize })}
                                        aria-hidden={size !== boxSize}
                                    >
                                        {t(`include_note.size_${size}_description`)}
                                    </small>
                                ))}
                            </div>
                        </>)}
                        {sizeEditable && (
                            <small className="include-note-size-hint">
                                {asImage ? t("include_note.image_size_hint") : t("include_note.size_hint")}
                            </small>
                        )}
                    </div>
                </OptionCardSection>
            </Card>
        </Modal>
    )
}

const BOX_SIZES: BoxSize[] = [ "tiny", "small", "medium", "full", "expandable" ];

/** A box of the given size on a strip of text, drawn in the text color. */
function BoxSizeGlyph({ size }: { size: BoxSize }) {
    return (
        <svg viewBox="0 0 24 18" fill="none" stroke="currentColor" stroke-width="1.5"
            stroke-linecap="round" stroke-linejoin="round">
            {BOX_SIZE_SHAPES[size]}
        </svg>
    );
}

const BOX_SIZE_SHAPES: Record<BoxSize, JSX.Element> = {
    tiny: <>
        <rect x="2" y="6" width="20" height="6" rx="1.5" />
        <circle cx="5.5" cy="9" r="0.75" fill="currentColor" />
    </>,
    small: <rect x="2" y="4.5" width="20" height="9" rx="1.5" />,
    medium: <rect x="2" y="1" width="20" height="16" rx="1.5" />,
    full: <>
        <path d="M2 18V2.5A1.5 1.5 0 0 1 3.5 1h17A1.5 1.5 0 0 1 22 2.5V18" />
        <path d="M6 6h12M6 10h12M6 14h8" stroke-width="1" />
    </>,
    expandable: <>
        <rect x="2" y="6" width="20" height="6" rx="1.5" />
        <path d="M5 7.75 6.75 9 5 10.25" stroke-width="1.25" />
    </>
};

async function embedNote(notePath: string, editorApi: Pick<CKEditorApi, "addContentEmbed" | "addImage">, boxSize: BoxSize) {
    const noteId = tree.getNoteIdFromUrl(notePath);
    if (!noteId) {
        return;
    }
    const note = await froca.getNote(noteId);

    if (note && insertsAsImage(note)) {
        editorApi.addImage(noteId);
    } else {
        editorApi.addContentEmbed(noteId, boxSize);
    }
}

/** Whether a note is inserted as an image rather than included, having no use for a box. */
function insertsAsImage(note: FNote) {
    return [ "image", "canvas", "mermaid" ].includes(note.type);
}
