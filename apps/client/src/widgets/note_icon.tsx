import "./note_icon.css";

import { t } from "i18next";
import { useEffect, useState } from "preact/hooks";

import FNote from "../entities/fnote";
import attributes from "../services/attributes";
import { useNoteContext, useNoteLabel } from "./react/hooks";
import { IconPickerButton } from "./react/IconPicker";

/**
 * The icon of the note being read, and the way to change it: the shared picking button, made to
 * write what it gives back onto the note (see {@link IconPickerButton}, which is also what decides
 * whether the picker hangs under the button or takes a screen of its own).
 */
export default function NoteIcon() {
    const { note, viewScope } = useNoteContext();
    const [ icon, setIcon ] = useState<string | null | undefined>();
    const [ iconClass ] = useNoteLabel(note, "iconClass");
    const [ workspaceIconClass ] = useNoteLabel(note, "workspaceIconClass");

    useEffect(() => {
        setIcon(note?.getIcon());
    }, [ note, iconClass, workspaceIconClass ]);

    const isDisabled = viewScope?.viewMode !== "default"
        || note?.isMetadataReadOnly;
    const iconLabels = note ? getIconLabels(note) : [];

    return (
        // ReactWrappedWidget moves this root out of its render container. Keep it stable so a keyed
        // picker replacement is inserted into the live layout rather than the detached container.
        <div className="note-icon-root">
            <IconPickerButton
                key={note?.noteId}
                icon={icon ?? "bx bx-empty"}
                title={t("note_icon.change_note_icon")}
                disabled={isDisabled}
                onSelect={(picked) => {
                    if (!note) return;
                    const attributeToSet = note.hasOwnedLabel("workspace") ? "workspaceIconClass" : "iconClass";
                    attributes.setLabel(note.noteId, attributeToSet, picked);
                }}
                // Nothing to reset while the note wears the icon its type gives it.
                onReset={iconLabels.length ? () => {
                    for (const label of iconLabels) {
                        attributes.removeAttributeById(label.noteId, label.attributeId);
                    }
                } : undefined}
            />
        </div>
    );
}

function getIconLabels(note: FNote) {
    return note.getOwnedLabels()
        .filter((label) => ["workspaceIconClass", "iconClass"]
            .includes(label.name));
}
