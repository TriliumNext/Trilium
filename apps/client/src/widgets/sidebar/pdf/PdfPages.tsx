import "./PdfPages.css";

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type React from "react";
import { List, type RowComponentProps } from "react-window";

import { NoteContextDataMap } from "../../../components/note_context";
import { t } from "../../../services/i18n";
import { useActiveNoteContext, useGetContextData, useNoteProperty } from "../../react/hooks";
import RightPanelWidget from "../RightPanelWidget";

const ROW_HEIGHT = 180;
const COLUMNS = 2;

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
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerHeight, setContainerHeight] = useState(0);

    useEffect(() => {
        function handleThumbnail(event: CustomEvent) {
            const { pageNumber, dataUrl } = event.detail;
            setThumbnails(prev => new Map(prev).set(pageNumber, dataUrl));
        }

        window.addEventListener("pdf-thumbnail", handleThumbnail as EventListener);
        return () => {
            window.removeEventListener("pdf-thumbnail", handleThumbnail as EventListener);
        };
    }, []);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const observer = new ResizeObserver(([entry]) => {
            setContainerHeight(entry.contentRect.height);
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const requestThumbnail = useCallback((pageNumber: number) => {
        if (!requestedThumbnails.current.has(pageNumber) && !thumbnails.has(pageNumber) && pagesData) {
            requestedThumbnails.current.add(pageNumber);
            pagesData.requestThumbnail(pageNumber);
        }
    }, [pagesData, thumbnails]);

    if (!pagesData || pagesData.totalPages === 0) {
        return <div className="no-pages">No pages available</div>;
    }

    return (
        <div ref={containerRef} className="pdf-pages-list">
            {containerHeight > 0 && (
                <List
                    rowComponent={PdfPageRow}
                    rowCount={Math.ceil(pagesData.totalPages / COLUMNS)}
                    rowHeight={ROW_HEIGHT}
                    rowProps={{
                        totalPages: pagesData.totalPages,
                        thumbnails,
                        currentPage: pagesData.currentPage,
                        requestThumbnail,
                        scrollToPage: pagesData.scrollToPage
                    }}
                    style={{ height: containerHeight }}
                />
            )}
        </div>
    );
}

interface PdfPageRowData {
    totalPages: number;
    thumbnails: Map<number, string>;
    currentPage: number;
    requestThumbnail: (page: number) => void;
    scrollToPage: (page: number) => void;
}

function PdfPageRow({ index, style, ...data }: RowComponentProps<PdfPageRowData>) {
    const { totalPages, thumbnails, currentPage, requestThumbnail, scrollToPage } = data;
    const startPage = index * COLUMNS + 1;
    const pages = Array.from({ length: COLUMNS }, (_, i) => startPage + i).filter(p => p <= totalPages);

    return (
        <div style={style as preact.JSX.CSSProperties} className="pdf-page-row">
            {pages.map(pageNumber => (
                <PdfPageCell
                    key={pageNumber}
                    pageNumber={pageNumber}
                    isActive={pageNumber === currentPage}
                    thumbnail={thumbnails.get(pageNumber)}
                    requestThumbnail={requestThumbnail}
                    scrollToPage={scrollToPage}
                />
            ))}
        </div>
    ) as React.ReactElement;
}

function PdfPageCell({ pageNumber, isActive, thumbnail, requestThumbnail, scrollToPage }: {
    pageNumber: number;
    isActive: boolean;
    thumbnail?: string;
    requestThumbnail: (page: number) => void;
    scrollToPage: (page: number) => void;
}) {
    const hasRequested = useRef(false);

    useEffect(() => {
        if (!thumbnail && !hasRequested.current) {
            hasRequested.current = true;
            requestThumbnail(pageNumber);
        }
    }, [pageNumber, thumbnail, requestThumbnail]);

    return (
        <div
            className={`pdf-page-item ${isActive ? 'active' : ''}`}
            onClick={() => scrollToPage(pageNumber)}
        >
            <div className="pdf-page-thumbnail">
                {thumbnail ? (
                    <img src={thumbnail} alt={t("pdf.pages_alt", { pageNumber })} />
                ) : (
                    <div className="pdf-page-loading">{t("pdf.pages_loading")}</div>
                )}
            </div>
            <div className="pdf-page-number">{pageNumber}</div>
        </div>
    );
}
