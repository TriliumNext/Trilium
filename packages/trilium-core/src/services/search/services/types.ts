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
}
