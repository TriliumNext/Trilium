/**
 * FTS5 Search Service
 *
 * This module re-exports from the fts/ folder for backward compatibility.
 * New code should import directly from './fts/index.js' or './fts/<module>.js'.
 */

export {
    // Error classes
    FTSError,
    FTSQueryError,

    // Types and configuration
    FTS_CONFIG,
    type FTSSearchResult,
    type FTSSearchOptions,
    type FTSErrorInfo,
    type FTSIndexStats,

    // Query building utilities
    convertToFTS5Query,
    sanitizeFTS5Token,
    escapeLikeWildcards,
    containsExactPhrase,
    generateSnippet,

    // Index management
    assertFTS5Available,
    checkFTS5Availability,
    updateNoteIndex,
    removeNoteFromIndex,
    syncMissingNotes,
    rebuildIndex,
    getIndexStats,
    filterNonProtectedNoteIds,

    // Search operations
    searchWithLike,
    searchSync,
    searchAttributesSync,
    searchProtectedNotesSync,

    // Legacy class-based API
    ftsSearchService
} from "./fts/index.js";

// Default export for backward compatibility
export { default } from "./fts/index.js";
