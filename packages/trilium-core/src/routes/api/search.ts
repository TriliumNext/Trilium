import { dayjs, type SearchResultDetails, type SearchResultDetailsRequest, type SearchResultDetailsResponse, type TemplatesResponse } from "@triliumnext/commons";
import type { Request } from "express";

import becca from "../../becca/becca.js";
import becca_service from "../../becca/becca_service.js";
import attributeFormatter from "../../services/attribute_formatter.js";
import bulkActionService from "../../services/bulk_actions.js";
import hoistedNoteService from "../../services/hoisted_note.js";
import SearchContext from "../../services/search/search_context.js";
import type SearchResult from "../../services/search/search_result.js";
import searchService, { EMPTY_RESULT, type SearchNoteResult } from "../../services/search/services/search.js";
import { ValidationError } from "../../errors.js";
import { getHoistedNoteId } from "../../services/context.js";

/** The maximum age in days for a template to be marked as new. */
const NEW_TEMPLATE_MAX_AGE = 3;

/** The number of seconds after the root note's creation during which templates count as predefined. */
const INITIAL_SETUP_GRACE_PERIOD = 30;

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

/**
 * Lazily builds snippet + highlight details for a page of a saved search's results.
 * The client fetches these per visible page rather than for the whole result set.
 *
 * Stateless by design: the search is re-run per request. A future optimization
 * could cache the result set in an LRU keyed by (search noteId + searchString),
 * but that is intentionally not built here.
 */
function getSearchResultDetails(req: Request<{ noteId: string }>): SearchResultDetailsResponse {
    const note = becca.getNoteOrThrow(req.params.noteId);

    if (note.type !== "search") {
        throw new ValidationError(`Note '${req.params.noteId}' is not a search note.`);
    }

    const { noteIds } = (req.body ?? {}) as Partial<SearchResultDetailsRequest>;
    if (!Array.isArray(noteIds) || noteIds.some((noteId) => typeof noteId !== "string")) {
        throw new ValidationError("Request body must contain a 'noteIds' string array.");
    }
    if (noteIds.length > 100) {
        throw new ValidationError("A maximum of 100 noteIds can be requested at once.");
    }

    const { searchResults, searchContext } = searchService.searchFromNoteWithContext(note);

    // Restrict to actual result notes so the endpoint can't be used as a snippet
    // oracle for arbitrary notes; preserve the caller's requested order.
    const resultByNoteId = new Map(searchResults.map((sr) => [sr.noteId, sr]));
    const requestedResults = noteIds
        .map((noteId) => resultByNoteId.get(noteId))
        .filter((sr): sr is SearchResult => sr !== undefined);

    // Script-based searches have no lexed query: return titles/icons, no snippets/tokens.
    if (!searchContext) {
        const results: SearchResultDetails[] = requestedResults.map((sr) => {
            const { title, icon } = becca_service.getNoteTitleAndIcon(sr.noteId);
            return {
                noteId: sr.noteId,
                notePath: sr.notePath,
                noteTitle: title,
                notePathTitle: sr.notePathTitle,
                icon: icon ?? "bx bx-note"
            };
        });

        return { results, highlightedTokenInfos: [], error: null };
    }

    return {
        results: searchService.buildSearchResultDetails(requestedResults, searchContext),
        highlightedTokenInfos: searchContext.getHighlightedTokenInfos(),
        error: searchContext.getError()
    };
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

    const trimmed = searchService.findResultsWithQuery(searchString, searchContext).slice(0, 200);
    const searchResults = searchService.buildSearchResultDetails(trimmed, searchContext);

    return {
        searchResultNoteIds: searchResults.map((result) => result.noteId),
        searchResults,
        // Only plain tokens round-trip as literal jump-to-match search terms. Regex (`%=`) tokens
        // are raw patterns the find bar would treat literally (a silent no-op), so drop them here.
        // The client uses this field solely to seed jump-to-match; snippet highlighting already
        // happened server-side on `searchResults`, so filtering the response is safe.
        highlightedTokens: searchContext.highlightedTokens.filter((token) => !searchContext.regexTokens.has(token)),
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

    const results = searchService.findResultsWithQuery(searchString, searchContext);

    // The parse layer records the problem and degrades the expression to a
    // match-everything scan, so a dropped error answers HTTP 200 with the whole
    // tree (root and _hidden included). Fail the query instead — quick-search
    // already surfaces this same error to its caller.
    if (searchContext.hasError()) {
        throw new ValidationError(searchContext.getError()!);
    }

    return results.map((sr) => sr.noteId);
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

function searchTemplates(): TemplatesResponse {
    const query = getHoistedNoteId() === "root" ? "#template" : "#template OR #workspaceTemplate";
    const userTemplates = searchService.searchNotes(query, {
        includeArchivedNotes: true,
        ignoreHoistedNote: false
    });

    // The built-in templates live in the hidden subtree, so the search above never returns them.
    // Their "new" flag is reported here regardless, sparing the client a request per template.
    const builtInTemplates = becca.getNote("_templates")?.getChildNotes() ?? [];
    const rootCreationDate = becca.getNote("root")?.utcDateCreated;

    return {
        templateNoteIds: userTemplates.map((note) => note.noteId),
        newTemplateNoteIds: [ ...userTemplates, ...builtInTemplates ]
            .filter((note) => isNewTemplate(note.utcDateCreated, rootCreationDate))
            .map((note) => note.noteId)
    };
}

/**
 * Determines whether a template was created recently enough to be marked as new in the UI.
 *
 * @param utcDateCreated the creation date of the template.
 * @param rootCreationDate the creation date of the root note, used to recognize the predefined
 *                         templates that are set up together with a new database.
 */
export function isNewTemplate(utcDateCreated: string | null, rootCreationDate: string | null | undefined) {
    if (!utcDateCreated) {
        return false;
    }

    const creationDate = dayjs.utc(utcDateCreated);

    if (rootCreationDate && creationDate.diff(dayjs.utc(rootCreationDate), "second") < INITIAL_SETUP_GRACE_PERIOD) {
        // Ignore templates created shortly after the root note. This prevents the predefined
        // templates from being marked as new after setting up a new database.
        return false;
    }

    return dayjs.utc().diff(creationDate, "day", true) <= NEW_TEMPLATE_MAX_AGE;
}

export default {
    searchFromNote,
    getSearchResultDetails,
    searchAndExecute,
    getRelatedNotes,
    quickSearch,
    search,
    searchTemplates
};
