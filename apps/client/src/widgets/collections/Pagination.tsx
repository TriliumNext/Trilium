import { ComponentChildren } from "preact";
import { Dispatch, StateUpdater, useEffect, useState } from "preact/hooks";
import FNote from "../../entities/fnote";
import froca from "../../services/froca";
import { useNoteLabelInt } from "../react/hooks";
import { t } from "../../services/i18n";
import ActionButton from "../react/ActionButton";
import Button from "../react/Button";

interface PaginationContext {
    page: number;
    setPage: Dispatch<StateUpdater<number>>;
    pageNotes?: FNote[];
    pageCount: number;
    pageSize: number;
    totalNotes: number;
}

export function Pager({ page, pageSize, setPage, pageCount, totalNotes }: Omit<PaginationContext, "pageNotes">) {
    if (pageCount < 2) return;

    const children = createPageButtons(page, setPage, pageCount);

    return (
        <div class="note-list-pager">
            <ActionButton
                icon="bx bx-caret-left"
                disabled={(page === 1)}
                text={t("pagination.prev_page")}
                onClick={() => {setPage(page - 1)}}
            />

            {children}
            
            <ActionButton
                icon="bx bx-caret-right"
                disabled={(page === pageCount)}
                text={t("pagination.next_page")}
                onClick={() => {setPage(page + 1)}}
            />
            <span className="note-list-pager-total-count">({t("pagination.total_notes", { count: totalNotes })})</span>
        </div>
    )
}

function createPageButtons(page: number, setPage: Dispatch<StateUpdater<number>>, pageCount: number): ComponentChildren[] {
    const maxButtonCount = 9;
    const maxLeftRightSegmentLength = 2;
    
    // The left-side segment
    const leftLength = Math.min(pageCount, maxLeftRightSegmentLength);
    const leftStart = 1;

    // The middle segment
    const middleMaxLength = maxButtonCount - maxLeftRightSegmentLength * 2;
    const middleLength = Math.min(pageCount - leftLength, middleMaxLength);
    let middleStart = page - Math.floor(middleLength / 2);
    middleStart = Math.max(middleStart, leftLength + 1);

    // The right-side segment
    const rightLength = Math.min(pageCount - (middleLength + leftLength), maxLeftRightSegmentLength);
    const rightStart = pageCount - rightLength + 1;
    middleStart = Math.min(middleStart, rightStart - middleLength);

    return [
        ...createSegment(leftStart, leftLength, page, setPage, false),
        ...createSegment(middleStart, middleLength, page, setPage, (middleStart - leftLength > 1)),
        ...createSegment(rightStart, rightLength, page, setPage, (rightStart - (middleStart + middleLength - 1) > 1)),
    ];

}

function createSegment(start: number, length: number, currentPage: number, setPage: Dispatch<StateUpdater<number>>, prependEllipsis: boolean): ComponentChildren[] {
    const children: ComponentChildren[] = [];
    
    if (prependEllipsis) {
        children.push("...");
    }

    for (let i = 0; i < length; i++) {
        const pageNum = start + i;

        children.push((
            <Button
                text={pageNum.toString()}
                disabled={(pageNum === currentPage)}
                onClick={() => setPage(pageNum)}
            />
        ));
    }

    return children;
}

export function usePagination(note: FNote, noteIds: string[]): PaginationContext {
    const [ page, setPage ] = useState(1);
    const [ pageNotes, setPageNotes ] = useState<FNote[]>();

    // Parse page size.
    const [ pageSize ] = useNoteLabelInt(note, "pageSize");
    const normalizedPageSize = (pageSize && pageSize > 0 ? pageSize : 20);

    // Calculate start/end index.
    const startIdx = (page - 1) * normalizedPageSize;
    const endIdx = startIdx + normalizedPageSize;
    const pageCount = Math.ceil(noteIds.length / normalizedPageSize);

    // Obtain notes within the range.
    const pageNoteIds = noteIds.slice(startIdx, Math.min(endIdx, noteIds.length));

    useEffect(() => {
        froca.getNotes(pageNoteIds).then(setPageNotes);
    }, [ note, noteIds, page, pageSize ]);

    return {
        page, setPage, pageNotes, pageCount,
        pageSize: normalizedPageSize,
        totalNotes: noteIds.length
    };
}
