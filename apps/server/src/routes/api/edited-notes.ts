import beccaService from "../../becca/becca_service.js";
import sql from "../../services/sql.js";
import cls from "../../services/cls.js";
import becca from "../../becca/becca.js";
import type { Request } from "express";
import { NotePojo } from "../../becca/becca-interface.js";
import type BNote from "../../becca/entities/bnote.js";
import { EditedNotesResponse } from "@triliumnext/commons";
import dayjs from "dayjs";

interface NotePath {
    noteId: string;
    branchId?: string;
    title: string;
    notePath: string[];
    path: string;
}

interface NotePojoWithNotePath extends NotePojo {
    notePath?: string[] | null;
}

function getEditedNotesOnDate(req: Request) {
    const resolvedDateParams = resolveDateParams(req.params.date);

    const sqlParams = { date: resolvedDateParams.date + "%" };

    const noteIds = sql.getColumn<string>(/*sql*/`\
        SELECT notes.*
        FROM notes
        WHERE noteId IN (
                SELECT noteId FROM notes
                WHERE
                    (notes.dateCreated LIKE :date OR notes.dateModified LIKE :date)
                    AND (notes.noteId NOT LIKE '\\_%' ESCAPE '\\')
            UNION ALL
                SELECT noteId FROM revisions
                WHERE revisions.dateCreated LIKE :date
        )
        ORDER BY isDeleted
        LIMIT 50`,
        sqlParams
    );

    let notes = becca.getNotes(noteIds, true);

    // Narrow down the results if a note is hoisted, similar to "Jump to note".
    const hoistedNoteId = cls.getHoistedNoteId();
    if (hoistedNoteId !== "root") {
        notes = notes.filter((note) => note.hasAncestor(hoistedNoteId));
    }

    return notes.map((note) => {
        const notePath = getNotePathData(note);

        const notePojo: NotePojoWithNotePath = note.getPojo();
        notePojo.notePath = notePath ? notePath.notePath : null;

        return notePojo;
    }) satisfies EditedNotesResponse;
}

function getNotePathData(note: BNote): NotePath | undefined {
    const retPath = note.getBestNotePath();

    if (retPath) {
        const noteTitle = beccaService.getNoteTitleForPath(retPath);

        let branchId;

        if (note.isRoot()) {
            branchId = "none_root";
        } else {
            const parentNote = note.parents[0];
            branchId = becca.getBranchFromChildAndParent(note.noteId, parentNote.noteId)?.branchId;
        }

        return {
            noteId: note.noteId,
            branchId: branchId,
            title: noteTitle,
            notePath: retPath,
            path: retPath.join("/")
        };
    }
}

function formatDateFromKeywordAndDelta(keyword: string, delta: number): string {
    const formatMap = new Map<string, { format: string, addUnit: dayjs.UnitType }>([
        ["today", { format: "YYYY-MM-DD", addUnit: "day" }],
        ["month", { format: "YYYY-MM", addUnit: "month" }],
        ["year", { format: "YYYY", addUnit: "year" }]
    ]);

    const handler = formatMap.get(keyword);

    if (!handler) {
        throw new Error(`Unrecognized keyword: ${keyword}`);
    }

    const date = dayjs().add(delta, handler.addUnit);
    return date.format(handler.format);
}

interface DateValue {
    // kind: "date",
    date: string,
}

type DateFilter = DateValue;

/**
 * Resolves date keyword with optional delta (e.g., "TODAY-1") to date
 * @param dateStr date keyword (TODAY, MONTH, YEAR) or date in format YYYY-MM-DD (or beggining)
 * @returns
 */
export function resolveDateParams(dateStr: string): DateFilter {
    const match = dateStr.match(/^(today|month|year)([+-]\d+)?$/i);

    if (!match) {
        return {
            date: `${dateStr}`
        }
    }

    const keyword = match[1].toLowerCase();
    const delta = match[2] ? parseInt(match[2]) : 0;

    const date = formatDateFromKeywordAndDelta(keyword, delta);
    return {
        date: `${date}`
    }
}

export default {
    getEditedNotesOnDate,
};
