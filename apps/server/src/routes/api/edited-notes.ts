import dayjs from "dayjs";
import beccaService from "../../becca/becca_service.js";
import sql from "../../services/sql.js";
import cls from "../../services/cls.js";
import becca from "../../becca/becca.js";
import type { Request } from "express";
import { NotePojo } from "../../becca/becca-interface.js";
import type BNote from "../../becca/entities/bnote.js";
import { EditedNotesResponse } from "@triliumnext/commons";
import dateUtils from "../../services/date_utils.js";

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
    const dateFilter = dateNoteLabelKeywordToDateFilter(req.params.date);

    if (!dateFilter.date) {
        return {
            notes: [],
            limit: 0,
        } satisfies EditedNotesResponse;
    }

    const sqlParams = {
        date: dateFilter.date + "%",
        limit: 50,
    };
    const sqlQuery = /*sql*/`\
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
        LIMIT :limit`;

    const noteIds = sql.getColumn<string>(
        sqlQuery,
        sqlParams
    );

    let notes = becca.getNotes(noteIds, true);

    // Narrow down the results if a note is hoisted, similar to "Jump to note".
    const hoistedNoteId = cls.getHoistedNoteId();
    if (hoistedNoteId !== "root") {
        notes = notes.filter((note) => note.hasAncestor(hoistedNoteId));
    }

    const editedNotes = notes.map((note) => {
        const notePath = getNotePathData(note);

        const notePojo: NotePojoWithNotePath = note.getPojo();
        notePojo.notePath = notePath ? notePath.notePath : null;

        return notePojo;
    });

    return {
        notes: editedNotes,
        limit: sqlParams.limit,
    } satisfies EditedNotesResponse;
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

const formatMap = new Map<string, { format: string, addUnit: dayjs.UnitType }>([
    ["today", { format: "YYYY-MM-DD", addUnit: "day" }],
    ["month", { format: "YYYY-MM", addUnit: "month" }],
    ["year", { format: "YYYY", addUnit: "year" }]
]);

function formatDateFromKeywordAndDelta(
    startingDate: dayjs.Dayjs,
    keyword: string,
    delta: number
): string {
    const handler = formatMap.get(keyword);

    if (!handler) {
        throw new Error(`Unrecognized keyword: ${keyword}`);
    }

    const date = startingDate.add(delta, handler.addUnit);
    return date.format(handler.format);
}

interface DateValue {
    // kind: "date",
    date: string | null,
}

type DateFilter = DateValue;

/**
 * Resolves a date string into a concrete date representation.
 * The date string can be a keyword with an optional delta, or a standard date format.
 *
 * Supported keywords are:
 * - `today`: Resolves to the current date in `YYYY-MM-DD` format.
 * - `month`: Resolves to the current month in `YYYY-MM` format.
 * - `year`: Resolves to the current year in `YYYY` format.
 *
 * An optional delta can be appended to the keyword to specify an offset.
 * For example:
 * - `today-1` resolves to yesterday.
 * - `month+2` resolves to the month after next.
 * - `year-10` resolves to 10 years ago.
 *
 * If the `dateStr` does not match a keyword pattern, it is returned as is.
 * This is to support standard date formats like `YYYY-MM-DD`, `YYYY-MM`, or `YYYY`.
 *
 * @param dateStr A string representing the date. This can be a keyword
 *                (e.g., "today", "month-1", "year+5") or a date string
 *                (e.g., "2023-10-27", "2023-10", "2023").
 * @returns A `DateFilter` object containing the resolved date string.
 */
export function dateNoteLabelKeywordToDateFilter(dateStr: string): DateFilter {
    const keywordAndDelta = dateStr.match(/^(today|month|year)\s*([+-]\s*\d+)?$/i);

    if (keywordAndDelta) {
        const keyword = keywordAndDelta[1].toLowerCase();
        const delta = parseInt(keywordAndDelta[2]?.replace(/\s/g, "") ?? "0");

        const clientDate = dayjs(dateUtils.localNowDate());
        const date = formatDateFromKeywordAndDelta(clientDate, keyword, delta);
        return {
            date: date
        };
    }

    // Check if it's a valid date format (YYYY-MM-DD, YYYY-MM, or YYYY)
    const isDatePrefix = isValidDatePrefix(dateStr);

    if (isDatePrefix) {
        return {
            date: dateStr
        };
    } else {
        // Not a keyword and not a valid date prefix
        return {
            date: null
        }
    }
}

function isValidDatePrefix(dateStr: string): boolean {
    // Check if it starts with YYYY format and only contains numbers and dashes afterwards
    if (/^\d{4}[-\d]*$/.test(dateStr)) {
        const year = parseInt(dateStr.substring(0, 4));
        return !isNaN(year) && year > 0 && year < 10000;
    }

    return false;
}

export default {
    getEditedNotesOnDate,
};
