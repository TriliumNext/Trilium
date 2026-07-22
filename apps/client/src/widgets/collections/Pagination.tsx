import { ComponentChildren } from "preact";
import { Dispatch, StateUpdater, useEffect, useState } from "preact/hooks";
import FNote from "../../entities/fnote";
import froca from "../../services/froca";
import { useNoteLabelInt } from "../react/hooks";
import { t } from "../../services/i18n";
import ActionButton from "../react/ActionButton";
import Button from "../react/Button";
import "./Pagination.css";
import clsx from "clsx";

export interface PaginationContext {
    className?: string;
    page: number;
    setPage: Dispatch<StateUpdater<number>>;
    pageNotes?: FNote[];
    pageCount: number;
    pageSize: number;
    totalNotes: number;
}

export function Pager({ className, page, pageSize, setPage, pageCount, totalNotes }: Omit<PaginationContext, "pageNotes">) {
    if (pageCount < 2) return;

    return (
        <div className={clsx("note-list-pager-container", className)}>
            <div className="note-list-pager">
                <ActionButton
                    icon="bx bx-chevron-left"
                    className="note-list-pager-nav-button"
                    disabled={(page === 1)}
                    text={t("pagination.prev_page")}
                    onClick={() => setPage(page - 1)}
                />

                <PageButtons page={page} setPage={setPage} pageCount={pageCount} />
                <div className="note-list-pager-narrow-counter">
                    <strong>{page}</strong> / <strong>{pageCount}</strong>
                </div>
                            
                <ActionButton
                    icon="bx bx-chevron-right"
                    className="note-list-pager-nav-button"
                    disabled={(page === pageCount)}
                    text={t("pagination.next_page")}
                    onClick={() => setPage(page + 1)}
                />

                <div className="note-list-pager-total-count">
                    {t("pagination.total_notes", { count: totalNotes })}
                </div>
            </div>
        </div>
    )
}

interface PageButtonsProps {
    page: number;
    setPage: Dispatch<StateUpdater<number>>;
    pageCount: number;
}

function PageButtons(props: PageButtonsProps) {
    const maxButtonCount = 9;
    const maxLeftRightSegmentLength = 2;
    
    // The left-side segment
    const leftLength = Math.min(props.pageCount, maxLeftRightSegmentLength);
    const leftStart = 1;

    // The middle segment
    const middleMaxLength = maxButtonCount - maxLeftRightSegmentLength * 2;
    const middleLength = Math.min(props.pageCount - leftLength, middleMaxLength);
    let middleStart = props.page - Math.floor(middleLength / 2);
    middleStart = Math.max(middleStart, leftLength + 1);

    // The right-side segment
    const rightLength = Math.min(props.pageCount - (middleLength + leftLength), maxLeftRightSegmentLength);
    const rightStart = props.pageCount - rightLength + 1;
    middleStart = Math.min(middleStart, rightStart - middleLength);

    const totalButtonCount = leftLength + middleLength + rightLength;
    const hasLeadingEllipsis =  (middleStart - leftLength > 1);
    const hasTrailingEllipsis = (rightStart - (middleStart + middleLength - 1) > 1);

    return <div className={clsx("note-list-pager-page-button-container", {
                    "note-list-pager-ellipsis-present": (totalButtonCount === maxButtonCount)
                })}
                style={{"--note-list-pager-page-button-count": totalButtonCount}}>
        {[
            ...createSegment(leftStart, leftLength, props.page, props.setPage, false),
            ...createSegment(middleStart, middleLength, props.page, props.setPage, hasLeadingEllipsis),
            ...createSegment(rightStart, rightLength, props.page, props.setPage, hasTrailingEllipsis),
        ]}
    </div>;
}

function createSegment(start: number, length: number, currentPage: number, setPage: Dispatch<StateUpdater<number>>, prependEllipsis: boolean): ComponentChildren[] {
    const children: ComponentChildren[] = [];
    
    if (prependEllipsis) {
        children.push(<span className="note-list-pager-ellipsis">...</span>);
    }

    for (let i = 0; i < length; i++) {
        const pageNum = start + i;
        const isCurrent = (pageNum === currentPage);
        children.push((
            <Button
                text={pageNum.toString()}
                kind="lowProfile"
                className={clsx(
                    "note-list-pager-page-button",
                    {"note-list-pager-page-button-current": isCurrent}
                )}
                disabled={isCurrent}
                onClick={() => setPage(pageNum)}
            />
        ));
    }

    return children;
}

export function usePagination(note: FNote, noteIds: string[], defaultPageSize = 20): PaginationContext {
    const [ page, setPage ] = useState(1);
    const [ pageNotes, setPageNotes ] = useState<FNote[]>();

    // Parse page size. An explicit `#pageSize` label always wins; otherwise fall back to the
    // caller-supplied default (e.g. the synced `searchResultsPageSize` option), and finally to 20
    // when neither yields a usable positive size.
    const [ labelPageSize ] = useNoteLabelInt(note, "pageSize");
    const normalizedPageSize = (labelPageSize && labelPageSize > 0)
        ? labelPageSize
        : (defaultPageSize > 0 ? defaultPageSize : 20);

    // Calculate start/end index.
    const startIdx = (page - 1) * normalizedPageSize;
    const endIdx = startIdx + normalizedPageSize;
    const pageCount = Math.ceil(noteIds.length / normalizedPageSize);

    // If the page size grows (or the result set shrinks) enough that the current page no longer
    // exists, step back onto the last valid page so the slice below can't silently yield an empty
    // page. A no-op in steady state, so existing list/grid callers are unaffected.
    useEffect(() => {
        if (pageCount > 0 && page > pageCount) {
            setPage(pageCount);
        }
    }, [ page, pageCount ]);

    // Obtain notes within the range.
    const pageNoteIds = noteIds.slice(startIdx, Math.min(endIdx, noteIds.length));

    useEffect(() => {
        froca.getNotes(pageNoteIds).then(setPageNotes);
    }, [ note, noteIds, page, normalizedPageSize ]);

    return {
        page, setPage, pageNotes, pageCount,
        pageSize: normalizedPageSize,
        totalNotes: noteIds.length
    };
}
