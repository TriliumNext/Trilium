import { lazy } from "preact/compat";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

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
    const [ content, onEditorClose ] = useShownContent(note, initialContent);
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
                onClose={onEditorClose}
            />
        </EditableEmbedContent>
    );
}

/**
 * The content of `note` to preview: the content of the editor of the embed as it closed, until its
 * last save lands, and otherwise the content that each save of the note stores. Returns that
 * content, and the callback that takes the content of the closing editor and its save.
 */
function useShownContent(note: FNote, initialContent: string) {
    const [ content, setContent ] = useState(initialContent);
    const closingSaveRef = useRef<Promise<void> | undefined>(undefined);
    const blob = useNoteBlob(note);

    // An earlier save that lands while the last save runs stores older content.
    useEffect(() => {
        if (blob && !closingSaveRef.current) {
            setContent(blob.content);
        }
    }, [ blob ]);

    const onEditorClose = useCallback((editorContent: string, save: Promise<void>) => {
        setContent(editorContent);
        closingSaveRef.current = save;
        void save
            .then(() => (closingSaveRef.current === save ? note.getBlob() : undefined))
            .then((saved) => {
                if (closingSaveRef.current !== save) return;
                closingSaveRef.current = undefined;
                if (saved) {
                    setContent(saved.content);
                }
            });
    }, [ note ]);

    return [ content, onEditorClose ] as const;
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
    return tracked;
}

/** The last save of an editor of `noteId` that went away, while it runs. */
export function getClosingSave(noteId: string) {
    return closingSaves.get(noteId);
}
