import "./AttributeEditorOverlay.css";

import clsx from "clsx";
import type { ComponentChildren, RefObject } from "preact";
import { useEffect } from "preact/hooks";

import { AUTOCOMPLETE_DROPDOWN_SELECTOR } from "../react/FormAutocomplete";
import { useGrowsUpwards } from "../react/grows_upwards";

interface AttributeEditorOverlayProps {
    /** The host's own ref to the overlay element, through which it reaches the fields within. */
    overlayRef: RefObject<HTMLSpanElement>;
    /** Names the host's kind of overlay, for the styles of its own it adds to the shell's. */
    className?: string;
    children: ComponentChildren;
    /** Close keeping the edits; leaving the overlay is what asks for it. */
    onCommit(): void;
    /** Close dropping the edits; escape is what asks for it. */
    onRevert(): void;
    /** Receives the keys the shell leaves alone — everything but escape. Enter above all, which
     *  means something different per field (commit, next field, the note search's pick), so the
     *  host is the one to read it. */
    onKeyDown?(e: KeyboardEvent): void;
}

/**
 * The shell of an editor that opens over an attribute row rather than in it — the turn the table's
 * cell editor takes (see columns.css): a row is one line of a hand-wide pane, which a field with room
 * to type in outgrows at once. The shell is the standing-over alone — the surface, the anchoring, and
 * when the edit is over — while what is edited on it is the host's: a value in its row, an attribute
 * being created. The row underneath stops clipping and comes forward meanwhile (see AttributeList.css).
 *
 * Leaving the overlay is what ends the edit and keeps it, matching the attributes editor's
 * save-on-blur; escape closes it dropping them instead. Near the foot of the pane the overlay is
 * anchored by its foot, what it outgrows the row by rising over what has been read already.
 */
export default function AttributeEditorOverlay({ overlayRef, className, children, onCommit, onRevert, onKeyDown }: AttributeEditorOverlayProps) {
    const growsUpwards = useGrowsUpwards(overlayRef);

    useEffect(() => {
        const editor = overlayRef.current;
        if (!editor) return;

        const onFocusOut = (e: FocusEvent) => {
            // Focus moving within the editor — the field to a button beside it — is not leaving it.
            if (e.relatedTarget instanceof Node && editor.contains(e.relatedTarget)) return;

            // Nor is it leaving for floating UI that belongs to the field: the note search's dropdown
            // is appended to the body, and creating a note from it opens the note type chooser — the
            // same company the detail popup keeps itself open over.
            if (e.relatedTarget instanceof Element
                && e.relatedTarget.closest(`${AUTOCOMPLETE_DROPDOWN_SELECTOR}, .algolia-autocomplete, .modal, .modal-backdrop`)) {
                return;
            }

            // Nothing in the page took the focus over, and either the editor still holds it or the
            // window itself has lost it — which is what opening a native picker's dialog does. The
            // row has not been left, and committing here would close the editor under the dialog.
            if (!e.relatedTarget && (!document.hasFocus() || editor.contains(document.activeElement))) {
                return;
            }

            onCommit();
        };

        editor.addEventListener("focusout", onFocusOut);
        return () => editor.removeEventListener("focusout", onFocusOut);
    }, [ overlayRef, onCommit ]);

    return (
        <span
            ref={overlayRef}
            className={clsx("attribute-editor-overlay", className, growsUpwards && "grows-upwards")}
            // Keep the press from reaching the row, which would open the popup over the edit.
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => {
                // The buttons beside a field (a colour's reset) take no focus of their own: letting
                // the press blur the field would commit and unmount the editor before the click
                // could land on them.
                if (e.target instanceof Element && !e.target.closest("input, textarea, select")) {
                    e.preventDefault();
                }
            }}
            onKeyDown={(e) => {
                if (e.key === "Escape") {
                    e.stopPropagation();
                    onRevert();
                } else {
                    onKeyDown?.(e);
                }
            }}
        >
            {children}
        </span>
    );
}
