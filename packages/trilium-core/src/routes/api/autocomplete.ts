import type { AutocompleteResult } from "@triliumnext/commons";

import type { Request } from "../../http_interface";

import becca from "../../becca/becca.js";
import * as cls from "../../services/context.js";
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

    const activeNoteId = req.query.activeNoteId || "none";

    let results: AutocompleteResult[];

    const timestampStarted = Date.now();

    if (query.length === 0 && typeof activeNoteId === "string") {
        results = getRecentNotes(activeNoteId, limit);
    } else {
        results = searchService.searchNotesForAutocomplete(query, fastSearch, limit);
    }

    const msTaken = Date.now() - timestampStarted;

    if (msTaken >= 100) {
        getLog().info(`Slow autocomplete took ${msTaken}ms`);
    }

    return results;
}

function getRecentNotes(activeNoteId: string, limit = RECENT_NOTES_LIMIT): AutocompleteResult[] {
    let extraCondition = "";
    const params = [activeNoteId];

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

export default {
    getAutocomplete
};
