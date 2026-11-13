import { useEffect, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import { type OfficePreview, renderOfficeToHtml } from "../../../services/office_renderer";
import Alert from "../../react/Alert";
import LoadingSpinner from "../../react/LoadingSpinner";

/**
 * Main-view preview for office documents (DOCX/PPTX, ODT/ODS/ODP, RTF and EPUB, and an XLSX file
 * that cannot be read as a workbook). Fetches the server-rendered HTML preview and sanitizes it.
 * Falls back to the standard "preview not available" notice on failure (the file remains
 * downloadable through the usual file note affordances).
 */
export default function OfficePreview({ note }: { note: FNote }) {
    const [preview, setPreview] = useState<OfficePreview | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setPreview(null);
        setFailed(false);

        renderOfficeToHtml("notes", note.noteId)
            .then((result) => {
                if (!cancelled) setPreview(result);
            })
            .catch((e) => {
                console.warn("Failed to render office document preview:", e);
                if (!cancelled) setFailed(true);
            });

        return () => {
            cancelled = true;
        };
    }, [note.noteId, note.blobId]);

    if (failed) {
        return (
            <Alert className="file-preview-not-available" type="info">
                {t("file.file_preview_not_available")}
            </Alert>
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

    return <div class="ck-content office-preview-body selectable-text" dangerouslySetInnerHTML={{ __html: preview.html }} />;
}
