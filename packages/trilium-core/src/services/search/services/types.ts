import type BNote from "../../../becca/entities/bnote.js";

export type TokenStructure = (TokenData | TokenStructure)[];

export interface TokenData {
    token: string;
    inQuotes?: boolean;
    startIndex?: number;
    endIndex?: number;
}

export interface SearchParams {
    fastSearch?: boolean;
    includeArchivedNotes?: boolean;
    includeHiddenNotes?: boolean;
    ignoreHoistedNote?: boolean;
    /** Whether to ignore certain attributes from the search such as ~internalLink. */
    ignoreInternalAttributes?: boolean;
    ancestorNoteId?: string;
    ancestorDepth?: string;
    orderBy?: string;
    orderDirection?: string;
    limit?: number | null;
    debug?: boolean;
    fuzzyAttributeSearch?: boolean;
    /** When true, a single-token flat-text search resolves each match's best note path directly. */
    autocomplete?: boolean;
    /**
     * Narrows the `searchEnableFuzzyMatching` option for one surface: false turns fuzzy matching
     * off for this search even when the option is on. It cannot turn it on against the option.
     */
    enableFuzzyMatching?: boolean;
    /**
     * Rank in two passes, keeping only the best results. Set by callers that show a fixed number of
     * results and never read the rest, so the full set is never fully ranked.
     */
    rankInTwoPasses?: boolean;
    /**
     * Whether the query can use the `%=` regex operator. Defaults to true; a surface open to
     * anonymous callers turns it off, since a backtracking pattern blocks the event loop.
     */
    allowRegex?: boolean;
    /**
     * Limits every note the query reads to those this returns true for: the notes it starts from,
     * the notes `parents`, `children`, `ancestors`, `links` and relations reach, and the owners of
     * the attributes it matches. A surface open to anonymous callers sets it, since a query can
     * otherwise test notes it never returns.
     */
    noteFilter?: (note: BNote) => boolean;
}
