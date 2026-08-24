import { dayjs, type TemplatesResponse } from "@triliumnext/commons";
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

function quickSearch(req: Request<{ searchString: string }>) {
    const { searchString } = req.params;

    // The client sends its currently hoisted note ID so the server can scope
    // results to that subtree.  The server-side CLS context only carries the
    // hoisted note for the desktop (Electron) client where both sides share a
    // process; for all web clients the CLS value is always "root".  When the
    // query param is absent we fall back to the CLS-based logic so that
    // existing API consumers and the standalone client keep working unchanged.
    let ancestorNoteId: string;
    const clientHoistedNoteId =
        typeof req.query.hoistedNoteId === "string" ? req.query.hoistedNoteId : null;
    if (clientHoistedNoteId) {
        // If the client says it is hoisted inside a hidden subtree, or the hoisted note no longer
        // exists (stale client state), widen to root so searches still return results.
        const hoistedNote = becca.getNote(clientHoistedNoteId);
        ancestorNoteId = !hoistedNote || hoistedNote.isHiddenCompletely() ? "root" : clientHoistedNoteId;
    } else {
        ancestorNoteId = hoistedNoteService.isHoistedInHiddenSubtree() ? "root" : hoistedNoteService.getHoistedNoteId();
    }

    const searchContext = new SearchContext({
        fastSearch: false,
        includeArchivedNotes: false,
        includeHiddenNotes: true,
        fuzzyAttributeSearch: true,
        ignoreInternalAttributes: true,
        ancestorNoteId
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
    searchAndExecute,
    getRelatedNotes,
    quickSearch,
    search,
    searchTemplates
};
