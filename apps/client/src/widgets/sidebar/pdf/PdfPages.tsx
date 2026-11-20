import "./PdfPages.css";

import type { CSSProperties } from "preact";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type React from "react";
import { List, type RowComponentProps, useListRef } from "react-window";

import type { NoteContextDataMap } from "../../../components/note_context";
import { t } from "../../../services/i18n";
import { useFilterState } from "../../react/filter";
import { useNoteProperty } from "../../react/hooks/note";
import { useActiveNoteContext, useGetContextData } from "../../react/hooks/tree";
import { HighlightedText } from "../../react/RawHtml";
import { type OutlineReport, useOutlineReport } from "../outline_filter";
import RightPanelWidget, { NavigatedInNote } from "../RightPanelWidget";
import { showCopyReferenceMenu } from "./PdfAnnotations";

const ROW_HEIGHT = 180;
const COLUMNS = 2;

export default function PdfPages() {
    const { note, noteContext } = useActiveNoteContext();
    const noteType = useNoteProperty(note, "type");
    const noteMime = useNoteProperty(note, "mime");
    const pagesData = useGetContextData("pdfPages");
    const onNavigated = useContext(NavigatedInNote);
    const filter = useFilterState();
    const ready = pagesData?.status === "ready" ? pagesData : undefined;
    const isReady = !!ready;
    const totalPages = ready?.totalPages ?? 0;
    // Page numbers exist only while filtering, as the list counts the pages otherwise.
    const pages = useMemo(() => (filter && isReady ? findPages(totalPages, filter.tokens) : null),
        [ filter, isReady, totalPages ]);

    const firstPage = pages?.[0];
    const scrollToPage = ready?.scrollToPage;
    const activateFirst = useMemo(() => (firstPage !== undefined && scrollToPage
        ? () => {
            scrollToPage(firstPage);
            onNavigated?.();
        }
        : undefined), [ firstPage, scrollToPage, onNavigated ]);
    let report: OutlineReport | null = null;
    if (filter && pagesData) {
        report = pages
            ? { status: "ready", count: pages.length, activateFirst }
            : { status: "loading", navigates: true };
    }
    useOutlineReport("pdf-pages", report);

    if (noteType !== "file" || noteMime !== "application/pdf" || !pagesData) {
        return null;
    }

    return (
        <RightPanelWidget
            id="pdf-pages"
            title={ready ? t("pdf.pages", { count: ready.totalPages }) : t("pdf.pages_title")}
            grow
        >
            {ready ? (
                // Each viewer load starts with no thumbnail and no request.
                <PdfPagesList
                    key={ready.loadToken}
                    pagesData={ready}
                    pages={pages}
                    tokens={filter?.tokens}
                    ntxId={noteContext?.ntxId}
                />
            ) : (
                <div className="pdf-pages-loading">{t("pdf.pages_loading")}</div>
            )}
        </RightPanelWidget>
    );
}

/** The pages whose number holds every term, from the first. */
function findPages(totalPages: number, tokens: string[]) {
    const pages: number[] = [];
    for (let page = 1; page <= totalPages; page++) {
        const text = String(page);
        if (tokens.every((token) => text.includes(token))) {
            pages.push(page);
        }
    }
    return pages;
}

type PdfPagesData = Extract<NoteContextDataMap["pdfPages"], { status: "ready" }>;

interface PdfPagesListProps {
    pagesData: PdfPagesData;
    /** The pages to list, or `null` for every page of the document. */
    pages: number[] | null;
    /** The terms of the filter in force, painted in the page numbers. */
    tokens?: string[];
    ntxId: string | null | undefined;
}

function PdfPagesList({ pagesData, pages, tokens, ntxId }: PdfPagesListProps) {
    const [thumbnails, setThumbnails] = useState<Map<number, string>>(new Map());
    const requestedThumbnails = useRef<Set<number>>(new Set());
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerHeight, setContainerHeight] = useState(0);
    const listRef = useListRef(null);
    const pageCount = pages ? pages.length : pagesData.totalPages;

    // Another set of pages starts at the top of the list.
    useEffect(() => {
        if (pageCount > 0) {
            listRef.current?.scrollToRow({ index: 0 });
        }
    }, [ pages, pageCount, listRef ]);

    useEffect(() => {
        function handleThumbnail(event: CustomEvent) {
            // Another open PDF renders onto the same window, and another load of this one
            // showed another document; their pages are not these.
            const { detail } = event;
            if (detail.ntxId !== ntxId || detail.loadToken !== pagesData.loadToken) return;
            const { pageNumber, dataUrl } = event.detail;
            setThumbnails(prev => new Map(prev).set(pageNumber, dataUrl));
        }

        window.addEventListener("pdf-thumbnail", handleThumbnail as EventListener);
        return () => {
            window.removeEventListener("pdf-thumbnail", handleThumbnail as EventListener);
        };
    }, [ ntxId, pagesData.loadToken ]);

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
        if (!requestedThumbnails.current.has(pageNumber) && !thumbnails.has(pageNumber)) {
            requestedThumbnails.current.add(pageNumber);
            pagesData.requestThumbnail(pageNumber);
        }
    }, [pagesData, thumbnails]);

    if (pagesData.totalPages === 0) {
        return <div className="no-pages">No pages available</div>;
    }

    return (
        <div ref={containerRef} className="pdf-pages-list">
            {containerHeight > 0 && (
                <List
                    listRef={listRef}
                    rowComponent={PdfPageRow}
                    rowCount={Math.ceil(pageCount / COLUMNS)}
                    rowHeight={ROW_HEIGHT}
                    rowProps={{
                        totalPages: pagesData.totalPages,
                        pages,
                        tokens,
                        thumbnails,
                        currentPage: pagesData.currentPage,
                        requestThumbnail,
                        scrollToPage: pagesData.scrollToPage,
                        copyReference: pagesData.copyReference
                    }}
                    style={{ height: `${containerHeight}px` }}
                />
            )}
        </div>
    );
}

interface PdfPageRowData {
    totalPages: number;
    /** The pages listed, or `null` for every page. */
    pages: number[] | null;
    tokens?: string[];
    thumbnails: Map<number, string>;
    currentPage: number;
    requestThumbnail: (page: number) => void;
    scrollToPage: (page: number) => void;
    copyReference: (page: number) => void;
}

function PdfPageRow({ index, style, ...data }: RowComponentProps<PdfPageRowData>) {
    const { totalPages, thumbnails, currentPage, requestThumbnail, scrollToPage, copyReference } = data;
    const startIndex = index * COLUMNS;
    const rowPages = data.pages
        ? data.pages.slice(startIndex, startIndex + COLUMNS)
        : Array.from({ length: COLUMNS }, (_, i) => startIndex + i + 1)
            .filter(p => p <= totalPages);

    return (
        <div style={style as CSSProperties} className="pdf-page-row">
            {rowPages.map(pageNumber => (
                <PdfPageCell
                    key={pageNumber}
                    pageNumber={pageNumber}
                    isActive={pageNumber === currentPage}
                    thumbnail={thumbnails.get(pageNumber)}
                    requestThumbnail={requestThumbnail}
                    scrollToPage={scrollToPage}
                    copyReference={copyReference}
                    tokens={data.tokens}
                />
            ))}
        </div>
    ) as React.ReactElement;
}

interface PdfPageCellProps {
    pageNumber: number;
    isActive: boolean;
    thumbnail?: string;
    requestThumbnail: (page: number) => void;
    scrollToPage: (page: number) => void;
    copyReference: (page: number) => void;
    tokens?: string[];
}

function PdfPageCell({
    pageNumber, isActive, thumbnail, requestThumbnail, scrollToPage, copyReference, tokens
}: PdfPageCellProps) {
    const hasRequested = useRef(false);
    const onNavigated = useContext(NavigatedInNote);

    useEffect(() => {
        if (!thumbnail && !hasRequested.current) {
            hasRequested.current = true;
            requestThumbnail(pageNumber);
        }
    }, [pageNumber, thumbnail, requestThumbnail]);

    return (
        <div
            className={`pdf-page-item ${isActive ? 'active' : ''}`}
            onClick={() => {
                scrollToPage(pageNumber);
                onNavigated?.();
            }}
            onContextMenu={(e) => showCopyReferenceMenu(e, () => copyReference(pageNumber))}
        >
            <div className="pdf-page-thumbnail">
                {thumbnail ? (
                    <img src={thumbnail} alt={t("pdf.pages_alt", { pageNumber })} />
                ) : (
                    <div className="pdf-page-loading">{t("pdf.pages_loading")}</div>
                )}
            </div>
            <HighlightedText
                className="pdf-page-number"
                text={String(pageNumber)}
                highlightedTokens={tokens}
            />
        </div>
    );
}
