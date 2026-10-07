import { lazy } from "preact/compat";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import type FNote from "../../../entities/fnote";
import type { ContentEditor } from "../../../services/content_renderer";
import froca from "../../../services/froca";
import { useTriliumEvent } from "../../react/hooks";
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
    /** The blocks of the note that the embed shows, a `block` link parameter. */
    block?: string;
    /** The rendered note. */
    preview: HTMLElement;
    /** Renders `content`, or its blocks that `block` points at, after a change. */
    renderPreview: (content: string, block?: string) => Promise<HTMLElement>;
    /** Points the embed at the blocks that its editor holds, each time they change. */
    onBlockChange?: (block: string) => void;
}

/**
 * A text note in an embed, shown rendered, and edited with a text editor of its own while the
 * Editable toggle of its embed is on.
 */
export default function TextEmbed({
    note, editor, content: initialContent, block: initialBlock, preview, renderPreview,
    onBlockChange
}: TextEmbedProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const { isEditing } = useEditableEmbed(rootRef, {
        editor,
        note,
        focusTarget: ".ck-editor__editable"
    });
    const [ content, onEditorClose ] = useShownContent(note, initialContent);
    const [ block, setBlock ] = useState(initialBlock);
    const onEditorBlockChange = useCallback((editorBlock: string) => {
        setBlock(editorBlock);
        onBlockChange?.(editorBlock);
    }, [ onBlockChange ]);
    const shownPreview =
        useEmbedPreview(preview, content, () => renderPreview(content, block), isEditing);

    return (
        <EditableEmbedContent
            rootRef={rootRef}
            className="text-embed-content"
            isEditing={isEditing}
            preview={shownPreview}
        >
            <TextEmbedEditor
                note={note}
                block={block}
                onBlockChange={onEditorBlockChange}
                hasFixedToolbar={isEditing && hasFixedToolbarAround(rootRef.current)}
                onClose={onEditorClose}
            />
        </EditableEmbedContent>
    );
}

/**
 * The content of `note` to preview: the content of the editor of the embed as it closed, until its
 * last save lands, and otherwise the latest content that a save of the note stores. After a failed
 * save, the content of the editor stays until the next save of the note. Returns that content,
 * and the callback that takes the content of the closing editor and its save.
 */
function useShownContent(note: FNote, initialContent: string) {
    const [ content, setContent ] = useState(initialContent);
    const requestIdRef = useRef(0);
    const closingSaveRef = useRef<Promise<boolean> | undefined>(undefined);

    // Only the latest read applies, and none while the last save of the editor runs: an earlier
    // save that lands meanwhile stores older content.
    const refresh = useCallback(async () => {
        const requestId = ++requestIdRef.current;
        const blob = await note.getBlob();
        if (blob && requestId === requestIdRef.current && !closingSaveRef.current) {
            setContent(blob.content);
        }
    }, [ note ]);

    // Reads once on mount too, for a save that landed after the host read the content.
    useEffect(() => {
        void refresh();
    }, [ refresh ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.isNoteContentReloaded(note.noteId)) {
            void refresh();
        }
    });

    const onEditorClose = useCallback((editorContent: string, save: Promise<boolean>) => {
        setContent(editorContent);
        closingSaveRef.current = save;
        void save.then((isSaved) => {
            if (closingSaveRef.current !== save) return;
            closingSaveRef.current = undefined;
            if (isSaved) {
                void refresh();
            }
        });
    }, [ refresh ]);

    return [ content, onEditorClose ] as const;
}

/** The last saves of the editors of included notes that went away, by note ID, until they land. */
const closingSaves = new Map<string, Promise<boolean>>();

/**
 * Tracks `save`, the last save of an editor of `noteId` that went away, which resolves to whether
 * it succeeded, until it lands. Then drops the content that `froca` fetched before, so that the
 * next editor loads what the save stored.
 */
export function trackClosingSave(noteId: string, save: Promise<boolean>) {
    const tracked: Promise<boolean> = save
        .catch(() => false)
        .then((isSaved) => {
            delete froca.blobPromises[`notes-${noteId}`];
            if (closingSaves.get(noteId) === tracked) {
                closingSaves.delete(noteId);
            }
            return isSaved;
        });
    closingSaves.set(noteId, tracked);
    return tracked;
}

/** The last save of an editor of `noteId` that went away, while it runs. */
export function getClosingSave(noteId: string) {
    return closingSaves.get(noteId);
}
