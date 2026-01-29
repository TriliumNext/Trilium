"use strict";

import type { Request } from "express";

import becca from "../../becca/becca.js";
import SearchContext from "../../services/search/search_context.js";
import searchService, { EMPTY_RESULT, type SearchNoteResult } from "../../services/search/services/search.js";
import bulkActionService from "../../services/bulk_actions.js";
import cls from "../../services/cls.js";
import attributeFormatter from "../../services/attribute_formatter.js";
import ValidationError from "../../errors/validation_error.js";
import type SearchResult from "../../services/search/search_result.js";
import { ftsSearchService } from "../../services/search/fts/index.js";
import log from "../../services/log.js";
import hoistedNoteService from "../../services/hoisted_note.js";
import beccaService from "../../becca/becca_service.js";

function searchFromNote(req: Request): SearchNoteResult {
    const note = becca.getNoteOrThrow(req.params.noteId);

    if (!note) {
        // this can be triggered from recent changes, and it's harmless to return an empty list rather than fail
        return EMPTY_RESULT;
    }

    if (note.type !== "search") {
        throw new ValidationError(`Note '${req.params.noteId}' is not a search note.`);
    }

    return searchService.searchFromNote(note);
}

function searchAndExecute(req: Request) {
    const note = becca.getNoteOrThrow(req.params.noteId);

    if (!note) {
        // this can be triggered from recent changes, and it's harmless to return an empty list rather than fail
        return [];
    }

    if (note.type !== "search") {
        throw new ValidationError(`Note '${req.params.noteId}' is not a search note.`);
    }

    const { searchResultNoteIds } = searchService.searchFromNote(note);

    bulkActionService.executeActionsFromNote(note, searchResultNoteIds);
}

function quickSearch(req: Request) {
    const { searchString } = req.params;

    const searchContext = new SearchContext({
        fastSearch: false,
        includeArchivedNotes: false,
        includeHiddenNotes: true,
        fuzzyAttributeSearch: true,
        ignoreInternalAttributes: true,
        ancestorNoteId: hoistedNoteService.isHoistedInHiddenSubtree() ? "root" : hoistedNoteService.getHoistedNoteId()
    });

    // Execute search with our context
    const allSearchResults = searchService.findResultsWithQuery(searchString, searchContext);
    const trimmed = allSearchResults.slice(0, 200);

    // Extract snippets using highlightedTokens from our context
    for (const result of trimmed) {
        result.contentSnippet = searchService.extractContentSnippet(result.noteId, searchContext.highlightedTokens);
        result.attributeSnippet = searchService.extractAttributeSnippet(result.noteId, searchContext.highlightedTokens);
    }

    // Highlight the results
    searchService.highlightSearchResults(trimmed, searchContext.highlightedTokens, searchContext.ignoreInternalAttributes);

    // Map to API format
    const searchResults = trimmed.map((result) => {
        const { title, icon } = beccaService.getNoteTitleAndIcon(result.noteId);
        return {
            notePath: result.notePath,
            noteTitle: title,
            notePathTitle: result.notePathTitle,
            highlightedNotePathTitle: result.highlightedNotePathTitle,
            contentSnippet: result.contentSnippet,
            highlightedContentSnippet: result.highlightedContentSnippet,
            attributeSnippet: result.attributeSnippet,
            highlightedAttributeSnippet: result.highlightedAttributeSnippet,
            icon: icon
        };
    });

    const resultNoteIds = searchResults.map((result) => result.notePath.split("/").pop()).filter(Boolean) as string[];

    return {
        searchResultNoteIds: resultNoteIds,
        searchResults: searchResults,
        error: searchContext.getError()
    };
}

function search(req: Request) {
    const { searchString } = req.params;

    const searchContext = new SearchContext({
        fastSearch: false,
        includeArchivedNotes: true,
        fuzzyAttributeSearch: false,
        ignoreHoistedNote: true
    });

    return searchService.findResultsWithQuery(searchString, searchContext).map((sr) => sr.noteId);
}

function getRelatedNotes(req: Request) {
    const attr = req.body;

    const searchSettings = {
        fastSearch: true,
        includeArchivedNotes: false,
        fuzzyAttributeSearch: false
    };

    const matchingNameAndValue = searchService.findResultsWithQuery(attributeFormatter.formatAttrForSearch(attr, true), new SearchContext(searchSettings));
    const matchingName = searchService.findResultsWithQuery(attributeFormatter.formatAttrForSearch(attr, false), new SearchContext(searchSettings));

    const results: SearchResult[] = [];

    const allResults = matchingNameAndValue.concat(matchingName);

    const allResultNoteIds = new Set();

    for (const record of allResults) {
        allResultNoteIds.add(record.noteId);
    }

    for (const record of allResults) {
        if (results.length >= 20) {
            break;
        }

        if (results.find((res) => res.noteId === record.noteId)) {
            continue;
        }

        results.push(record);
    }

    return {
        count: allResultNoteIds.size,
        results
    };
}

function searchTemplates() {
    const query = cls.getHoistedNoteId() === "root" ? "#template" : "#template OR #workspaceTemplate";

    return searchService
        .searchNotes(query, {
            includeArchivedNotes: true,
            ignoreHoistedNote: false
        })
        .map((note) => note.noteId);
}

/**
 * Syncs missing notes to the FTS index
 * This endpoint is useful for maintenance or after imports where FTS triggers might not have fired
 */
function syncFtsIndex(req: Request) {
    try {
        const noteIds = req.body?.noteIds;
        
        log.info(`FTS sync requested for ${noteIds?.length || 'all'} notes`);
        
        const syncedCount = ftsSearchService.syncMissingNotes(noteIds);
        
        return {
            success: true,
            syncedCount,
            message: syncedCount > 0 
                ? `Successfully synced ${syncedCount} notes to FTS index` 
                : 'FTS index is already up to date'
        };
    } catch (error) {
        log.error(`FTS sync failed: ${error}`);
        throw new ValidationError(`Failed to sync FTS index: ${error}`);
    }
}

/**
 * Rebuilds the entire FTS index from scratch
 * This is a more intensive operation that should be used sparingly
 */
function rebuildFtsIndex() {
    try {
        log.info('FTS index rebuild requested');
        
        ftsSearchService.rebuildIndex();
        
        return {
            success: true,
            message: 'FTS index rebuild completed successfully'
        };
    } catch (error) {
        log.error(`FTS rebuild failed: ${error}`);
        throw new ValidationError(`Failed to rebuild FTS index: ${error}`);
    }
}

/**
 * Gets statistics about the FTS index
 */
function getFtsIndexStats() {
    try {
        const stats = ftsSearchService.getIndexStats();
        
        // Get count of notes that should be indexed
        const eligibleNotesCount = searchService.searchNotes('', {
            includeArchivedNotes: false,
            ignoreHoistedNote: true
        }).filter(note => 
            ['text', 'code', 'mermaid', 'canvas', 'mindMap'].includes(note.type) &&
            !note.isProtected
        ).length;
        
        return {
            ...stats,
            eligibleNotesCount,
            missingFromIndex: Math.max(0, eligibleNotesCount - stats.totalDocuments)
        };
    } catch (error) {
        log.error(`Failed to get FTS stats: ${error}`);
        throw new ValidationError(`Failed to get FTS index statistics: ${error}`);
    }
}

export default {
    searchFromNote,
    searchAndExecute,
    getRelatedNotes,
    quickSearch,
    search,
    searchTemplates,
    syncFtsIndex,
    rebuildFtsIndex,
    getFtsIndexStats
};
