import type { Request } from "express";

import becca from "../../becca/becca.js";
import cls from "../../services/cls.js";
import dateNoteService from "../../services/date_notes.js";
import specialNotesService, { type LauncherType } from "../../services/special_notes.js";
import sql from "../../services/sql.js";

function getInboxNote(req: Request<{ date: string }>) {
    return specialNotesService.getInboxNote(req.params.date);
}

function getDayNote(req: Request<{ date: string }>) {
    const calendarRootId = req.query.calendarRootId;
    const calendarRoot = typeof calendarRootId === "string" ? becca.getNoteOrThrow(calendarRootId) : null;
    return dateNoteService.getDayNote(req.params.date, calendarRoot);
}

function getWeekFirstDayNote(req: Request<{ date: string }>) {
    return dateNoteService.getWeekFirstDayNote(req.params.date);
}

function getWeekNote(req: Request<{ week: string }>) {
    return dateNoteService.getWeekNote(req.params.week);
}

function getMonthNote(req: Request<{ month: string }>) {
    return dateNoteService.getMonthNote(req.params.month);
}

function getQuarterNote(req: Request<{ quarter: string }>) {
    return dateNoteService.getQuarterNote(req.params.quarter);
}

function getYearNote(req: Request<{ year: string }>) {
    return dateNoteService.getYearNote(req.params.year);
}

function getDayNotesForMonth(req: Request) {
    const month = req.params.month;
    const calendarRoot = req.query.calendarRoot;
    const query = `\
        SELECT
            attr.value AS date,
            notes.noteId
        FROM notes
        JOIN attributes attr USING(noteId)
        WHERE notes.isDeleted = 0
            AND attr.isDeleted = 0
            AND attr.type = 'label'
            AND attr.name = 'dateNote'
            AND attr.value LIKE '${month}%'`;

    if (calendarRoot) {
        const rows = sql.getRows<{ date: string; noteId: string }>(query);
        const result: Record<string, string> = {};
        for (const { date, noteId } of rows) {
            const note = becca.getNote(noteId);
            if (note?.hasAncestor(String(calendarRoot))) {
                result[date] = noteId;
            }
        }

        return result;
    }
    return sql.getMap(query);
}

async function saveSqlConsole(req: Request) {
    return await specialNotesService.saveSqlConsole(req.body.sqlConsoleNoteId);
}

function createSqlConsole() {
    return specialNotesService.createSqlConsole();
}

function saveSearchNote(req: Request) {
    return specialNotesService.saveSearchNote(req.body.searchNoteId);
}

function createSearchNote(req: Request) {
    const hoistedNote = getHoistedNote();
    const searchString = req.body.searchString || "";
    const ancestorNoteId = req.body.ancestorNoteId || hoistedNote?.noteId;

    return specialNotesService.createSearchNote(searchString, ancestorNoteId);
}

function createLlmChat() {
    return specialNotesService.createLlmChat();
}

function getMostRecentLlmChat() {
    const chat = specialNotesService.getMostRecentLlmChat();
    // Return null explicitly if no chat found (not undefined)
    return chat || null;
}

function getOrCreateLlmChat() {
    return specialNotesService.getOrCreateLlmChat();
}

function getRecentLlmChats(req: Request) {
    const limit = parseInt(req.query.limit as string) || 10;
    return specialNotesService.getRecentLlmChats(limit);
}

function saveLlmChat(req: Request) {
    return specialNotesService.saveLlmChat(req.body.llmChatNoteId);
}

function getHoistedNote() {
    return becca.getNote(cls.getHoistedNoteId());
}

function createLauncher(req: Request<{ parentNoteId: string, launcherType: string }>) {
    return specialNotesService.createLauncher({
        parentNoteId: req.params.parentNoteId,
        // TODO: Validate the parameter
        launcherType: req.params.launcherType as LauncherType
    });
}

function resetLauncher(req: Request<{ noteId: string }>) {
    return specialNotesService.resetLauncher(req.params.noteId);
}

function createOrUpdateScriptLauncherFromApi(req: Request) {
    return specialNotesService.createOrUpdateScriptLauncherFromApi(req.body);
}

export default {
    getInboxNote,
    getDayNote,
    getWeekFirstDayNote,
    getWeekNote,
    getMonthNote,
    getQuarterNote,
    getYearNote,
    getDayNotesForMonth,
    createSqlConsole,
    saveSqlConsole,
    createSearchNote,
    saveSearchNote,
    createLlmChat,
    getMostRecentLlmChat,
    getOrCreateLlmChat,
    getRecentLlmChats,
    saveLlmChat,
    createLauncher,
    resetLauncher,
    createOrUpdateScriptLauncherFromApi
};
