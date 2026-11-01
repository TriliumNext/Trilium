import { useCallback, useEffect, useState } from "preact/hooks";

import FNote from "../../entities/fnote";
import attributes from "../../services/attributes";
import froca from "../../services/froca";
import { t } from "../../services/i18n";
import ColorPicker from "../../widgets/react/ColorPicker";

export interface NoteColorPickerProps {
    /** The target Note instance or its ID string. */
    note: FNote | string | null;
}

/**
 * Note-bound variant of {@link ColorPicker}: reads the current color from the note's `color` label
 * and writes picks back to it. For a plain controlled picker, use {@link ColorPicker} directly.
 */
export default function NoteColorPicker(props: NoteColorPickerProps) {
    const [note, setNote] = useState<FNote | null>(null);
    const [currentColor, setCurrentColor] = useState<string | null>(null);

    useEffect(() => {
        const retrieveNote = async (noteId: string) => {
            const noteInstance = await froca.getNote(noteId, true);
            if (noteInstance) {
                setNote(noteInstance);
            }
        };

        if (typeof props.note === "string") {
            retrieveNote(props.note); // Get the note from the given ID string
        } else {
            setNote(props.note);
        }
    }, [props.note]);

    useEffect(() => {
        setCurrentColor(note?.getLabel("color")?.value ?? null);
    }, [note]);

    const onChange = useCallback((color: string | null) => {
        if (note) {
            if (color !== null) {
                attributes.setLabel(note.noteId, "color", color);
            } else {
                attributes.removeOwnedLabelByName(note, "color");
            }

            setCurrentColor(color);
        }
    }, [note]);

    if (!props.note) return null;

    return <ColorPicker
        className="note-color-picker"
        currentValue={currentColor}
        onChange={onChange}
        disabled={note === null}
        tooltips={{
            clear: t("note-color.clear-color"),
            set: t("note-color.set-color"),
            setCustom: t("note-color.set-custom-color")
        }} />;
}
