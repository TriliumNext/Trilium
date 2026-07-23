import "./SearchResultsList.css";

import type { HighlightedTokenInfo } from "@triliumnext/commons";
import { useMemo } from "preact/hooks";

import type FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import CollectionProperties from "../../note_bars/CollectionProperties";
import FormSelect from "../../react/FormSelect";
import { useTriliumOptionInt } from "../../react/hooks";
import { ViewModeMedia } from "../interface";
import { useNoteIds } from "../NoteList";
import { Pager, usePagination } from "../Pagination";
import SearchResultCard from "./SearchResultCard";
import { useSearchResultDetails } from "./useSearchResultDetails";

interface SearchResultsListProps {
    note: FNote | null | undefined;
    notePath: string | null | undefined;
    ntxId: string | null | undefined;
    highlightedTokens?: (string | HighlightedTokenInfo)[] | null;
    media: ViewModeMedia;
}

/**
 * Google-style snippet-card view for the results of a search note (issues #5667, #6225). Used only
 * for the "list" view type; other view types keep going through the legacy `SearchNoteList` path.
 *
 * Composition mirrors the legacy list view's collection bar (`CollectionProperties` with a centered
 * pager) but adds an always-visible result count and a page-size selector, then renders one
 * {@link SearchResultCard} per note on the current page plus a bottom pager. The per-note snippet
 * details are fetched lazily, one page at a time, via {@link useSearchResultDetails}.
 */
export default function SearchResultsList({ note, ntxId, highlightedTokens }: SearchResultsListProps) {
    // The results view only mounts for an executed search note; guard here so the inner component
    // (and the collection hooks it drives) can rely on a non-null note.
    if (!note) return null;
    return <SearchResultsListInner note={note} ntxId={ntxId} highlightedTokens={highlightedTokens} />;
}

// Only the props the card view actually consumes; `media`/`notePath` from the shared collection-view
// shape are unused here, so they are not threaded into the inner component.
interface SearchResultsListInnerProps {
    note: FNote;
    ntxId: string | null | undefined;
    highlightedTokens?: (string | HighlightedTokenInfo)[] | null;
}

function SearchResultsListInner({ note, ntxId, highlightedTokens }: SearchResultsListInnerProps) {
    const [ pageSize, setPageSize ] = useTriliumOptionInt("searchResultsPageSize");
    const noteIds = useNoteIds(note, "list", ntxId);
    const pagination = usePagination(note, noteIds, pageSize);
    const pageNoteIds = useMemo(() => {
        const start = (pagination.page - 1) * pagination.pageSize;
        return noteIds.slice(start, start + pagination.pageSize);
    }, [ noteIds, pagination.page, pagination.pageSize ]);
    const { detailsByNoteId, loading } = useSearchResultDetails(note, pageNoteIds, ntxId);

    return (
        <div className="search-results-list">
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

            <div className="search-results-list-cards">
                {pageNoteIds.map((noteId) => (
                    <SearchResultCard
                        key={noteId}
                        noteId={noteId}
                        details={detailsByNoteId.get(noteId)}
                        loading={loading}
                        highlightedTokens={highlightedTokens}
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
