import { ValidationError } from "@triliumnext/core";
import type { Request } from "express";

import becca from "../../becca/becca.js";
import beccaService from "../../becca/becca_service.js";
import attributeFormatter from "../../services/attribute_formatter.js";
import bulkActionService from "../../services/bulk_actions.js";
import cls from "../../services/cls.js";
import hoistedNoteService from "../../services/hoisted_note.js";
import SearchContext from "../../services/search/search_context.js";
import type SearchResult from "../../services/search/search_result.js";
import searchService, { EMPTY_RESULT, type SearchNoteResult } from "../../services/search/services/search.js";

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

export default {
    searchFromNote,
    searchAndExecute,
    getRelatedNotes,
    quickSearch,
    search,
    searchTemplates
};
