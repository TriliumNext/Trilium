import { lazy } from "preact/compat";
import { useRef } from "preact/hooks";

import type FNote from "../../../entities/fnote";
import type { ContentEditor } from "../../../services/content_renderer";
import { useNoteBlob } from "../../react/hooks";
import {
    EditableEmbedContent, hasFixedToolbarAround, useEditableEmbed, useEmbedPreview
} from "./editable_embed";

const TextEmbedEditor = lazy(() => import("./TextEmbedEditor"));

interface TextEmbedProps {
    note: FNote;
    /** Tells whether the note can be edited here. The editor saves the note on its own. */
    editor: ContentEditor | undefined;
    /** The content of the note that `preview` shows. */
    content: string;
    /** The rendered note. */
    preview: HTMLElement;
    /** Renders the note again, after a change. */
    renderPreview: () => Promise<HTMLElement>;
}

/**
 * A text note in an embed, shown rendered, and edited with a text editor of its own while the
 * Editable toggle of its embed is on.
 */
export default function TextEmbed({
    note, editor, content, preview, renderPreview
}: TextEmbedProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const { isEditing } = useEditableEmbed(rootRef, {
        editor,
        note,
        focusTarget: ".ck-editor__editable"
    });
    const blob = useNoteBlob(note);
    const shownPreview =
        useEmbedPreview(preview, blob?.content ?? content, renderPreview, isEditing);

    return (
        <EditableEmbedContent
            rootRef={rootRef}
            className="text-embed-content"
            isEditing={isEditing}
            preview={shownPreview}
        >
            <TextEmbedEditor
                note={note}
                hasFixedToolbar={isEditing && hasFixedToolbarAround(rootRef.current)}
            />
        </EditableEmbedContent>
    );
}
