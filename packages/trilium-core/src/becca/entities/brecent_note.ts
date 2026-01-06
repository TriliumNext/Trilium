"use strict";

import type { RecentNoteRow } from "@triliumnext/commons";

import dateUtils from "../../services/utils/date";
import AbstractBeccaEntity from "./abstract_becca_entity.js";

/**
 * RecentNote represents recently visited note.
 */
class BRecentNote extends AbstractBeccaEntity<BRecentNote> {
    static get entityName() {
        return "recent_notes";
    }
    static get primaryKeyName() {
        return "noteId";
    }
    static get hashedProperties() {
        return ["noteId", "notePath"];
    }

    noteId!: string;
    notePath!: string;

    constructor(row: RecentNoteRow) {
        super();

        this.updateFromRow(row);
    }

    updateFromRow(row: RecentNoteRow): void {
        this.noteId = row.noteId;
        this.notePath = row.notePath;
        this.utcDateCreated = row.utcDateCreated || dateUtils.utcNowDateTime();
    }

    getPojo() {
        return {
            noteId: this.noteId,
            notePath: this.notePath,
            utcDateCreated: this.utcDateCreated
        };
    }
}

export default BRecentNote;
