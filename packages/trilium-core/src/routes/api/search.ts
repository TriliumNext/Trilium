import type { Request } from "express";

import becca from "../../becca/becca.js";
import attributeFormatter from "../../services/attribute_formatter.js";
import bulkActionService from "../../services/bulk_actions.js";
import hoistedNoteService from "../../services/hoisted_note.js";
import SearchContext from "../../services/search/search_context.js";
import type SearchResult from "../../services/search/search_result.js";
import searchService, { EMPTY_RESULT, type SearchNoteResult } from "../../services/search/services/search.js";
import { ValidationError } from "../../errors.js";
import becca_service from "../../becca/becca_service.js";
import { getHoistedNoteId } from "../../services/context.js";

// Number of results returned to the dropdown. Above this the user is better
// served by "Show in full search" which renders a paginated UI.
const QUICK_SEARCH_MAX_RESULTS = 50;

// Snippet extraction reads the blob for each note — capping it to the first
// batch the dropdown actually displays keeps the endpoint responsive.
const QUICK_SEARCH_SNIPPET_LIMIT = 15;

function searchFromNote(req: Request<{ noteId: string }>): SearchNoteResult {
    const note = becca.getNoteOrThrow(req.params.noteId);

    /* v8 ignore next 4 -- unreachable: getNoteOrThrow already throws on a missing note */
    if (!note) {
        // this can be triggered from recent changes, and it's harmless to return an empty list rather than fail
        return EMPTY_RESULT;
    }

    if (note.type !== "search") {
        throw new ValidationError(`Note '${req.params.noteId}' is not a search note.`);
    }

    return searchService.searchFromNote(note);
}

function searchAndExecute(req: Request<{ noteId: string }>) {
    const note = becca.getNoteOrThrow(req.params.noteId);

    /* v8 ignore next 4 -- unreachable: getNoteOrThrow already throws on a missing note */
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

function quickSearch(req: Request<{ searchString: string }>) {
    const { searchString } = req.params;

    const searchContext = new SearchContext({
        fastSearch: false,
        includeArchivedNotes: false,
        includeHiddenNotes: true,
        fuzzyAttributeSearch: true,
        ignoreInternalAttributes: true,
        ancestorNoteId: hoistedNoteService.isHoistedInHiddenSubtree() ? "root" : hoistedNoteService.getHoistedNoteId()
    });

    const allSearchResults = searchService.findResultsWithQuery(searchString, searchContext);
    const trimmed = allSearchResults.slice(0, QUICK_SEARCH_MAX_RESULTS);

    // Snippet extraction is the dominant per-result cost; only run it for the
    // first batch the dropdown actually displays. Results beyond the limit still
    // appear in the dropdown as plain links — explicitly assign empty snippets
    // so downstream code (highlighter, API mapper) sees a consistent string shape
    // rather than mixing strings with undefined.
    for (let i = 0; i < trimmed.length; i++) {
        const result = trimmed[i];
        if (i < QUICK_SEARCH_SNIPPET_LIMIT) {
            result.contentSnippet = searchService.extractContentSnippet(result.noteId, searchContext.highlightedTokens);
            result.attributeSnippet = searchService.extractAttributeSnippet(result.noteId, searchContext.highlightedTokens);
        } else {
            result.contentSnippet = "";
            result.attributeSnippet = "";
        }
    }

    searchService.highlightSearchResults(trimmed, searchContext.highlightedTokens, searchContext.ignoreInternalAttributes);

    const searchResults = trimmed.map((result) => {
        const { title, icon } = becca_service.getNoteTitleAndIcon(result.noteId);
        return {
            notePath: result.notePath,
            noteTitle: title,
            notePathTitle: result.notePathTitle,
            highlightedNotePathTitle: result.highlightedNotePathTitle,
            contentSnippet: result.contentSnippet,
            highlightedContentSnippet: result.highlightedContentSnippet,
            attributeSnippet: result.attributeSnippet,
            highlightedAttributeSnippet: result.highlightedAttributeSnippet,
            icon
        };
    });

    const resultNoteIds = searchResults.map((result) => result.notePath.split("/").pop()).filter(Boolean) as string[];

    return {
        searchResultNoteIds: resultNoteIds,
        searchResults,
        error: searchContext.getError()
    };
}

function search(req: Request<{ searchString: string }>) {
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
    const query = getHoistedNoteId() === "root" ? "#template" : "#template OR #workspaceTemplate";

    return searchService
        .searchNotes(query, {
            includeArchivedNotes: true,
            ignoreHoistedNote: false
        })
        .map((note) => note.noteId);
}

export default {
    searchFromNote,
    searchAndExecute,
    getRelatedNotes,
    quickSearch,
    search,
    searchTemplates
};
