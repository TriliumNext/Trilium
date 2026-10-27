import type { InlineEmbedSource } from "@triliumnext/ckeditor5";
import type { ComponentType, RefObject } from "preact";
import { useSyncExternalStore } from "preact/compat";
import { useEffect, useMemo, useState } from "preact/hooks";

import type FAttachment from "../../../entities/fattachment";
import type FNote from "../../../entities/fnote";
import type { ContentEditor } from "../../../services/content_renderer";
import type { InlineSourceSaves } from "./attachment_saves";
import type EmbedHistories from "./embed_history";
import type { SourceEmbedProps } from "../../../services/source_embeds";
import { useSavedContent } from "../code/CodeEmbed";

interface AttachmentSourceEmbedProps {
    entity: FNote | FAttachment;
    editor: ContentEditor | undefined;
    /** The source shown first. */
    content: string;
    component: ComponentType<SourceEmbedProps>;
    /** The element that holds the embed. A save shows once it is shown. */
    containerRef: RefObject<HTMLElement | null>;
}

/** The component of a source embed type, over a source kept in a note or an attachment. */
export default function AttachmentSourceEmbed({
    entity, editor, content: initialContent, component: Component, containerRef
}: AttachmentSourceEmbedProps) {
    const [ content, setContent ] = useState(initialContent);
    useSavedContent(entity, editor, setContent, containerRef);

    return <Component content={content} editor={editor} />;
}

interface InlineSourceEmbedProps {
    source: InlineEmbedSource;
    component: ComponentType<SourceEmbedProps>;
    /** The writes that the text note saves first. */
    saves?: InlineSourceSaves;
    /** Keeps the undo steps of the source on the undo stack of the text note. */
    histories?: EmbedHistories;
}

/** The component of a source embed type, over a source kept inline in the text note. */
export function InlineSourceEmbed({
    source, component: Component, saves, histories
}: InlineSourceEmbedProps) {
    const content = useSyncExternalStore(source.subscribe, source.getSource);
    const editor = useMemo(
        () => createInlineSourceEditor(source, saves, histories), [ source, saves, histories ]);
    useEffect(() => () => editor.release(), [ editor ]);

    return <Component content={content} editor={editor} />;
}

/**
 * The editor of a source kept inline, which writes the source into the text note a moment after
 * it stops changing. Until then `saves` holds the write, so that the text note makes it before it
 * saves.
 */
export function createInlineSourceEditor(
    source: InlineEmbedSource,
    saves?: InlineSourceSaves,
    histories?: EmbedHistories
): ContentEditor {
    let getPending: (() => string) | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const flush = () => {
        clearTimeout(timeout);
        timeout = undefined;
        saves?.delete(flush);
        const getContent = getPending;
        getPending = undefined;
        if (getContent) {
            source.setSource(getContent());
        }
    };

    return {
        canEdit: () => !source.isReadOnly(),
        getUnsavedContent: () => getPending?.(),
        scheduleSave(getContent, onSaved) {
            getPending = getContent;
            saves?.add(flush);
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                flush();
                onSaved?.(source.getSource());
            }, INLINE_SAVE_DELAY);
        },
        release: flush,
        history: histories?.get(source, (text) => source.setSource(text))
    };
}

/** How long an inline source has to stay unchanged before it is written, in milliseconds. */
const INLINE_SAVE_DELAY = 500;
