import "./CodeEmbed.css";

import type { RefObject } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import type FAttachment from "../../../entities/fattachment";
import FNote from "../../../entities/fnote";
import { type ContentEditor, renderCodePreview } from "../../../services/content_renderer";
import options from "../../../services/options";
import { useNoteBlob, useNoteLabelBoolean, useNoteProperty } from "../../react/hooks";
import {
    type ContentEmbedToolProvider, registerContentEmbedTools, useIsContentEmbedEditable
} from "../text/content_embed_tools";

const CodeEmbedEditor = lazy(() => import("./CodeEmbedEditor"));

interface CodeEmbedProps {
    entity: FNote | FAttachment;
    /** Saves the changes to `entity`. */
    editor: ContentEditor;
    /** The content shown first. */
    content: string;
    /** The highlighted `content`. */
    preview: HTMLElement;
}

/**
 * A code note or a code file in an embed, shown highlighted, and edited with CodeMirror while the
 * Editable toggle of its embed is on.
 */
export default function CodeEmbed({
    entity, editor, content: initialContent, preview
}: CodeEmbedProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const note = entity instanceof FNote ? entity : null;
    const [ isNoteReadOnly ] = useNoteLabelBoolean(note, "readOnly");
    const canEdit = editor.canEdit() && !isNoteReadOnly && !options.is("databaseReadonly");
    const isEmbedEditable = useIsContentEmbedEditable(rootRef);
    const isEditing = canEdit && isEmbedEditable;
    const [ content, setContent ] = useState(initialContent);
    const mime = useNoteProperty(note, "mime") ?? entity.mime;
    useEditableFlag(rootRef, canEdit);
    useChangesFromElsewhere(note, editor, setContent);
    useFocusFromEmbedBox(rootRef, isEditing);

    const isInitial = content === initialContent && mime === entity.mime;
    const previewView = (
        <CodePreview
            content={content}
            mime={mime}
            initialPreview={isInitial ? preview : undefined}
        />
    );

    return (
        <div ref={rootRef} className="code-embed-content">
            {isEditing ? (
                <Suspense fallback={previewView}>
                    <CodeEmbedEditor
                        note={note}
                        editor={editor}
                        content={content}
                        mime={mime}
                        onClose={setContent}
                    />
                </Suspense>
            ) : previewView}
        </div>
    );
}

interface CodePreviewProps {
    content: string;
    mime: string;
    /** The highlighted `content`, when it is rendered already. */
    initialPreview?: HTMLElement;
}

/** The highlighted content. */
function CodePreview({ content, mime, initialPreview }: CodePreviewProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        if (initialPreview) {
            containerRef.current?.replaceChildren(initialPreview);
            return;
        }

        let isCurrent = true;
        renderCodePreview(content, mime).then((preview) => {
            if (isCurrent) {
                containerRef.current?.replaceChildren(preview);
            }
        });
        return () => {
            isCurrent = false;
        };
    }, [ content, mime, initialPreview ]);

    return <div ref={containerRef} className="code-embed-preview" />;
}

/** Gives the embed that contains `rootRef` its Editable toggle while `canEdit`. */
function useEditableFlag(rootRef: RefObject<HTMLElement | null>, canEdit: boolean) {
    useEffect(() => {
        const root = rootRef.current;
        if (!root || !canEdit) return;

        return registerContentEmbedTools(root, EDITABLE_FLAG_PROVIDER);
    }, [ rootRef, canEdit ]);
}

const EDITABLE_FLAG_PROVIDER: ContentEmbedToolProvider = {
    hasEditableFlag: true,
    getTools: () => [],
    execute: () => {},
    subscribe: () => () => {}
};

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

/** Moves the focus into CodeMirror when the embed box around it takes the focus. */
function useFocusFromEmbedBox(rootRef: RefObject<HTMLElement | null>, isEditing: boolean) {
    useEffect(() => {
        const root = rootRef.current;
        const box = root?.closest<HTMLElement>(".include-note-content");
        if (!root || !box || !isEditing) return;

        const forwardFocus = () => root.querySelector<HTMLElement>(".cm-content")?.focus();
        box.addEventListener("focus", forwardFocus);
        return () => box.removeEventListener("focus", forwardFocus);
    }, [ rootRef, isEditing ]);
}
