import "./CodeEmbed.css";

import { lazy } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";

import type FAttachment from "../../../entities/fattachment";
import FNote from "../../../entities/fnote";
import { type ContentEditor, renderCodePreview } from "../../../services/content_renderer";
import { useNoteBlob, useNoteProperty } from "../../react/hooks";
import {
    EditableEmbedContent, useEditableEmbed, useEmbedPreview
} from "../text/editable_embed";

const CodeEmbedEditor = lazy(() => import("./CodeEmbedEditor"));

interface CodeEmbedProps {
    entity: FNote | FAttachment;
    /** Saves the changes to `entity`. */
    editor: ContentEditor;
    /** The content shown first. */
    content: string;
    /** The MIME type that highlights the content. A note follows its own `mime` instead. */
    mime: string;
    /** The highlighted `content`. */
    preview: HTMLElement;
}

/**
 * A code note or a code file in an embed, shown highlighted, and edited with CodeMirror while the
 * Editable toggle of its embed is on.
 */
export default function CodeEmbed({
    entity, editor, content: initialContent, mime: initialMime, preview
}: CodeEmbedProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const note = entity instanceof FNote ? entity : null;
    const { isEditing } = useEditableEmbed(rootRef, { editor, note, focusTarget: ".cm-content" });
    const [ content, setContent ] = useState(initialContent);
    const mime = useNoteProperty(note, "mime") ?? initialMime;
    useChangesFromElsewhere(note, editor, setContent);
    const shownPreview = useEmbedPreview(
        preview,
        `${mime}\n${content}`,
        () => renderCodePreview(content, mime)
    );

    return (
        <EditableEmbedContent
            rootRef={rootRef}
            className="code-embed-content"
            isEditing={isEditing}
            preview={shownPreview}
        >
            <CodeEmbedEditor
                note={note}
                editor={editor}
                content={content}
                mime={mime}
                onClose={setContent}
            />
        </EditableEmbedContent>
    );
}

/**
 * Shows the content that another component saves to `note`. Unsaved changes made in the embed
 * are kept, and replace that content when they save.
 */
function useChangesFromElsewhere(
    note: FNote | null,
    editor: ContentEditor,
    setContent: (content: string) => void
) {
    const blob = useNoteBlob(note, editor.componentId);

    useEffect(() => {
        if (blob && editor.getUnsavedContent() === undefined) {
            setContent(blob.content);
        }
    }, [ blob ]);
}
