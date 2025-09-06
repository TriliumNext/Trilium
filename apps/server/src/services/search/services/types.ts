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
    /** Force a specific search backend for testing/comparison */
    forceBackend?: "typescript" | "sqlite";
}
