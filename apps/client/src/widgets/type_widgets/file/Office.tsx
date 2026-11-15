import { useEffect, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import {
    type OfficePreview, OfficePreviewTooLargeError, renderOfficeToHtml
} from "../../../services/office_renderer";
import LoadingSpinner from "../../react/LoadingSpinner";
import NoItems from "../../react/NoItems";

/**
 * Main-view preview for office documents (DOCX/XLSX/PPTX, ODT/ODS/ODP, RTF and EPUB). Fetches the
 * server-rendered HTML preview and sanitizes it. On failure it shows a placeholder saying whether
 * the document was too large or could not be converted; the file remains downloadable through the
 * usual file note affordances.
 */
export default function OfficePreview({ note }: { note: FNote }) {
    const [preview, setPreview] = useState<OfficePreview | null>(null);
    const [failure, setFailure] = useState<"too-large" | "error" | null>(null);

    useEffect(() => {
        let cancelled = false;
        setPreview(null);
        setFailure(null);

        renderOfficeToHtml("notes", note.noteId)
            .then((result) => {
                if (!cancelled) setPreview(result);
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
        <>
            {/* A spreadsheet's cell styling, which the sanitizer strips out of the markup. Rendered
                as an element with a text child rather than parsed, and unmounted with the preview. */}
            {preview.css && <style>{preview.css}</style>}
            <div class="ck-content office-preview-body selectable-text" dangerouslySetInnerHTML={{ __html: preview.html }} />
        </>
    );
}
