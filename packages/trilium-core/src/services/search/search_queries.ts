import type {
    AttributeRow, AutocompleteResult, QuickSearchResponse, SearchResultDetails, SearchResultDetailsRequest,
    SearchResultDetailsResponse, SearchWithTokensResponse
} from "@triliumnext/commons";

import becca from "../../becca/becca.js";
import becca_service from "../../becca/becca_service.js";
import { ConflictError, ForbiddenError, GoneError, HttpError, NotFoundError, ValidationError } from "../../errors.js";
import attributeFormatter from "../attribute_formatter.js";
import * as cls from "../context.js";
import { getLog } from "../log.js";
import { getSql } from "../sql/index.js";
import { escapeHtml } from "../utils/index.js";
import SearchContext from "./search_context.js";
import type SearchResult from "./search_result.js";
import searchService, { type SearchNoteResult } from "./services/search.js";

/**
 * The route-level searches as plain functions: plain arguments in, plain JSON out, so that they can
 * run in another process and their results cross it by structured clone unchanged.
 */
export interface SearchQueryArgs {
    quickSearch: QuickSearchArgs;
    search: SearchArgs;
    relatedNotes: RelatedNotesArgs;
    searchFromNote: SearchFromNoteArgs;
    searchResultDetails: SearchResultDetailsArgs;
    autocomplete: AutocompleteArgs;
}

export interface SearchQueryResults {
    quickSearch: QuickSearchResponse;
    search: string[] | SearchWithTokensResponse;
    relatedNotes: RelatedNotesResponse;
    searchFromNote: SearchNoteResult | NeedsMainResult;
    searchResultDetails: SearchResultDetailsResponse | NeedsMainResult;
    autocomplete: AutocompleteResult[];
}

export type SearchQueryKind = keyof SearchQueryArgs;

/** The hoisted note of the client that asked, which scopes every search that does not opt out. */
export interface SearchQueryBaseArgs {
    hoistedNoteId: string;
}

/** Query parameters arrive unvalidated, as in the request, and each query function checks its own. */
export interface QuickSearchArgs extends SearchQueryBaseArgs {
    searchString?: unknown;
}

export interface SearchArgs extends SearchQueryBaseArgs {
    searchString?: unknown;
    ancestorNoteId?: unknown;
    includeTokens?: unknown;
    includeArchivedNotes?: unknown;
}

export interface RelatedNotesArgs extends SearchQueryBaseArgs {
    /** The request body: the attribute whose name, and name and value, are looked up. */
    attribute: AttributeRow;
}

export interface SearchFromNoteArgs extends SearchQueryBaseArgs {
    noteId: string;
}

export interface SearchResultDetailsArgs extends SearchQueryBaseArgs {
    noteId: string;
    body?: Partial<SearchResultDetailsRequest> | null;
}

export interface AutocompleteArgs extends SearchQueryBaseArgs {
    query?: unknown;
    fastSearch?: unknown;
    limit?: unknown;
    filter?: unknown;
    activeNoteId?: unknown;
}

/** A {@link SearchResult} in the shape `JSON.stringify` gives it: its own fields, no getters. */
export interface SearchResultRecord {
    notePathArray: string[];
    score: number;
    [key: string]: unknown;
}

export interface RelatedNotesResponse {
    count: number;
    results: SearchResultRecord[];
}

/** A saved search that runs a `~searchScript`, which only the process that runs scripts can answer. */
export interface NeedsMainResult {
    needsMain: true;
}

export interface SearchQueryOptions {
    /** Answer a script-based saved search with {@link NeedsMainResult} instead of running the script. */
    deferScripts?: boolean;
    /**
     * Runs the query in a transaction opened inside its execution context, so that the commit and
     * rollback hooks see the entity changes a search script records there.
     */
    transactional?: boolean;
}

/** An error thrown by a query, in a form that crosses a process boundary. */
export interface SearchQueryError {
    name: string;
    message: string;
    statusCode?: number;
}

/** The most recent notes an empty autocomplete query lists. */
const RECENT_NOTES_LIMIT = 200;

/**
 * Runs one query inside its own execution context, with the caller's hoisted note set.
 *
 * @throws ValidationError or NotFoundError for a request the route answers with 400 or 404.
 */
export function runSearchQuery<K extends SearchQueryKind>(
    kind: K, args: SearchQueryArgs[K], options: SearchQueryOptions = {}
): SearchQueryResults[K] {
    return cls.init(() => {
        cls.set("hoistedNoteId", args.hoistedNoteId || "root");
        const run = () => queries[kind](args, options);
        return options.transactional ? getSql().transactional(run) : run();
    });
}

export function serializeSearchQueryError(e: unknown): SearchQueryError {
    if (!(e instanceof Error)) {
        return { name: "Error", message: String(e) };
    }

    const error: SearchQueryError = { name: e.name, message: e.message };
    if (e instanceof HttpError) {
        error.statusCode = e.statusCode;
    }
    return error;
}

/** Rebuilds an error from {@link serializeSearchQueryError}, as the class the route maps to its status. */
export function deserializeSearchQueryError({ name, message, statusCode }: SearchQueryError): Error {
    const errorClass = HTTP_ERROR_CLASSES[name];
    if (errorClass) {
        return new errorClass(message);
    }

    const error = statusCode === undefined ? new Error(message) : new HttpError(message, statusCode);
    error.name = name;
    return error;
}

const HTTP_ERROR_CLASSES: Record<string, new (message: string) => HttpError> = {
    ValidationError,
    NotFoundError,
    ForbiddenError,
    ConflictError,
    GoneError
};

type QueryFunctions = {
    [K in SearchQueryKind]: (args: SearchQueryArgs[K], options: SearchQueryOptions) => SearchQueryResults[K];
};

const queries: QueryFunctions = {
    quickSearch,
    search,
    relatedNotes,
    searchFromNote,
    searchResultDetails,
    autocomplete
};

function quickSearch({ searchString }: QuickSearchArgs): QuickSearchResponse {
    const query = requireSearchString(searchString);

    const searchContext = new SearchContext({
        fastSearch: false,
        includeArchivedNotes: false,
        fuzzyAttributeSearch: true,
        ignoreInternalAttributes: true,
        // Quick search covers the subtree the user is looking at, so a hoist into the hidden
        // subtree scopes it there too. Only link autocomplete widens to root, for link targets.
        ancestorNoteId: cls.getHoistedNoteId()
    });

    const trimmed = searchService.findResultsWithQuery(query, searchContext).slice(0, 200);
    const searchResults = searchService.buildSearchResultDetails(trimmed, searchContext);

    return {
        searchResultNoteIds: searchResults.map((result) => result.noteId),
        searchResults,
        // Only plain tokens round-trip as literal jump-to-match search terms. Regex (`%=`) tokens
        // are raw patterns the find bar would treat literally (a silent no-op), so they are dropped.
        highlightedTokens: searchContext.highlightedTokens.filter((token) => !searchContext.regexTokens.has(token)),
        error: searchContext.getError()
    };
}

function search({ searchString, ancestorNoteId, includeTokens, includeArchivedNotes }: SearchArgs) {
    const query = requireSearchString(searchString);

    const searchContext = new SearchContext({
        fastSearch: false,
        // A collection that hides archived notes asks for them to be left out, so their content is
        // never read.
        includeArchivedNotes: includeArchivedNotes !== "false",
        fuzzyAttributeSearch: false,
        ignoreHoistedNote: true,
        // Restricts the results to one subtree, for callers that filter a collection rather
        // than search the whole tree.
        ancestorNoteId: (ancestorNoteId || undefined) as string | undefined
    });

    const noteIds = searchService.findResultsWithQuery(query, searchContext).map((sr) => sr.noteId);

    if (includeTokens !== "true") {
        return noteIds;
    }

    return {
        searchResultNoteIds: noteIds,
        highlightedTokens: searchContext.getHighlightedTokenInfos(),
        error: searchContext.getError()
    };
}

function relatedNotes({ attribute }: RelatedNotesArgs): RelatedNotesResponse {
    const searchSettings = {
        fastSearch: true,
        includeArchivedNotes: false,
        fuzzyAttributeSearch: false
    };

    const matchingNameAndValue = searchService.findResultsWithQuery(
        attributeFormatter.formatAttrForSearch(attribute, true), new SearchContext(searchSettings));
    const matchingName = searchService.findResultsWithQuery(
        attributeFormatter.formatAttrForSearch(attribute, false), new SearchContext(searchSettings));

    const results: SearchResult[] = [];
    const allResults = matchingNameAndValue.concat(matchingName);
    const allResultNoteIds = new Set<string>();

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
        // The response has always been the JSON of the `SearchResult`s, own fields only.
        results: JSON.parse(JSON.stringify(results)) as SearchResultRecord[]
    };
}

function searchFromNote({ noteId }: SearchFromNoteArgs, { deferScripts }: SearchQueryOptions) {
    const note = requireSearchNote(noteId);

    if (deferScripts && note.getRelationValue("searchScript")) {
        return NEEDS_MAIN;
    }

    return searchService.searchFromNote(note);
}

/**
 * Builds snippet and highlight details for a page of a saved search's results. The search is run
 * again for every request, and only notes in its result set are answered.
 */
function searchResultDetails(
    { noteId, body }: SearchResultDetailsArgs, { deferScripts }: SearchQueryOptions
): SearchResultDetailsResponse | NeedsMainResult {
    const note = requireSearchNote(noteId);

    const { noteIds } = body ?? {};
    if (!Array.isArray(noteIds) || noteIds.some((id) => typeof id !== "string")) {
        throw new ValidationError("Request body must contain a 'noteIds' string array.");
    }
    if (noteIds.length > 100) {
        throw new ValidationError("A maximum of 100 noteIds can be requested at once.");
    }

    if (deferScripts && note.getRelationValue("searchScript")) {
        return NEEDS_MAIN;
    }

    const { searchResults, searchContext } = searchService.searchFromNoteWithContext(note);

    // Restricting to actual result notes keeps the endpoint from being a snippet oracle for
    // arbitrary notes; the caller's order is kept.
    const resultByNoteId = new Map(searchResults.map((sr) => [ sr.noteId, sr ]));
    const requestedResults = noteIds
        .map((id) => resultByNoteId.get(id))
        .filter((sr): sr is SearchResult => sr !== undefined);

    // Script-based searches have no lexed query: titles and icons, no snippets or tokens.
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

function autocomplete(args: AutocompleteArgs) {
    if (typeof args.query !== "string") {
        throw new ValidationError("Invalid query data type.");
    }
    const query = args.query.trim();
    const fastSearch = String(args.fastSearch).toLowerCase() !== "false";
    const limit = parseLimit(args.limit);
    const filter = parseFilter(args.filter);
    const activeNoteId = args.activeNoteId || "none";

    let results: AutocompleteResult[];

    const timestampStarted = Date.now();

    if (query.length === 0 && filter) {
        // The recent notes would mostly not match, so the filter's own matches are listed instead.
        results = searchService.searchNotesForAutocomplete(filter, fastSearch, limit);
    } else if (query.length === 0 && typeof activeNoteId === "string") {
        results = getRecentNotes(activeNoteId, limit);
    } else {
        results = searchService.searchNotesForAutocomplete(query, fastSearch, limit, filter);
    }

    const msTaken = Date.now() - timestampStarted;

    if (msTaken >= 100) {
        getLog().info(`Slow autocomplete took ${msTaken}ms`);
    }

    return results;
}

const NEEDS_MAIN: NeedsMainResult = { needsMain: true };

function requireSearchString(searchString: unknown): string {
    if (typeof searchString !== "string" || searchString.length === 0) {
        throw new ValidationError("Search string must be a non-empty string.");
    }

    return searchString;
}

function requireSearchNote(noteId: string) {
    const note = becca.getNoteOrThrow(noteId);

    if (note.type !== "search") {
        throw new ValidationError(`Note '${noteId}' is not a search note.`);
    }

    return note;
}

function getRecentNotes(activeNoteId: string, limit = RECENT_NOTES_LIMIT): AutocompleteResult[] {
    let extraCondition = "";
    const params = [ activeNoteId ];

    const hoistedNoteId = cls.getHoistedNoteId();
    if (hoistedNoteId !== "root") {
        extraCondition = `AND recent_notes.notePath LIKE ?`;
        params.push(`%${hoistedNoteId}%`);
    }

    const recentNotes = becca.getRecentNotesFromQuery(
        `
    SELECT
        recent_notes.*
    FROM
        recent_notes
        JOIN notes USING(noteId)
    WHERE
        notes.isDeleted = 0
        AND notes.noteId != ?
        ${extraCondition}
    ORDER BY
        utcDateCreated DESC
    LIMIT ${Math.min(limit, RECENT_NOTES_LIMIT)}`,
        params
    );

    return recentNotes.map((rn) => {
        const notePathArray = rn.notePath.split("/");

        const { title, icon } = becca_service.getNoteTitleAndIcon(notePathArray[notePathArray.length - 1]);
        const pathTitles = becca_service.getNoteTitleArrayForPath(notePathArray);
        const notePathTitle = pathTitles.join(" › ");

        return {
            notePath: rn.notePath,
            noteTitle: title,
            notePathTitle,
            highlightedNotePathTitle: escapeHtml(notePathTitle || title),
            highlightedNoteTitle: escapeHtml(pathTitles.at(-1) ?? title),
            highlightedParentPathTitle: escapeHtml(pathTitles.slice(0, -1).join(" › ")),
            icon: icon ?? "bx bx-note",
            utcDateVisited: rn.utcDateCreated
        };
    });
}

/**
 * The `limit` query parameter: how many notes a caller shows, which the server then stops at
 * rather than building rows that are thrown away. Left out, the server's own caps apply; it can
 * lower them, never raise them.
 */
function parseLimit(limit: unknown): number | undefined {
    if (limit === undefined) {
        return undefined;
    }

    const parsed = typeof limit === "string" ? Number(limit) : NaN;
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new ValidationError("Invalid limit.");
    }
    return parsed;
}

/**
 * The `filter` query parameter: a search query every suggestion must also match, such as
 * `note.type = image`. Left out or blank, nothing is filtered.
 */
function parseFilter(filter: unknown): string | undefined {
    if (filter === undefined) {
        return undefined;
    }
    if (typeof filter !== "string") {
        throw new ValidationError("Invalid filter data type.");
    }
    return filter.trim() || undefined;
}
