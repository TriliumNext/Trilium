import "./PdfPages.css";

import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import { NoteContextDataMap } from "../../../components/note_context";
import { t } from "../../../services/i18n";
import { useActiveNoteContext, useGetContextData, useNoteProperty } from "../../react/hooks";
import RightPanelWidget from "../RightPanelWidget";

export default function PdfPages() {
    const { note } = useActiveNoteContext();
    const noteType = useNoteProperty(note, "type");
    const noteMime = useNoteProperty(note, "mime");
    const pagesData = useGetContextData("pdfPages");

    if (noteType !== "file" || noteMime !== "application/pdf") {
        return null;
    }

    return (pagesData &&
        <RightPanelWidget id="pdf-pages" title={t("pdf.pages", { count: pagesData?.totalPages || 0 })} grow>
            <PdfPagesList key={note?.noteId} pagesData={pagesData} />
        </RightPanelWidget>
    );
}

function PdfPagesList({ pagesData }: { pagesData: NoteContextDataMap["pdfPages"] }) {
    const [thumbnails, setThumbnails] = useState<Map<number, string>>(new Map());
    const requestedThumbnails = useRef<Set<number>>(new Set());

    useEffect(() => {
        // Listen for thumbnail responses via custom event
        function handleThumbnail(event: CustomEvent) {
            const { pageNumber, dataUrl } = event.detail;
            setThumbnails(prev => new Map(prev).set(pageNumber, dataUrl));
        }

        window.addEventListener("pdf-thumbnail", handleThumbnail as EventListener);
        return () => {
            window.removeEventListener("pdf-thumbnail", handleThumbnail as EventListener);
        };
    }, []);

    const requestThumbnail = useCallback((pageNumber: number) => {
        // Only request if we haven't already requested it and don't have it
        if (!requestedThumbnails.current.has(pageNumber) && !thumbnails.has(pageNumber) && pagesData) {
            requestedThumbnails.current.add(pageNumber);
            pagesData.requestThumbnail(pageNumber);
        }
    }, [pagesData, thumbnails]);

    if (!pagesData || pagesData.totalPages === 0) {
        return <div className="no-pages">No pages available</div>;
    }

    const pages = Array.from({ length: pagesData.totalPages }, (_, i) => i + 1);

    return (
        <div className="pdf-pages-list">
            {pages.map(pageNumber => (
                <PdfPageItem
                    key={pageNumber}
                    pageNumber={pageNumber}
                    isActive={pageNumber === pagesData.currentPage}
                    thumbnail={thumbnails.get(pageNumber)}
                    onRequestThumbnail={requestThumbnail}
                    onPageClick={() => pagesData.scrollToPage(pageNumber)}
                />
            ))}
        </div>
    );
}

function PdfPageItem({
    pageNumber,
    isActive,
    thumbnail,
    onRequestThumbnail,
    onPageClick
}: {
    pageNumber: number;
    isActive: boolean;
    thumbnail?: string;
    onRequestThumbnail(page: number): void;
    onPageClick(): void;
}) {
    const hasRequested = useRef(false);

    useEffect(() => {
        if (!thumbnail && !hasRequested.current) {
            hasRequested.current = true;
            onRequestThumbnail(pageNumber);
        }
    }, [pageNumber, thumbnail, onRequestThumbnail]);

    return (
        <div
            className={`pdf-page-item ${isActive ? 'active' : ''}`}
            onClick={onPageClick}
        >
            <div className="pdf-page-number">{pageNumber}</div>
            <div className="pdf-page-thumbnail">
                {thumbnail ? (
                    <img src={thumbnail} alt={t("pdf.pages_alt", { pageNumber })} />
                ) : (
                    <div className="pdf-page-loading">{t("pdf.pages_loading")}</div>
                )}
            </div>
        </div>
    );
}
