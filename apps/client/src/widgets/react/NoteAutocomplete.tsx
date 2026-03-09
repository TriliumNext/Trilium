import { t } from "../../services/i18n";
import { useEffect } from "preact/hooks";
import note_autocomplete, { Options, type Suggestion } from "../../services/note_autocomplete";
import type { RefObject } from "preact";
import type { CSSProperties } from "preact/compat";
import { useSyncedRef } from "./hooks";

interface NoteAutocompleteProps {
    id?: string;
    inputRef?: RefObject<HTMLInputElement>;
    text?: string;
    placeholder?: string;
    container?: RefObject<HTMLElement | null | undefined>;
    containerStyle?: CSSProperties;
    opts?: Omit<Options, "container">;
    onChange?: (suggestion: Suggestion | null) => void;
    onTextChange?: (text: string) => void;
    onKeyDown?: (e: KeyboardEvent) => void;
    onBlur?: (newValue: string) => void;
    noteIdChanged?: (noteId: string) => void;
    noteId?: string;
}

export default function NoteAutocomplete({ id, inputRef: externalInputRef, text, placeholder, onChange, onTextChange, container, containerStyle, opts, noteId, noteIdChanged, onKeyDown, onBlur }: NoteAutocompleteProps) {
    const ref = useSyncedRef<HTMLInputElement>(externalInputRef);

    useEffect(() => {
        if (!ref.current) return;
        const $autoComplete = $(ref.current);

        note_autocomplete.initNoteAutocomplete($autoComplete, {
            ...opts,
            container: container?.current
        });
    }, [opts, container?.current]);

    useEffect(() => {
        if (!ref.current) return;
        const $autoComplete = $(ref.current);
        const inputListener = () => onTextChange?.($autoComplete[0].value);
        const keyDownListener = (e) => e.originalEvent && onKeyDown?.(e.originalEvent);
        const blurListener = () => onBlur?.($autoComplete.getSelectedNoteId() ?? "");

        if (onTextChange) {
            $autoComplete.on("input", inputListener);
        }
        if (onKeyDown) {
            $autoComplete.on("keydown", keyDownListener);
        }
        if (onBlur) {
            $autoComplete.on("blur", blurListener);
        }

        return () => {
            if (onTextChange) {
                $autoComplete.off("input", inputListener);
            }
            if (onKeyDown) {
                $autoComplete.off("keydown", keyDownListener);
            }
            if (onBlur) {
                $autoComplete.off("blur", blurListener);
            }
        };
    }, [onBlur, onKeyDown, onTextChange]);

    useEffect(() => {
        if (!ref.current) return;
        const $autoComplete = $(ref.current);
        if (!(onChange || noteIdChanged)) {
            return;
        }

        const autoCompleteListener = (_e, suggestion) => {
            onChange?.(suggestion);

            if (noteIdChanged) {
                const noteId = suggestion?.notePath?.split("/")?.at(-1);
                noteIdChanged(noteId);
            }
        };
        const changeListener = (e) => {
            if (!ref.current?.value) {
                autoCompleteListener(e, null);
            }
        };

        $autoComplete
            .on("autocomplete:noteselected", autoCompleteListener)
            .on("autocomplete:externallinkselected", autoCompleteListener)
            .on("autocomplete:commandselected", autoCompleteListener)
            .on("change", changeListener);

        return () => {
            $autoComplete
                .off("autocomplete:noteselected", autoCompleteListener)
                .off("autocomplete:externallinkselected", autoCompleteListener)
                .off("autocomplete:commandselected", autoCompleteListener)
                .off("change", changeListener);
        };
    }, [onChange, noteIdChanged]);

    useEffect(() => {
        if (!ref.current) return;
        const $autoComplete = $(ref.current);

        if (noteId) {
            void $autoComplete.setNote(noteId);
            return;
        }

        if (text !== undefined) {
            if (text) {
                note_autocomplete.setText($autoComplete, text);
            } else {
                note_autocomplete.clearText($autoComplete);
            }
            return;
        }

        note_autocomplete.clearText($autoComplete);
    }, [text, noteId]);

    return (
        <div className="input-group" style={containerStyle}>
            <input
                id={id}
                ref={ref}
                className="note-autocomplete form-control"
                placeholder={placeholder ?? t("add_link.search_note")} />
        </div>
    );
}
