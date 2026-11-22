import "./NoteContent.css";

import type { HighlightedTokenInfo } from "@triliumnext/commons";
import { clsx } from "clsx";
import { useContext, useEffect, useRef, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import content_renderer from "../../../services/content_renderer";
import { t } from "../../../services/i18n";
import { useImperativeSearchHighlighlighting } from "../../react/hooks/highlight";
import { ParentComponent } from "../../react/react_utils";

const contentSizeObserver = new ResizeObserver(onContentResized);

/** A preview of a note's content, marked `note-book-content-overflowing` while it overflows its box. */
export function NoteContent({ note, trim, noChildrenList, highlightedTokens, includeArchivedNotes, showTextRepresentation, interactive, onReady }: {
    note: FNote;
    trim?: boolean;
    noChildrenList?: boolean;
    highlightedTokens: (string | HighlightedTokenInfo)[] | null | undefined;
    includeArchivedNotes: boolean;
    showTextRepresentation?: boolean;
    /** Render live interactive type widgets (e.g. web views) instead of static previews. */
    interactive?: boolean;
    onReady?: () => void;
}) {
    const contentRef = useRef<HTMLDivElement>(null);
    const highlightSearch = useImperativeSearchHighlighlighting(highlightedTokens);
    const parentComponent = useContext(ParentComponent);

    const [ready, setReady] = useState(false);
    const [noteType, setNoteType] = useState<string>("none");
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;

    useEffect(() => {
        const contentElement = contentRef.current;
        if (!contentElement) return;

        contentSizeObserver.observe(contentElement);

        return () => {
            contentSizeObserver.unobserve(contentElement);
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        // Tracks the rendered content so the cleanup can unmount any interactive widget it carries
        // (collections, web views) — otherwise their standalone Preact roots leak when the note
        // changes or the card unmounts.
        let rendered: JQuery<HTMLElement> | undefined;
        setReady(false);
        content_renderer.getRenderedContent(note, {
            trim,
            noChildrenList,
            // The note list is a lightweight preview: don't render embedded notes at all.
            noContentEmbeds: true,
            includeArchivedNotes,
            showTextRepresentation,
            interactive,
            parentComponent: parentComponent ?? undefined
        })
            .then(({ $renderedContent, type }) => {
                if (cancelled || !contentRef.current) {
                    // Superseded by a newer render or unmounted while rendering — tear down what was
                    // just mounted instead of letting it leak (and don't clobber newer content).
                    content_renderer.disposeInteractiveContent($renderedContent);
                    return;
                }
                rendered = $renderedContent;
                if ($renderedContent[0].innerHTML) {
                    contentRef.current.replaceChildren(...$renderedContent);
                } else {
                    contentRef.current.replaceChildren();
                }
                highlightSearch(contentRef.current);
                setNoteType(type);
                setReady(true);
                onReadyRef.current?.();
            })
            .catch(e => {
                if (cancelled) return;
                console.warn(`Caught error while rendering note '${note.noteId}' of type '${note.type}'`);
                console.error(e);
                contentRef.current?.replaceChildren(t("collections.rendering_error"));
                setReady(true);
                onReadyRef.current?.();
            });
        return () => {
            cancelled = true;
            if (rendered) {
                content_renderer.disposeInteractiveContent(rendered);
            }
        };
    }, [ note, highlightedTokens ]);

    return <div ref={contentRef} className={clsx("note-book-content", `type-${noteType}`, {"note-book-content-ready": ready})} />;
}

function onContentResized(entries: ResizeObserverEntry[], observer: ResizeObserver): void {
    for (const contentElement of entries) {
        const isOverflowing = ((contentElement.target.scrollHeight > contentElement.target.clientHeight))
        contentElement.target.classList.toggle("note-book-content-overflowing", isOverflowing);
    }
}