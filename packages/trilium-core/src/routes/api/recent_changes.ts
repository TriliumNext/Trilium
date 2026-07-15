import protectedSessionService from "../../services/protected_session.js";
import noteService from "../../services/notes.js";
import becca from "../../becca/becca.js";
import type { Request } from "express";
import type { RecentChangeRow } from "@triliumnext/commons";
import { getSql } from "../../services/sql/index.js";

function getRecentChanges(req: Request<{ ancestorNoteId: string }, unknown, unknown, { deletedOnly?: string }>) {
    const { ancestorNoteId } = req.params;
    const deletedOnly = req.query.deletedOnly === "true";

    let recentChanges: RecentChangeRow[] = [];

    const sql = getSql();

    // Revisions are individual change events. The deleted-notes view lists each note once (at its
    // deletion), so revisions (and the per-note creation point below) are only collected for the
    // full recent-changes view.
    if (!deletedOnly) {
        const revisionRows = sql.getRows<RecentChangeRow>(`
            SELECT
                notes.noteId,
                notes.isDeleted AS current_isDeleted,
                notes.deleteId AS current_deleteId,
                notes.title AS current_title,
                notes.isProtected AS current_isProtected,
                revisions.title,
                revisions.utcDateCreated AS utcDate,
                revisions.dateCreated AS date
            FROM
                revisions
                JOIN notes USING(noteId)`);

        for (const revisionRow of revisionRows) {
            const note = becca.getNote(revisionRow.noteId);

            // for deleted notes, the becca note is null, and it's not possible to (easily) determine if it belongs to a subtree
            if (ancestorNoteId === "root" || note?.hasAncestor(ancestorNoteId)) {
                recentChanges.push(revisionRow);
            }
        }
    }

    // Date points from the notes table:
    //  - deleted-only view: just the deletion point (dateModified), so each deleted note appears exactly once
    //  - full view: creation (dateCreated) for every note, plus deletion (dateModified) for deleted notes
    const noteRows = sql.getRows<RecentChangeRow>(deletedOnly ? `
            SELECT
                notes.noteId,
                notes.isDeleted AS current_isDeleted,
                notes.deleteId AS current_deleteId,
                notes.title AS current_title,
                notes.isProtected AS current_isProtected,
                notes.title,
                notes.utcDateModified AS utcDate,
                notes.dateModified AS date
            FROM notes
            WHERE notes.isDeleted = 1` : `
            SELECT
                notes.noteId,
                notes.isDeleted AS current_isDeleted,
                notes.deleteId AS current_deleteId,
                notes.title AS current_title,
                notes.isProtected AS current_isProtected,
                notes.title,
                notes.utcDateCreated AS utcDate, -- different from the second SELECT
                notes.dateCreated AS date        -- different from the second SELECT
            FROM notes
        UNION ALL
            SELECT
                notes.noteId,
                notes.isDeleted AS current_isDeleted,
                notes.deleteId AS current_deleteId,
                notes.title AS current_title,
                notes.isProtected AS current_isProtected,
                notes.title,
                notes.utcDateModified AS utcDate, -- different from the first SELECT
                notes.dateModified AS date        -- different from the first SELECT
            FROM notes
            WHERE notes.isDeleted = 1`);

    for (const noteRow of noteRows) {
        const note = becca.getNote(noteRow.noteId);

        // for deleted notes, the becca note is null, and it's not possible to (easily) determine if it belongs to a subtree
        if (ancestorNoteId === "root" || note?.hasAncestor(ancestorNoteId)) {
            recentChanges.push(noteRow);
        }
    }

    recentChanges.sort((a, b) => (a.utcDate > b.utcDate ? -1 : 1));

    recentChanges = recentChanges.slice(0, Math.min(500, recentChanges.length));

    for (const change of recentChanges) {
        if (change.current_isProtected) {
            if (protectedSessionService.isProtectedSessionAvailable()) {
                change.title = protectedSessionService.decryptString(change.title) || "[protected]";
                change.current_title = protectedSessionService.decryptString(change.current_title) || "[protected]";
            } else {
                change.title = change.current_title = "[protected]";
            }
        }

        if (change.current_isDeleted) {
            const deleteId = change.current_deleteId;

            const undeletedParentBranchIds = noteService.getUndeletedParentBranchIds(change.noteId, deleteId);

            // note (and the subtree) can be undeleted if there's at least one undeleted parent (whose branch would be undeleted by this op)
            change.canBeUndeleted = undeletedParentBranchIds.length > 0;
        }
    }

    return recentChanges;
}

export default {
    getRecentChanges
};
