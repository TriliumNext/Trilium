import { useEffect, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import { renderOfficeToHtml } from "../../../services/office_renderer";
import Alert from "../../react/Alert";
import LoadingSpinner from "../../react/LoadingSpinner";

/**
 * Main-view preview for office documents (DOCX/XLSX/PPTX, ODT/ODS/ODP and RTF). Fetches the
 * server-rendered HTML preview and sanitizes it. Falls back to the standard "preview not
 * available" notice on failure (the file remains downloadable through the usual file note
 * affordances).
 */
export default function OfficePreview({ note }: { note: FNote }) {
    const [html, setHtml] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setHtml(null);
        setFailed(false);

        renderOfficeToHtml("notes", note.noteId)
            .then((result) => {
                if (!cancelled) setHtml(result);
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

    if (html === null) {
        return (
            <div class="office-preview-loading">
                <LoadingSpinner />
                {t("content_renderer.office_rendering")}
            </div>
        );
    }

    return <div class="ck-content office-preview-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
