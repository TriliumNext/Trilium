import { events as eventService } from "@triliumnext/core";

import log from "../../services/log.js";
import shareRoot from "../share_root.js";
import sql from "../sql.js";
import type { SAttachmentRow, SAttributeRow, SBranchRow, SNoteRow } from "./entities/rows.js";
import SAttachment from "./entities/sattachment.js";
import SAttribute from "./entities/sattribute.js";
import SBranch from "./entities/sbranch.js";
import SNote from "./entities/snote.js";
import shaca from "./shaca.js";

function load() {
    const start = Date.now();
    shaca.reset();

    // using a raw query and passing arrays to avoid allocating new objects

    const noteIds = sql.getColumn(
        `
        WITH RECURSIVE
        tree(noteId) AS (
            SELECT ?
            UNION
            SELECT branches.noteId FROM branches
            JOIN tree ON branches.parentNoteId = tree.noteId
            WHERE branches.isDeleted = 0
        )
        SELECT noteId FROM tree`,
        [shareRoot.SHARE_ROOT_NOTE_ID]
    );

    if (noteIds.length === 0) {
        shaca.loaded = true;

        return;
    }

    const noteIdStr = noteIds.map((noteId) => `'${noteId}'`).join(",");

    const rawNoteRows = sql.getRawRows<SNoteRow>(`
        SELECT noteId, title, type, mime, blobId, utcDateModified, isProtected
        FROM notes
        WHERE isDeleted = 0
        AND noteId IN (${noteIdStr})`);

    for (const row of rawNoteRows) {
        new SNote(row);
    }

    const rawBranchRows = sql.getRawRows<SBranchRow>(`
        SELECT branchId, noteId, parentNoteId, prefix, isExpanded, utcDateModified
        FROM branches
        WHERE isDeleted = 0
        AND parentNoteId IN (${noteIdStr})
        ORDER BY notePosition`);

    for (const row of rawBranchRows) {
        new SBranch(row);
    }

    const rawAttributeRows = sql.getRawRows<SAttributeRow>(`
        SELECT attributeId, noteId, type, name, value, isInheritable, position, utcDateModified
        FROM attributes
        WHERE isDeleted = 0
        AND noteId IN (${noteIdStr})`);

    for (const row of rawAttributeRows) {
        new SAttribute(row);
    }

    const rawAttachmentRows = sql.getRawRows<SAttachmentRow>(`
        SELECT attachmentId, ownerId, role, mime, title, blobId, utcDateModified
        FROM attachments
        WHERE isDeleted = 0
        AND ownerId IN (${noteIdStr})`);

    for (const row of rawAttachmentRows) {
        new SAttachment(row);
    }

    shaca.loaded = true;

    log.info(`Shaca loaded ${rawNoteRows.length} notes, ${rawBranchRows.length} branches, ${rawAttachmentRows.length} attributes took ${Date.now() - start}ms`);
}

function ensureLoad() {
    if (!shaca.loaded) {
        load();
    }
}

eventService.subscribe(
    [eventService.ENTITY_CREATED, eventService.ENTITY_CHANGED, eventService.ENTITY_DELETED, eventService.ENTITY_CHANGE_SYNCED, eventService.ENTITY_DELETE_SYNCED],
    () => {
        shaca.reset();
    }
);

export default {
    load,
    ensureLoad
};
