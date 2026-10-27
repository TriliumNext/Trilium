import "./SearchResultsList.css";

import type { HighlightedTokenInfo } from "@triliumnext/commons";
import clsx from "clsx";
import { useMemo } from "preact/hooks";

import type FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import CollectionProperties from "../../note_bars/CollectionProperties";
import FormSelect from "../../react/FormSelect";
import { useTriliumEvent, useTriliumOptionInt } from "../../react/hooks";
import { Pager, usePagination } from "../Pagination";
import SearchResultCard from "./SearchResultCard";
import { useSearchResultDetails } from "./useSearchResultDetails";

interface SearchResultsListProps {
    note: FNote;
    noteIds: string[];
    highlightedTokens?: (string | HighlightedTokenInfo)[] | null;
    ntxId?: string | null;
    showTextRepresentation?: boolean;
}

/**
 * Google-style snippet-card view for the results of a search note (issues #5667, #6225), shown as
 * the "search preview" view type.
 *
 * Composition mirrors the legacy list view's collection bar (`CollectionProperties` with a centered
 * pager) but adds an always-visible result count and a page-size selector, then renders one
 * {@link SearchResultCard} per note on the current page plus a bottom pager. The per-note snippet
 * details are fetched lazily, one page at a time, via {@link useSearchResultDetails}.
 */
export default function SearchResultsList({ note, noteIds, ntxId, highlightedTokens, showTextRepresentation }: SearchResultsListProps) {
    const [ pageSize, setPageSize ] = useTriliumOptionInt("searchResultsPageSize");
    const pagination = usePagination(note, noteIds, { defaultPageSize: pageSize });
    const pageNoteIds = useMemo(() => {
        const start = (pagination.page - 1) * pagination.pageSize;
        return noteIds.slice(start, start + pagination.pageSize);
    }, [ noteIds, pagination.page, pagination.pageSize ]);
    const { detailsByNoteId, loading } = useSearchResultDetails(note, pageNoteIds, ntxId);

    // A new search starts on the first page of its results.
    useTriliumEvent("searchRefreshed", ({ ntxId: eventNtxId }) => {
        if (eventNtxId === ntxId) {
            pagination.setPage(1);
        }
    });

    return (
        <div className="search-results-list note-list">
            <CollectionProperties
                note={note}
                centerChildren={<Pager className="search-results-list-top-pager" {...pagination} />}
                rightChildren={
                    <SearchResultsToolbar
                        count={pagination.totalNotes}
                        pageSize={pagination.pageSize}
                        setPageSize={setPageSize}
                    />
                }
            />

            <div className="search-results-list-cards note-list-container search-results">
                {pageNoteIds.map((noteId) => (
                    <SearchResultCard
                        key={noteId}
                        noteId={noteId}
                        details={detailsByNoteId.get(noteId)}
                        loading={loading}
                        highlightedTokens={highlightedTokens}
                        showTextRepresentation={showTextRepresentation}
                    />
                ))}
            </div>

            <Pager className="search-results-list-bottom-pager" {...pagination} />
        </div>
    );
}

const PAGE_SIZE_OPTIONS = [ 10, 20, 50, 100 ].map((value) => ({ value: String(value) }));

export function SearchResultsToolbar({ count, pageSize, setPageSize }: {
    count: number;
    pageSize: number;
    setPageSize: (value: number) => void | Promise<void>;
}) {
    return (
        <div className="search-results-list-toolbar">
            <span className="search-results-list-count">{t("search_result.result_count", { count })}</span>
            <label className="search-results-list-page-size">
                <span className="search-results-list-page-size-label">{t("search_result.page_size")}</span>
                <FormSelect
                    values={PAGE_SIZE_OPTIONS}
                    keyProperty="value"
                    currentValue={String(pageSize)}
                    onChange={(value) => void setPageSize(parseInt(value, 10))}
                />
            </label>
        </div>
    );
}
