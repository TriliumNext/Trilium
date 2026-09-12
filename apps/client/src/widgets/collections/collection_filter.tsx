import "./collection_filter.css";

import type { HighlightedTokenInfo } from "@triliumnext/commons";
import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import FNote from "../../entities/fnote";
import { t } from "../../services/i18n";
import type LoadResults from "../../services/load_results";
import searchService from "../../services/search";
import ActionButton from "../react/ActionButton";
import FormTextBox from "../react/FormTextBox";
import { useTriliumEvent } from "../react/hooks";

/** How long to wait after a change before re-running the active filter. */
const RERUN_DEBOUNCE_MS = 300;

export interface CollectionFilter {
    /** The submitted query, empty while no filter is active. */
    query: string;
    /** The notes to draw, or null while no filter is active. Matches plus {@link keptNoteIds}. */
    shownNoteIds: Set<string> | null;
    /** Of those, the ones the query does not match, drawn because they were just made here. */
    keptNoteIds: Set<string>;
    /** The tokens the matches were found by, for highlighting them where the notes are drawn. */
    highlightedTokens: HighlightedTokenInfo[] | null;
    /** What is wrong with the query, or null. An erroneous query keeps the previous matches. */
    error: string | null;
    /**
     * Whether a stored query is still being resolved, for the view to hold its first draw on. Only
     * a stored one: a query submitted later narrows a collection that is already on screen.
     */
    isResolvingStoredQuery: boolean;
    /** Draws a note the query does not match, until the query is changed. */
    keepNote: (noteId: string) => void;
    setQuery: (query: string) => void;
}

interface FilterMatches {
    matchedNoteIds: Set<string> | null;
    highlightedTokens: HighlightedTokenInfo[] | null;
}

const NO_MATCHES: FilterMatches = { matchedNoteIds: null, highlightedTokens: null };
const NOTHING_KEPT: Set<string> = new Set();

/**
 * Narrows a collection to the notes matching a search query, using the full search syntax.
 * The result is a membership set, not an order: a view keeps its own enumeration.
 */
export function useCollectionFilter(note: FNote, {
    persistedQuery, onQueryChanged, collectionNoteIds
}: {
    /** The stored query the filter starts from, so it survives reopening the collection. */
    persistedQuery: string | undefined;
    /** Reports a submitted query, for the view to persist. Called with "" when cleared. */
    onQueryChanged: (query: string) => void;
    /** The notes the collection shows, deciding which entity changes re-run the filter. */
    collectionNoteIds: string[];
}): CollectionFilter {
    const [ query, setQuery ] = useState(persistedQuery ?? "");
    const [ matches, setMatches ] = useState<FilterMatches>(NO_MATCHES);
    const [ error, setError ] = useState<string | null>(null);
    // Set before anything is drawn, so a collection opened onto a stored query waits for its
    // matches instead of drawing every note and then taking most of them away.
    const [ isResolvingStoredQuery, setIsResolvingStoredQuery ] =
        useState(() => !!persistedQuery?.trim());
    // Notes made in the collection while it is narrowed, drawn until the query changes. A re-run
    // does not take them away: a note made here and not shown would look like nothing happened.
    const [ keptNoteIds, setKeptNoteIds ] = useState(NOTHING_KEPT);
    // A run resolves on the server, so an older one can land after a newer one. Only the latest
    // run sets the result.
    const runSeqRef = useRef(0);
    const rerunTimerRef = useRef<number>();
    const previousNoteIdRef = useRef(note.noteId);
    const collectionSet = useMemo(() => new Set(collectionNoteIds), [ collectionNoteIds ]);
    const collectionSetRef = useRef(collectionSet);
    collectionSetRef.current = collectionSet;

    async function run(activeQuery: string) {
        const seq = ++runSeqRef.current;
        let response;
        try {
            response = await searchService.searchInSubtree(activeQuery, note.noteId);
        } catch (e) {
            console.error("Failed to run the collection filter:", e);
            if (seq === runSeqRef.current) {
                setError(t("collection_filter.fetch-error"));
                setIsResolvingStoredQuery(false);
            }
            return;
        }

        if (seq !== runSeqRef.current) {
            return;
        }

        // The wait is over whatever the run came back with: a stored query that cannot be run must
        // not hold the collection back from being drawn.
        setIsResolvingStoredQuery(false);

        if (response.error) {
            // The previous matches stay shown: a broken query must not blank the collection.
            setError(response.error);
            return;
        }

        setError(null);
        setMatches({
            matchedNoteIds: new Set(response.searchResultNoteIds),
            highlightedTokens: response.highlightedTokens
        });
    }

    // Adopt a query stored elsewhere: the persisted one on mount, or one another view submitted.
    useEffect(() => {
        setQuery(persistedQuery ?? "");

        // A different collection brings its own stored query, so the wait is armed again for it.
        // Not for a query submitted here, which also arrives as a new `persistedQuery`.
        if (previousNoteIdRef.current !== note.noteId) {
            previousNoteIdRef.current = note.noteId;
            setIsResolvingStoredQuery(!!persistedQuery?.trim());
        }
    }, [ note.noteId, persistedQuery ]);

    // Resolve the submitted query, or drop the filter when it is cleared. What was kept goes with
    // the query it was kept against: a new one is asked afresh which notes belong.
    useEffect(() => {
        window.clearTimeout(rerunTimerRef.current);
        setKeptNoteIds(NOTHING_KEPT);
        if (!query.trim()) {
            runSeqRef.current++;
            setError(null);
            setMatches(NO_MATCHES);
            setIsResolvingStoredQuery(false);
            return;
        }
        run(query);
    }, [ note.noteId, query ]);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        const collection = collectionSetRef.current;
        if (!query.trim() || !touchesCollection(loadResults, collection, note.noteId)) {
            return;
        }
        window.clearTimeout(rerunTimerRef.current);
        rerunTimerRef.current = window.setTimeout(() => run(query), RERUN_DEBOUNCE_MS);
    });

    useEffect(() => () => window.clearTimeout(rerunTimerRef.current), []);

    // Only what the query does not match, so a note that comes to match it on a later run stops
    // being drawn on sufferance and is no longer marked as outside the filter. Nothing stands
    // outside a filter that is not there, whatever the collection has reported in the meantime.
    const stillKept = useMemo(
        () => (matches.matchedNoteIds
            ? new Set([ ...keptNoteIds ].filter(id => !matches.matchedNoteIds?.has(id)))
            : NOTHING_KEPT),
        [ keptNoteIds, matches.matchedNoteIds ]);
    const shownNoteIds = useMemo(
        () => (matches.matchedNoteIds
            ? new Set([ ...matches.matchedNoteIds, ...stillKept ])
            : null),
        [ matches.matchedNoteIds, stillKept ]);

    return {
        query,
        shownNoteIds,
        keptNoteIds: stillKept,
        highlightedTokens: matches.highlightedTokens,
        error,
        isResolvingStoredQuery,
        keepNote: (noteId: string) => setKeptNoteIds(kept => (!query.trim() || kept.has(noteId)
            ? kept
            : new Set(kept).add(noteId))),
        setQuery: (newQuery: string) => {
            const trimmed = newQuery.trim();
            setQuery(trimmed);
            onQueryChanged(trimmed);
        }
    };
}

/**
 * The filter box for a collection header. Enter or the search button submits what is typed, which
 * is held here until then so an unrelated redraw cannot apply a half-typed query. The clear button
 * stands only while a filter is in force, since that is what it takes away.
 */
export function CollectionFilterInput({ filter, placeholder }: {
    filter: CollectionFilter;
    /** Names the collection being filtered, for a view that has a word for what it holds. */
    placeholder?: string;
}) {
    const [ typed, setTyped ] = useState(filter.query);
    const inputRef = useRef<HTMLInputElement>(null);

    // Adopt a query submitted elsewhere, or the stored one arriving on mount.
    useEffect(() => setTyped(filter.query), [ filter.query ]);

    const isActive = !!filter.query;

    return (
        <div className={clsx("collection-filter", { active: isActive })}>
            <FormTextBox
                inputRef={inputRef}
                currentValue={typed}
                placeholder={placeholder ?? t("collection_filter.placeholder")}
                // A placeholder names the box only until something is typed into it.
                aria-label={placeholder ?? t("collection_filter.placeholder")}
                onChange={setTyped}
                onKeyDown={(e: KeyboardEvent) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        filter.setQuery(typed);
                    } else if (e.key === "Escape" && typed !== filter.query) {
                        // Drops what was typed and keeps the submitted query. A second Escape
                        // reaches the view, which handles it as usual.
                        e.stopPropagation();
                        setTyped(filter.query);
                    }
                }}
            />
            <div className="collection-filter-buttons">
                {isActive && (
                    <ActionButton
                        className="collection-filter-clear"
                        noIconActionClass
                        icon="bx bx-x"
                        text={t("collection_filter.clear")}
                        onClick={() => {
                            setTyped("");
                            filter.setQuery("");
                            inputRef.current?.focus();
                        }}
                    />
                )}
                <ActionButton
                    className="collection-filter-submit"
                    noIconActionClass
                    icon="bx bx-search"
                    text={t("collection_filter.submit")}
                    onClick={() => filter.setQuery(typed)}
                />
            </div>
            {filter.error && <span className="collection-filter-error">{filter.error}</span>}
        </div>
    );
}

/** Whether any changed note, attribute or branch belongs to the collection's subtree. */
function touchesCollection(
    loadResults: LoadResults, collectionNoteIds: Set<string>, collectionNoteId: string
) {
    const inCollection = (noteId: string | null | undefined) =>
        !!noteId && (noteId === collectionNoteId || collectionNoteIds.has(noteId));

    return loadResults.getNoteIds().some(inCollection)
        || loadResults.getAttributeRows().some(attr => inCollection(attr.noteId))
        || loadResults.getBranchRows().some(branch =>
            inCollection(branch.noteId) || inCollection(branch.parentNoteId));
}
