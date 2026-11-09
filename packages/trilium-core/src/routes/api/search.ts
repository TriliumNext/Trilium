import {
    dayjs, type NoteMimeCount, type SearchLintRequest, type SearchLintResponse, type TemplatesResponse
} from "@triliumnext/commons";
import type { Request, Response } from "../../http_interface";

import becca from "../../becca/becca.js";
import bulkActionService from "../../services/bulk_actions.js";
import { executeSearch } from "../../services/search/search_executor.js";
import searchService from "../../services/search/services/search.js";
import { ValidationError } from "../../errors.js";
import { getHoistedNoteId } from "../../services/context.js";

/** The maximum age in days for a template to be marked as new. */
const NEW_TEMPLATE_MAX_AGE = 3;

/** The number of seconds after the root note's creation during which templates count as predefined. */
const INITIAL_SETUP_GRACE_PERIOD = 30;

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
 * Reads a search string without running it, so the editor can report what is wrong with a query
 * while it is being typed rather than once it is run. Carries the message alone: `SearchContext`
 * records no offsets, so the caller cannot mark where the fault is.
 */
function lintSearchString(req: Request): SearchLintResponse {
    const { searchString } = (req.body ?? {}) as Partial<SearchLintRequest>;

    if (typeof searchString !== "string") {
        throw new ValidationError("searchString must be a string.");
    }

    return { error: searchService.validateSearchQuery(searchString) };
}

function quickSearch(req: Request<{}, { searchString?: string }>) {
    return executeSearch("quickSearch", {
        hoistedNoteId: getHoistedNoteId(),
        searchString: req.query.searchString
    });
}

async function search(
    req: Request<{}, {
        searchString?: string, ancestorNoteId?: string, includeTokens?: string,
        includeArchivedNotes?: string
    }>,
    res: Response
) {
    const { searchString, ancestorNoteId, includeTokens, includeArchivedNotes } = req.query;
    const result = await executeSearch("search", {
        hoistedNoteId: getHoistedNoteId(), searchString, ancestorNoteId, includeTokens, includeArchivedNotes
    });

    // The request line carries the query URL-encoded, so the log repeats it in a readable form.
    if (res.locals && typeof searchString === "string") {
        const query = searchString.trim().replace(/\s+/g, " ");
        const count = Array.isArray(result) ? result.length : result.searchResultNoteIds.length;
        res.locals.logSummary = `Search: ${query}  (returned ${count} items)`;
    }

    return result;
}

function getRelatedNotes(req: Request) {
    return executeSearch("relatedNotes", { hoistedNoteId: getHoistedNoteId(), attribute: req.body });
}

function searchFromNote(req: Request<{ noteId: string }>) {
    return executeSearch("searchFromNote", { hoistedNoteId: getHoistedNoteId(), noteId: req.params.noteId });
}

/** Snippet and highlight details for the page of a saved search's results the client shows. */
function getSearchResultDetails(req: Request<{ noteId: string }>) {
    return executeSearch("searchResultDetails", {
        hoistedNoteId: getHoistedNoteId(),
        noteId: req.params.noteId,
        body: req.body
    });
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

/**
 * The MIME types the user's notes carry, with how many carry each, the most used first. System
 * notes, whose IDs start with `_`, are left out so the built-in ones do not outnumber the user's.
 */
function getNoteMimes(): NoteMimeCount[] {
    const counts = new Map<string, number>();
    for (const note of Object.values(becca.notes)) {
        if (!note.mime || note.noteId.startsWith("_")) {
            continue;
        }
        counts.set(note.mime, (counts.get(note.mime) ?? 0) + 1);
    }

    return [ ...counts ]
        .map(([ mime, count ]) => ({ mime, count }))
        .sort((a, b) => b.count - a.count || a.mime.localeCompare(b.mime));
}

export default {
    getNoteMimes,
    lintSearchString,
    searchFromNote,
    getSearchResultDetails,
    searchAndExecute,
    getRelatedNotes,
    quickSearch,
    search,
    searchTemplates
};
