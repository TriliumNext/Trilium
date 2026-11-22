import protectedSessionService from "../../services/protected_session.js";
import noteService from "../../services/notes.js";
import becca from "../../becca/becca.js";
import type { Request } from "../../http_interface";
import type { RecentChangeRow } from "@triliumnext/commons";
import { ValidationError } from "../../errors.js";
import { getUserId } from "../../services/context.js";
import { getSql } from "../../services/sql/index.js";

function getRecentChanges(req: Request<{ ancestorNoteId: string }, { deletedOnly?: string }>) {
    const { ancestorNoteId } = req.params;
    const deletedOnly = req.query.deletedOnly === "true";

    let recentChanges: RecentChangeRow[] = [];

    const sql = getSql();
    const isListed = createChangeFilter(ancestorNoteId);

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

        for (const row of revisionRows) {
            if (isListed(row)) {
                recentChanges.push(row);
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

    for (const row of noteRows) {
        if (isListed(row)) {
            recentChanges.push(row);
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

/**
 * Decides which rows of the ancestor's recent changes the current scope lists. A deleted note has
 * left the Becca, so `hasAncestor()` cannot place it in a subtree and the member's view cannot
 * see it: only the "root" list holds deleted notes, and a member sees only the ones they own.
 */
function createChangeFilter(ancestorNoteId: string) {
    const ownDeletedNoteIds = becca.getView()
        ? new Set(getSql().getColumn<string>(
            "SELECT noteId FROM notes WHERE isDeleted = 1 AND ownerId = ?", [ getUserId() ]))
        : null;

    return (row: RecentChangeRow) => {
        if (row.current_isDeleted) {
            return ancestorNoteId === "root"
                && (!ownDeletedNoteIds || ownDeletedNoteIds.has(row.noteId));
        }

        const note = becca.getNote(row.noteId);
        return !!note && (ancestorNoteId === "root" || note.hasAncestor(ancestorNoteId));
    };
}

/** Returns the IDs of the most recently modified live notes under the ancestor, newest first. */
function getRecentlyChangedNoteIds(req: Request<{ ancestorNoteId: string }, { limit?: string }>) {
    const { ancestorNoteId } = req.params;
    const limit = Number.parseInt(req.query.limit ?? "", 10);
    if (!(limit > 0)) {
        throw new ValidationError("'limit' must be a positive integer.");
    }

    const noteIds: string[] = [];
    // Walks `IDX_notes_isDeleted_utcDateModified` and stops once the list is full.
    const rows = getSql().iterateRows<{ noteId: string }>(`
        SELECT noteId FROM notes WHERE isDeleted = 0 ORDER BY utcDateModified DESC`);

    for (const { noteId } of rows) {
        const note = becca.getNote(noteId);
        if (!note?.hasAncestor(ancestorNoteId)) {
            continue;
        }

        // `BNote.isHiddenCompletely()` is false for `_hidden` itself.
        if (ancestorNoteId === "root" && (noteId === "_hidden" || note.isHiddenCompletely())) {
            continue;
        }

        noteIds.push(noteId);
        if (noteIds.length === limit) {
            break;
        }
    }

    return noteIds;
}

export default {
    getRecentChanges,
    getRecentlyChangedNoteIds
};
