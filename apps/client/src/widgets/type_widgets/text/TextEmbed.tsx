import { lazy } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";

import type FNote from "../../../entities/fnote";
import type { ContentEditor } from "../../../services/content_renderer";
import froca from "../../../services/froca";
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
    /** Renders the note with `content`, after a change. */
    renderPreview: (content: string) => Promise<HTMLElement>;
}

/**
 * A text note in an embed, shown rendered, and edited with a text editor of its own while the
 * Editable toggle of its embed is on.
 */
export default function TextEmbed({
    note, editor, content: initialContent, preview, renderPreview
}: TextEmbedProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const { isEditing } = useEditableEmbed(rootRef, {
        editor,
        note,
        focusTarget: ".ck-editor__editable"
    });
    const [ content, setContent ] = useState(initialContent);
    const blob = useNoteBlob(note);
    // While the last save of the editor runs, the preview shows what the editor held, rather than
    // what an earlier save stored.
    useEffect(() => {
        if (blob && !getClosingSave(note.noteId)) {
            setContent(blob.content);
        }
    }, [ blob ]);
    const shownPreview =
        useEmbedPreview(preview, content, () => renderPreview(content), isEditing);

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
                onClose={setContent}
            />
        </EditableEmbedContent>
    );
}

/** The last saves of the editors of included notes that went away, by note ID, until they land. */
const closingSaves = new Map<string, Promise<void>>();

/**
 * Tracks `save`, the last save of an editor of `noteId` that went away, until it lands. Then drops
 * the content that `froca` fetched before, so that the next editor loads what the save stored.
 */
export function trackClosingSave(noteId: string, save: Promise<unknown> | null) {
    const tracked: Promise<void> = Promise.resolve(save)
        .catch(() => {
            // Failures are logged by `SpacedUpdate` and retried.
        })
        .then(() => {
            delete froca.blobPromises[`notes-${noteId}`];
            if (closingSaves.get(noteId) === tracked) {
                closingSaves.delete(noteId);
            }
        });
    closingSaves.set(noteId, tracked);
}

/** The last save of an editor of `noteId` that went away, while it runs. */
export function getClosingSave(noteId: string) {
    return closingSaves.get(noteId);
}
