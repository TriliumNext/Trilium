/**
 * FTS5 Search Module
 *
 * Barrel export for all FTS5 functionality.
 * This module provides full-text search using SQLite's FTS5 extension.
 */

// Error classes
export { FTSError, FTSNotAvailableError, FTSQueryError } from "./errors.js";

// Types and configuration
export {
    FTS_CONFIG,
    type FTSSearchResult,
    type FTSSearchOptions,
    type FTSErrorInfo,
    type FTSIndexStats
} from "./types.js";

// Query building utilities
export {
    convertToFTS5Query,
    sanitizeFTS5Token,
    escapeLikeWildcards,
    containsExactPhrase,
    generateSnippet
} from "./query_builder.js";

// Index management
export {
    assertFTS5Available,
    checkFTS5Availability,
    updateNoteIndex,
    removeNoteFromIndex,
    syncMissingNotes,
    rebuildIndex,
    getIndexStats,
    filterNonProtectedNoteIds
} from "./index_manager.js";

// Search operations
export {
    searchWithLike,
    searchSync,
    searchAttributesSync,
    searchProtectedNotesSync
} from "./search_service.js";

// Legacy class-based API for backward compatibility
import {
    assertFTS5Available,
    checkFTS5Availability as checkFTS5AvailabilityFn,
    updateNoteIndex,
    removeNoteFromIndex,
    syncMissingNotes,
    rebuildIndex,
    getIndexStats
} from "./index_manager.js";
import {
    searchWithLike,
    searchSync,
    searchAttributesSync,
    searchProtectedNotesSync
} from "./search_service.js";
import { convertToFTS5Query } from "./query_builder.js";

/**
 * FTS Search Service class
 *
 * Provides a class-based API for backward compatibility.
 * New code should prefer the individual exported functions.
 */
class FTSSearchService {
    /** Allows overriding FTS5 availability (used by comparison code in search.ts) */
    isFTS5Available: boolean | null = null;

    assertFTS5Available = assertFTS5Available;
    checkFTS5Availability = (): boolean => {
        if (this.isFTS5Available !== null) {
            return this.isFTS5Available;
        }
        return checkFTS5AvailabilityFn();
    };
    convertToFTS5Query = convertToFTS5Query;
    searchWithLike = searchWithLike;
    searchSync = searchSync;
    searchAttributesSync = searchAttributesSync;
    searchProtectedNotesSync = searchProtectedNotesSync;
    updateNoteIndex = updateNoteIndex;
    removeNoteFromIndex = removeNoteFromIndex;
    syncMissingNotes = syncMissingNotes;
    rebuildIndex = rebuildIndex;
    getIndexStats = getIndexStats;
}

// Export singleton instance for backward compatibility
export const ftsSearchService = new FTSSearchService();
export default ftsSearchService;
