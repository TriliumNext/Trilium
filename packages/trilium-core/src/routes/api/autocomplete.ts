import type { AutocompleteResult } from "@triliumnext/commons";

import type { Request } from "../../http_interface";

import becca from "../../becca/becca.js";
import * as cls from "../../services/context.js";
import hoistedNoteService from "../../services/hoisted_note.js";
import { getLog } from "../../services/log.js";
import searchService from "../../services/search/services/search.js";
import { escapeHtml } from "../../services/utils/index.js";
import { ValidationError } from "../../errors.js";
import becca_service from "../../becca/becca_service.js";

/** The most recent notes an empty query lists. */
const RECENT_NOTES_LIMIT = 200;

function getAutocomplete(req: Request): AutocompleteResult[] {
    if (typeof req.query.query !== "string") {
        throw new ValidationError("Invalid query data type.");
    }
    const query = (req.query.query || "").trim();
    const fastSearch = String(req.query.fastSearch).toLowerCase() !== "false";
    const limit = parseLimit(req.query.limit);
    const filter = parseFilter(req.query.filter);
    // The note this search is limited to. It stands in for the real hoist, so a search can look
    // through the whole tree while the tree itself stays hoisted.
    const ancestorNoteId = parseAncestorNoteId(req.query.ancestorNoteId);

    const activeNoteId = req.query.activeNoteId || "none";

    let results: AutocompleteResult[];

    const timestampStarted = Date.now();

    if (query.length === 0 && filter) {
        // The recent notes would mostly not match, so the filter's own matches are listed instead.
        results = searchService.searchNotesForAutocomplete(filter, fastSearch, limit, undefined, ancestorNoteId);
    } else if (query.length === 0 && typeof activeNoteId === "string") {
        results = getRecentNotes(activeNoteId, limit, ancestorNoteId);
    } else {
        results = searchService.searchNotesForAutocomplete(query, fastSearch, limit, filter, ancestorNoteId);
    }

    const msTaken = Date.now() - timestampStarted;

    if (msTaken >= 100) {
        getLog().info(`Slow autocomplete took ${msTaken}ms`);
    }

    return annotateAutocompleteResults(results);
}

/**
 * Adds the note's type, and marks a workspace, from the note the path ends at. A note the cache no
 * longer holds is left as it is.
 */
function annotateAutocompleteResults(results: AutocompleteResult[]): AutocompleteResult[] {
    return results.map((result) => {
        const noteId = result.notePath.split("/").at(-1);
        const note = noteId ? becca.notes[noteId] : undefined;
        if (!note) {
            return result;
        }

        return {
            ...result,
            noteType: note.type,
            ...(note.hasOwnedLabel("workspace") ? { workspace: true as const } : {})
        };
    });
}

function getRecentNotes(activeNoteId: string, limit = RECENT_NOTES_LIMIT, scopeNoteId?: string): AutocompleteResult[] {
    let extraCondition = "";
    const params = [activeNoteId];

    // A search names its own scope. Without one, the recent notes follow the real hoist. A hoist
    // into the hidden subtree lists the recent notes of the whole tree, as the search does.
    const realHoist = cls.getHoistedNoteId();
    const requested = scopeNoteId ?? realHoist;
    const hoistedNoteId = requested !== "root" && requested === realHoist && hoistedNoteService.isHoistedInHiddenSubtree()
        ? "root"
        : requested;
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
/**
 * The `ancestorNoteId` query parameter: the note a search is limited to, in place of the real hoist.
 * `root` is the whole tree. Left out or blank, the search uses the real hoist.
 */
function parseAncestorNoteId(ancestor: unknown): string | undefined {
    if (ancestor === undefined || ancestor === "") {
        return undefined;
    }
    if (typeof ancestor !== "string") {
        throw new ValidationError("Invalid ancestor note.");
    }
    return ancestor.trim() || undefined;
}

function parseFilter(filter: unknown): string | undefined {
    if (filter === undefined) {
        return undefined;
    }
    if (typeof filter !== "string") {
        throw new ValidationError("Invalid filter data type.");
    }
    return filter.trim() || undefined;
}

export default {
    getAutocomplete
};
