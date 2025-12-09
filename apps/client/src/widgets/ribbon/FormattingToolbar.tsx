import { useRef } from "preact/hooks";
import { useTriliumEvent, useTriliumOption } from "../react/hooks";
import { TabContext } from "./ribbon-interface";

/**
 * Handles the editing toolbar when the CKEditor is in decoupled mode.
 *
 * This toolbar is only enabled if the user has selected the classic CKEditor.
 *
 * The ribbon item is active by default for text notes, as long as they are not in read-only mode.
 *
 * ! The toolbar is not only used in the ribbon, but also in the quick edit feature.
 * * The mobile toolbar is handled separately (see `MobileEditorToolbar`).
 */
export default function FormattingToolbar({ hidden, ntxId }: TabContext) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [ textNoteEditorType ] = useTriliumOption("textNoteEditorType");

    // Attach the toolbar from the CKEditor.
    useTriliumEvent("textEditorRefreshed", ({ ntxId: eventNtxId, editor }) => {
        if (eventNtxId !== ntxId || !containerRef.current) return;
        const toolbar = editor.ui.view.toolbar?.element;

        if (toolbar) {
            containerRef.current.replaceChildren(toolbar);
        } else {
            containerRef.current.replaceChildren();
        }
    });

    return (textNoteEditorType === "ckeditor-classic" &&
        <div
            ref={containerRef}
            className={`classic-toolbar-widget ${hidden ? "hidden-ext" : ""}`}
        />
    )
};
