import { ComponentChildren } from "preact";
import { Dispatch, StateUpdater, useEffect, useState } from "preact/hooks";
import FNote from "../../entities/fnote";
import froca from "../../services/froca";
import { useNoteLabel } from "../react/hooks";
import { t } from "../../services/i18n";

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

    let lastPrinted = false;
    let children: ComponentChildren[] = [];
    for (let i = 1; i <= pageCount; i++) {
        if (pageCount < 20 || i <= 5 || pageCount - i <= 5 || Math.abs(page - i) <= 2) {
            lastPrinted = true;

            const startIndex = (i - 1) * pageSize + 1;
            const endIndex = Math.min(totalNotes, i * pageSize);

            if (i !== page) {
                children.push((
                    <a
                        href="javascript:"
                        title={t("pagination.page_title", { startIndex, endIndex })}
                        onClick={() => setPage(i)}
                    >
                    {i}
                    </a>
                ))
            } else {
                // Current page
                children.push(<span className="current-page">{i}</span>)
            }

            children.push(<>{" "}&nbsp;{" "}</>);
        } else if (lastPrinted) {
            children.push(<>{"... "}&nbsp;{" "}</>);
            lastPrinted = false;
        }
    }

    return (
        <div class="note-list-pager">
            {children}

            <span className="note-list-pager-total-count">({t("pagination.total_notes", { count: totalNotes })})</span>
        </div>
    )
}

export function usePagination(note: FNote, noteIds: string[]): PaginationContext {
    const [ page, setPage ] = useState(1);
    const [ pageNotes, setPageNotes ] = useState<FNote[]>();

    // Parse page size.
    const [ pageSize ] = useNoteLabel(note, "pageSize");
    const pageSizeNum = parseInt(pageSize ?? "", 10);
    const normalizedPageSize = (pageSizeNum && pageSizeNum > 0 ? pageSizeNum : 20);

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
