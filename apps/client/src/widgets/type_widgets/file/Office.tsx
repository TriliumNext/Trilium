import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import type NoteContext from "../../../components/note_context";
import FNote from "../../../entities/fnote";
import { showDocumentTarget, takeDocumentTarget } from "../../../services/bookmark_jump";
import { t } from "../../../services/i18n";
import {
    type OfficePreview, OfficePreviewTooLargeError, renderOfficeToHtml
} from "../../../services/office_renderer";
import { useSameNoteSwitch } from "../../react/hooks/note_context";
import LoadingSpinner from "../../react/LoadingSpinner";
import NoItems from "../../react/NoItems";

/** A preview, and the note and blob it was rendered from. */
interface RenderedPreview extends OfficePreview {
    noteId: string;
    blobId: string | undefined;
}

/**
 * Main-view preview for office documents (DOCX/PPTX, ODT/ODS/ODP, RTF and EPUB, and an XLSX file
 * that cannot be read as a workbook). Fetches the server-rendered HTML preview and sanitizes it.
 * On failure it shows a placeholder saying whether the document was too large or could not be
 * converted; the file remains downloadable through the usual file note affordances.
 *
 * A link to a heading or a bookmark of the document lands once the preview of the blob that the
 * note context shows is in place; until then, the view scope holds it.
 */
export default function OfficePreview({ note, noteContext, isVisible }: {
    note: FNote;
    noteContext?: NoteContext;
    /** False while `NoteDetail` keeps the preview mounted but the pane shows another note. */
    isVisible?: boolean;
}) {
    const [preview, setPreview] = useState<RenderedPreview | null>(null);
    const [failure, setFailure] = useState<"too-large" | "error" | null>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const isVisibleRef = useRef(isVisible);
    isVisibleRef.current = isVisible;
    const previewRef = useRef(preview);
    previewRef.current = preview;

    useEffect(() => {
        let cancelled = false;
        const { noteId, blobId } = note;
        setPreview(null);
        setFailure(null);

        renderOfficeToHtml("notes", noteId)
            .then((result) => {
                if (!cancelled) setPreview({ ...result, noteId, blobId });
            })
            .catch((e) => {
                const tooLarge = e instanceof OfficePreviewTooLargeError;
                if (!tooLarge) console.warn("Failed to render office document preview:", e);
                if (!cancelled) setFailure(tooLarge ? "too-large" : "error");
            });

        return () => {
            cancelled = true;
        };
    }, [note.noteId, note.blobId]);

    /** Lands on the target of the latest link, once the preview of the shown blob is in place. */
    function revealLinkTarget() {
        const body = bodyRef.current;
        const rendered = previewRef.current;
        const shown = noteContext?.note;
        if (!body || !rendered || isVisibleRef.current === false
            || rendered.noteId !== shown?.noteId || rendered.blobId !== shown.blobId) {
            return;
        }
        const target = takeDocumentTarget(noteContext?.viewScope);
        if (target) {
            void showDocumentTarget(body, target);
        }
    }

    useLayoutEffect(revealLinkTarget, [preview]);
    useEffect(() => {
        if (isVisible !== false) revealLinkTarget();
    }, [isVisible]);
    useSameNoteSwitch(note, noteContext?.ntxId, revealLinkTarget);

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
