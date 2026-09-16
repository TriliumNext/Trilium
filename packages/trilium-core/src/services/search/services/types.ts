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
    /** When true, skip the two-phase fuzzy fallback and use the single-token fast path. */
    autocomplete?: boolean;
    /**
     * When true, also return notes equivalent to each hit under declared equivalence relations.
     * When omitted, {@link SearchContext} reads the `searchExpandEquivalence` option.
     */
    expandEquivalence?: boolean;
    /** Equivalence relation names to expand; omitted or empty means every known equivalence type. */
    equivalenceTypes?: string[];
}
