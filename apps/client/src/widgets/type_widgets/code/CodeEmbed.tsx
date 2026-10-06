import "./CodeEmbed.css";

import { createPortal, type RefObject } from "preact";
import { lazy, useSyncExternalStore } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";

import type FAttachment from "../../../entities/fattachment";
import FNote from "../../../entities/fnote";
import { type ContentEditor, renderCodePreview } from "../../../services/content_renderer";
import { SaveStateBadge } from "../../layout/NoteBadges";
import { useNoteBlob, useNoteProperty, useTriliumEvent } from "../../react/hooks";
import {
    EditableEmbedContent, useEditableEmbed, useEmbedBadgeSlot, useEmbedPreview
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
    useSavedContent(entity, editor, setContent);
    const shownPreview = useEmbedPreview(
        preview,
        `${mime}\n${content}`,
        () => renderCodePreview(content, mime),
        isEditing
    );

    return (
        <>
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
            <SaveStatus rootRef={rootRef} editor={editor} isShown={isEditing} />
        </>
    );
}

interface SaveStatusProps {
    rootRef: RefObject<HTMLElement | null>;
    editor: ContentEditor;
    isShown: boolean;
}

/**
 * The save state of `editor` in the title row of the embed around `rootRef`, while `isShown`, for
 * content that saves on its own.
 */
function SaveStatus({ rootRef, editor, isShown }: SaveStatusProps) {
    const slot = useEmbedBadgeSlot(rootRef, isShown);
    const state = useSyncExternalStore(
        editor.subscribeSaveState ?? subscribeToNothing,
        () => editor.getSaveState?.()
    );

    return slot && createPortal(<SaveStateBadge state={state} />, slot);
}

/**
 * Shows the content of `entity` each time it saves, also when another embed of it saved it.
 * Unsaved changes made in the embed are kept, and replace that content when they save.
 */
function useSavedContent(
    entity: FNote | FAttachment,
    editor: ContentEditor,
    setContent: (content: string) => void
) {
    const noteBlob = useNoteBlob(entity instanceof FNote ? entity : null);
    const [ attachmentContent, setAttachmentContent ] = useState<string>();
    const requestIdRef = useRef(0);
    const content = entity instanceof FNote ? noteBlob?.content : attachmentContent;

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (entity instanceof FNote) return;
        const rows = loadResults.getAttachmentRows();
        if (rows.some((row) => row.attachmentId === entity.attachmentId)) {
            const requestId = ++requestIdRef.current;
            void entity.getBlob().then((blob) => {
                if (requestId === requestIdRef.current) {
                    setAttachmentContent(blob?.content);
                }
            });
        }
    });

    useEffect(() => {
        if (content !== undefined && editor.getUnsavedContent() === undefined) {
            setContent(content);
        }
    }, [ content ]);
}

function subscribeToNothing() {
    return () => {};
}
