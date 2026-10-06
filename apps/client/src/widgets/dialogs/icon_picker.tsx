import { useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import { useTriliumEvent } from "../react/hooks";
import { IconPickerModal } from "../react/IconPicker";

export interface IconPickerOpts {
    /** Receives the class of the icon picked, e.g. `bx bx-star`. */
    onSelect(iconClass: string): void;
}

/**
 * Shows `IconPickerModal` on the `showIconPickerDialog` event, for callers with no Preact button
 * to open a dropdown from, such as the CKEditor toolbar on mobile.
 */
export default function IconPickerDialog() {
    const onSelectRef = useRef<IconPickerOpts["onSelect"]>(null);
    const [ shown, setShown ] = useState(false);

    useTriliumEvent("showIconPickerDialog", ({ onSelect }) => {
        onSelectRef.current = onSelect;
        setShown(true);
    });

    return (
        <IconPickerModal
            title={t("note_icon.insert_icon")}
            show={shown}
            onHidden={() => setShown(false)}
            onSelect={(iconClass) => {
                setShown(false);
                onSelectRef.current?.(iconClass);
            }}
        />
    );
}
