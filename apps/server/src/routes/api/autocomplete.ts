import type { Request } from "express";

import becca from "../../becca/becca.js";
import beccaService from "../../becca/becca_service.js";
import ValidationError from "../../errors/validation_error.js";
import cls from "../../services/cls.js";
import log from "../../services/log.js";
import searchService from "../../services/search/services/search.js";
import sql from "../../services/sql.js";
import utils from "../../services/utils.js";

function getAutocomplete(req: Request) {
    if (typeof req.query.query !== "string") {
        throw new ValidationError("Invalid query data type.");
    }
    const query = (req.query.query || "").trim();
    const fastSearch = String(req.query.fastSearch).toLowerCase() !== "false";

    const activeNoteId = req.query.activeNoteId || "none";

    let results;

    const timestampStarted = Date.now();

    if (query.length === 0 && typeof activeNoteId === "string") {
        results = getRecentNotes(activeNoteId);
    } else {
        results = searchService.searchNotesForAutocomplete(query, fastSearch);
    }

    const msTaken = Date.now() - timestampStarted;

    if (msTaken >= 100) {
        log.info(`Slow autocomplete took ${msTaken}ms`);
    }

    return results;
}

function getRecentNotes(activeNoteId: string) {
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
    LIMIT 200`,
        params
    );

    return recentNotes.map((rn) => {
        const notePathArray = rn.notePath.split("/");

        const { title, icon } = beccaService.getNoteTitleAndIcon(notePathArray[notePathArray.length - 1]);
        const notePathTitle = beccaService.getNoteTitleForPath(notePathArray);

        return {
            notePath: rn.notePath,
            noteTitle: title,
            notePathTitle,
            highlightedNotePathTitle: utils.escapeHtml(notePathTitle || title),
            icon: icon ?? "bx bx-note"
        };
    });
}

// Get the total number of notes
function getNotesCount(req: Request) {
    const notesCount = sql.getRow(
        /*sql*/`SELECT COUNT(*) AS count FROM notes WHERE isDeleted = 0;`,
    ) as { count: number };
    return notesCount.count;
}

export default {
    getAutocomplete,
    getNotesCount
};
