import { findTocFormatName, TOC_HEADING_ATTRIBUTE } from "@triliumnext/commons/src/lib/toc.js";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import type NoteContext from "../../../components/note_context";
import FNote from "../../../entities/fnote";
import { findDocumentTarget, showDocumentTarget } from "../../../services/bookmark_jump";
import { t } from "../../../services/i18n";
import { getTocUrl } from "../../../services/link";
import { takeLinkTarget } from "../../../services/link_targets";
import {
    type OfficePreview, OfficePreviewChangedError, OfficePreviewTooLargeError, renderOfficeToHtml
} from "../../../services/office_renderer";
import type { TocDocumentState } from "../../sidebar/CachedToCProvider";
import { useActiveHeading } from "../../react/hooks/dom";
import { useLinkTargetLanding } from "../../react/hooks/note_context";
import LoadingSpinner from "../../react/LoadingSpinner";
import NoItems from "../../react/NoItems";
import { refreshBlobId } from "./toc_build";

/** How many times a preview reads the current blob again after the server refused another. */
const MAX_RENDER_ROUNDS = 3;

/** A preview, and the note, blob and render it came from. */
interface RenderedPreview extends OfficePreview {
    noteId: string;
    blobId: string | undefined;
    generation: number;
}

/** A heading that the server marked in the preview. */
interface MarkedHeading {
    id: string;
    element: HTMLElement;
}

/**
 * Main-view preview for office documents (DOCX/PPTX, ODT/ODS/ODP, RTF and EPUB, and an XLSX file
 * that cannot be read as a workbook). Fetches the server-rendered HTML preview and sanitizes it.
 * On failure it shows a placeholder saying whether the document was too large or could not be
 * converted; the file remains downloadable through the usual file note affordances.
 *
 * The preview shows the blob of the note: when the server has another one, the preview reads
 * it and renders that instead. For a document with a ToC format, it publishes `tocDocument` for
 * the outline.
 *
 * A link to a heading or a bookmark of the document lands once the preview of the blob that the
 * note context shows is in place; until then, the view scope holds it.
 */
export default function OfficePreview({ note, noteContext, isVisible = true }: {
    note: FNote;
    noteContext?: NoteContext;
    /** False while `NoteDetail` keeps the preview mounted but the pane shows another note. */
    isVisible?: boolean;
}) {
    const [preview, setPreview] = useState<RenderedPreview | null>(null);
    const [failure, setFailure] = useState<"too-large" | "error" | null>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const previewRef = useRef(preview);
    previewRef.current = preview;
    const generationRef = useRef(0);
    /** The note and blob that the latest render shows or renders. */
    const renderingRef = useRef<{ noteId: string; blobId: string | undefined } | null>(null);
    const tocDocument = useTocDocumentPublisher(note, noteContext, isVisible);

    useEffect(() => {
        const { noteId, blobId } = note;
        const rendering = renderingRef.current;
        // The blob that a render read after a refusal reaches the note later, unchanged.
        if (rendering?.noteId === noteId && rendering.blobId === blobId) {
            return;
        }
        const generation = ++generationRef.current;
        const isCurrent = () => generation === generationRef.current;
        setPreview(null);
        setFailure(null);
        tocDocument.publish({ status: "rendering" });

        void (async () => {
            let currentBlobId = blobId;
            for (let round = 1; ; round++) {
                renderingRef.current = { noteId, blobId: currentBlobId };
                try {
                    const result = await renderOfficeToHtml(
                        "notes", noteId, { blobId: currentBlobId });
                    if (isCurrent()) {
                        setPreview({ ...result, noteId, blobId: currentBlobId, generation });
                    }
                    return;
                } catch (e) {
                    if (!isCurrent()) {
                        return;
                    }
                    if (e instanceof OfficePreviewChangedError && round < MAX_RENDER_ROUNDS) {
                        const next = await refreshBlobId({ kind: "note", noteId })
                            .catch(() => null);
                        if (!isCurrent()) {
                            return;
                        }
                        if (next) {
                            currentBlobId = next;
                            continue;
                        }
                    }
                    const isTooLarge = e instanceof OfficePreviewTooLargeError;
                    if (!isTooLarge) {
                        console.warn("Failed to render office document preview:", e);
                    }
                    setFailure(isTooLarge ? "too-large" : "error");
                    tocDocument.publish({ status: "unavailable" });
                    return;
                }
            }
        })();
    }, [note.noteId, note.blobId]);

    useEffect(() => () => {
        generationRef.current++;
        renderingRef.current = null;
    }, []);

    const { headings: markedHeadings, scrollingContainer } = useMarkedHeadings(bodyRef, preview);
    const getHeadingElement = useCallback((heading: MarkedHeading) => heading.element, []);
    const activeHeadingId = useActiveHeading({
        headings: markedHeadings, scrollingContainer, getHeadingElement
    });

    // The outline waits for the preview, so that its build converts the document after it.
    useEffect(() => {
        const body = bodyRef.current;
        if (!preview || !body || !preview.blobId) {
            return;
        }
        const { generation, noteId, blobId } = preview;
        tocDocument.publish({
            status: "shown",
            tocUrl: getTocUrl("notes", noteId),
            renderedBlobId: blobId,
            ownerNoteId: noteId,
            linkPath: noteContext?.notePath ?? noteId,
            title: note.title,
            showTarget({ heading, bookmark }) {
                if (generation !== generationRef.current || bodyRef.current !== body) {
                    return false;
                }
                const target = { heading, bookmark };
                if (!findDocumentTarget(body, target)) {
                    return false;
                }
                void showDocumentTarget(body, target, { isFallbackToTop: false });
                return true;
            },
            findActiveHeading: () => activeHeadingId
        });
    }, [ preview, activeHeadingId ]);

    useLinkTargetLanding(
        { note, ntxId: noteContext?.ntxId, isVisible }, revealLinkTarget, [preview]);

    /** Lands on the target of the latest link, once the preview of the shown blob is in place. */
    function revealLinkTarget() {
        const body = bodyRef.current;
        const rendered = previewRef.current;
        const shown = noteContext?.note;
        if (!body || !rendered || rendered.noteId !== shown?.noteId
            || rendered.blobId !== shown.blobId) {
            return;
        }
        const target = takeLinkTarget(noteContext?.viewScope, [ "heading", "bookmark" ]);
        if (target) {
            void showDocumentTarget(body, target);
        }
    }

    if (failure) {
        const tooLarge = failure === "too-large";
        return (
            <NoItems
                className="file-preview-not-available"
                icon={tooLarge ? "bx bx-file" : "bx bx-error-circle"}
                text={t(tooLarge ? "content_renderer.office_too_large" : "content_renderer.office_render_error")}
            />
        );
    }

    if (preview === null) {
        return (
            <div class="office-preview-loading">
                <LoadingSpinner />
                {t("content_renderer.office_rendering")}
            </div>
        );
    }

    return (
        <div
            ref={bodyRef}
            class="ck-content office-preview-body selectable-text"
            dangerouslySetInnerHTML={{ __html: preview.html }}
        />
    );
}

/**
 * Publishes the `tocDocument` of `note` when it has a ToC format, while the pane shows it. The
 * last state is published again when the pane shows the note again, and cleared on unmount.
 */
function useTocDocumentPublisher(
    note: FNote, noteContext: NoteContext | undefined, isVisible: boolean
) {
    const hasFormat = !!note.type && !!note.mime && !!findTocFormatName(note.type, note.mime);
    const stateRef = useRef<TocDocumentState | null>(null);
    const isShownRef = useRef(false);
    isShownRef.current = hasFormat && isVisible && noteContext?.note?.noteId === note.noteId;

    useEffect(() => {
        if (isShownRef.current && stateRef.current) {
            noteContext?.setContextData("tocDocument", stateRef.current);
        }
    }, [ isVisible ]);

    useEffect(() => () => {
        const state = stateRef.current;
        if (state && noteContext?.getContextData("tocDocument") === state) {
            noteContext.clearContextData("tocDocument");
        }
    }, []);

    return {
        publish(state: TocDocumentState) {
            if (!hasFormat) {
                return;
            }
            stateRef.current = state;
            if (isShownRef.current) {
                noteContext?.setContextData("tocDocument", state);
            }
        }
    };
}

/**
 * The headings that the server marked in the preview in `bodyRef`, read once per preview, and the
 * element that scrolls the preview.
 */
function useMarkedHeadings(
    bodyRef: { current: HTMLElement | null }, preview: RenderedPreview | null
) {
    const [ marked, setMarked ] = useState<{
        headings: MarkedHeading[];
        scrollingContainer: HTMLElement | null;
    }>({ headings: [], scrollingContainer: null });
    useEffect(() => {
        const body = bodyRef.current;
        if (!preview || !body) {
            setMarked({ headings: [], scrollingContainer: null });
            return;
        }
        const marks = body.querySelectorAll<HTMLElement>(`[${TOC_HEADING_ATTRIBUTE}]`);
        setMarked({
            // Entries that land on one element share it; the deepest is the last of its ids.
            headings: Array.from(marks, (element) => ({
                id: element.getAttribute(TOC_HEADING_ATTRIBUTE)?.split(" ").at(-1) ?? "",
                element
            })),
            scrollingContainer: body.closest<HTMLElement>(".note-detail-file")
        });
    }, [ preview ]);
    return marked;
}
