import { dayjs } from "@triliumnext/commons";

import type { FNoteRow } from "../entities/fnote.js";
import froca from "./froca.js";
import server from "./server.js";
import ws from "./ws.js";

async function getInboxNote() {
    const note = await server.get<FNoteRow>(`special-notes/inbox/${dayjs().format("YYYY-MM-DD")}`, "date-note");

    return await froca.getNote(note.noteId);
}

async function getTodayNote() {
    return await getDayNote(dayjs().format("YYYY-MM-DD"));
}

async function getDayNote(date: string, calendarRootId?: string) {
    let url = `special-notes/days/${date}`;
    if (calendarRootId) {
        url += `?calendarRootId=${calendarRootId}`;
    }

    const note = await server.get<FNoteRow>(url, "date-note");

    await ws.waitForMaxKnownEntityChangeId();

    return await froca.getNote(note.noteId);
}

async function getWeekFirstDayNote(date: string) {
    const note = await server.get<FNoteRow>(`special-notes/week-first-day/${date}`, "date-note");

    await ws.waitForMaxKnownEntityChangeId();

    return await froca.getNote(note.noteId);
}

async function getWeekNote(week: string) {
    const note = await server.get<FNoteRow>(`special-notes/weeks/${week}`, "date-note");

    await ws.waitForMaxKnownEntityChangeId();

    return await froca.getNote(note?.noteId);
}

async function getMonthNote(month: string) {
    const note = await server.get<FNoteRow>(`special-notes/months/${month}`, "date-note");

    await ws.waitForMaxKnownEntityChangeId();

    return await froca.getNote(note.noteId);
}

async function getQuarterNote(quarter: string) {
    const note = await server.get<FNoteRow>(`special-notes/quarters/${quarter}`, "date-note");

    await ws.waitForMaxKnownEntityChangeId();

    return await froca.getNote(note.noteId);
}

async function getYearNote(year: string) {
    const note = await server.get<FNoteRow>(`special-notes/years/${year}`, "date-note");

    await ws.waitForMaxKnownEntityChangeId();

    return await froca.getNote(note.noteId);
}

async function createSqlConsole() {
    const note = await server.post<FNoteRow>("special-notes/sql-console");

    await ws.waitForMaxKnownEntityChangeId();

    return await froca.getNote(note.noteId);
}

async function createSearchNote(opts = {}) {
    const note = await server.post<FNoteRow>("special-notes/search-note", opts);

    await ws.waitForMaxKnownEntityChangeId();

    return await froca.getNote(note.noteId);
}

async function createLlmChat() {
    const note = await server.post<FNoteRow>("special-notes/llm-chat");

    await ws.waitForMaxKnownEntityChangeId();

    return await froca.getNote(note.noteId);
}

/**
 * Gets the most recently modified LLM chat.
 * Returns null if no chat exists.
 */
async function getMostRecentLlmChat() {
    const note = await server.get<FNoteRow | null>("special-notes/most-recent-llm-chat");

    if (!note) {
        return null;
    }

    await ws.waitForMaxKnownEntityChangeId();

    return await froca.getNote(note.noteId);
}

/**
 * Gets the most recent LLM chat, or creates a new one if none exists.
 * Used by sidebar chat for persistent conversations across page refreshes.
 */
async function getOrCreateLlmChat() {
    const note = await server.get<FNoteRow>("special-notes/get-or-create-llm-chat");

    await ws.waitForMaxKnownEntityChangeId();

    return await froca.getNote(note.noteId);
}

export interface RecentLlmChat {
    noteId: string;
    title: string;
    dateModified: string;
}

/**
 * Gets a list of recent LLM chats for the history popup.
 */
async function getRecentLlmChats(limit: number = 10): Promise<RecentLlmChat[]> {
    return await server.get<RecentLlmChat[]>(`special-notes/recent-llm-chats?limit=${limit}`);
}

export default {
    getInboxNote,
    getTodayNote,
    getDayNote,
    getWeekFirstDayNote,
    getWeekNote,
    getQuarterNote,
    getMonthNote,
    getYearNote,
    createSqlConsole,
    createSearchNote,
    createLlmChat,
    getMostRecentLlmChat,
    getOrCreateLlmChat,
    getRecentLlmChats
};
