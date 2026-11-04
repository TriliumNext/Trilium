import "./PasteButton.css";

import type { RefObject } from "preact";
import { useEffect, useState } from "preact/hooks";

import { canReadClipboardText, readClipboardText } from "../../services/clipboard_ext";
import { t } from "../../services/i18n";
import toast from "../../services/toast";

/**
 * A button that replaces the value of the field in `inputRef` with the text on the clipboard and
 * selects it. The field receives an `input` event, as for a paste by the user. Goes inside an
 * `.input-group`, after the field, and shows only where the clipboard can be read.
 */
export default function PasteButton({ inputRef, onPasted }: {
    inputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
    /** Called once the clipboard text is in the field. */
    onPasted?(): void;
}) {
    const [ canPaste, setCanPaste ] = useState(false);

    useEffect(() => {
        void canReadClipboardText().then(setCanPaste);
    }, []);

    async function paste() {
        let text: string;
        try {
            text = await readClipboardText();
        } catch (e) {
            console.warn("Failed to read the clipboard:", e);
            toast.showError(t("clipboard.paste_failed"));
            // Hides the button once the permission prompt was answered with a denial.
            setCanPaste(await canReadClipboardText());
            return;
        }

        const input = inputRef.current;
        if (!text || !input) return;

        // Set here, not by the render: Preact skips a value the field already has, so the
        // selection stays.
        input.value = text;
        input.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            inputType: "insertFromPaste"
        }));
        input.focus();
        input.select();
        onPasted?.();
    }

    if (!canPaste) return null;

    return (
        <button
            type="button"
            className="input-group-text tn-paste-button bx bx-paste"
            title={t("electron_context_menu.paste")}
            onClick={() => void paste()}
        />
    );
}
