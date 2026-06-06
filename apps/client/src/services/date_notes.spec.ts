import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildNote } from "../test/easy-froca";
import dateNotes from "./date_notes.js";
import server from "./server.js";
import ws from "./ws.js";

// The global ws mock from setup.ts does not define waitForMaxKnownEntityChangeId, so provide it.
ws.waitForMaxKnownEntityChangeId = vi.fn(async () => {});

describe("date_notes", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        ws.waitForMaxKnownEntityChangeId = vi.fn(async () => {});
    });

    it("getInboxNote resolves the note returned by the server", async () => {
        const note = buildNote({ title: "Inbox" });
        server.get = vi.fn(async () => ({ noteId: note.noteId })) as typeof server.get;

        const result = await dateNotes.getInboxNote();

        expect(server.get).toHaveBeenCalledWith(
            expect.stringMatching(/^special-notes\/inbox\/\d{4}-\d{2}-\d{2}$/),
            "date-note"
        );
        // getInboxNote is the only day-note-style helper that intentionally skips the
        // change-id wait, unlike every sibling which awaits it.
        expect(ws.waitForMaxKnownEntityChangeId).not.toHaveBeenCalled();
        expect(result).toBe(note);
    });

    it("getTodayNote resolves today's day note", async () => {
        const note = buildNote({ title: "Today" });
        server.get = vi.fn(async () => ({ noteId: note.noteId })) as typeof server.get;

        const result = await dateNotes.getTodayNote();

        expect(server.get).toHaveBeenCalledWith(
            expect.stringMatching(/^special-notes\/days\/\d{4}-\d{2}-\d{2}$/),
            "date-note"
        );
        expect(ws.waitForMaxKnownEntityChangeId).toHaveBeenCalled();
        expect(result).toBe(note);
    });

    it("getDayNote omits calendarRootId when not provided", async () => {
        const note = buildNote({ title: "Day" });
        server.get = vi.fn(async () => ({ noteId: note.noteId })) as typeof server.get;

        const result = await dateNotes.getDayNote("2025-05-29");

        expect(server.get).toHaveBeenCalledWith("special-notes/days/2025-05-29", "date-note");
        expect(result).toBe(note);
    });

    it("getDayNote appends calendarRootId when provided", async () => {
        const note = buildNote({ title: "Day in root" });
        server.get = vi.fn(async () => ({ noteId: note.noteId })) as typeof server.get;

        const result = await dateNotes.getDayNote("2025-05-29", "rootXYZ");

        expect(server.get).toHaveBeenCalledWith(
            "special-notes/days/2025-05-29?calendarRootId=rootXYZ",
            "date-note"
        );
        expect(result).toBe(note);
    });

    it("getWeekFirstDayNote queries week-first-day endpoint", async () => {
        const note = buildNote({ title: "Week first day" });
        server.get = vi.fn(async () => ({ noteId: note.noteId })) as typeof server.get;

        const result = await dateNotes.getWeekFirstDayNote("2025-05-29");

        expect(server.get).toHaveBeenCalledWith("special-notes/week-first-day/2025-05-29", "date-note");
        expect(result).toBe(note);
    });

    it("getWeekNote queries weeks endpoint", async () => {
        const note = buildNote({ title: "Week" });
        server.get = vi.fn(async () => ({ noteId: note.noteId })) as typeof server.get;

        const result = await dateNotes.getWeekNote("2025-W22");

        expect(server.get).toHaveBeenCalledWith("special-notes/weeks/2025-W22", "date-note");
        expect(result).toBe(note);
    });

    it("getWeekNote tolerates a missing server response via optional chaining", async () => {
        // getWeekNote is the only helper using froca.getNote(note?.noteId); a null server
        // response must resolve to null (froca.getNote(undefined) returns null) instead of throwing.
        server.get = vi.fn(async () => null) as typeof server.get;

        const result = await dateNotes.getWeekNote("2025-W22");

        expect(server.get).toHaveBeenCalledWith("special-notes/weeks/2025-W22", "date-note");
        expect(ws.waitForMaxKnownEntityChangeId).toHaveBeenCalled();
        expect(result).toBeNull();
    });

    it("getMonthNote queries months endpoint", async () => {
        const note = buildNote({ title: "Month" });
        server.get = vi.fn(async () => ({ noteId: note.noteId })) as typeof server.get;

        const result = await dateNotes.getMonthNote("2025-05");

        expect(server.get).toHaveBeenCalledWith("special-notes/months/2025-05", "date-note");
        expect(result).toBe(note);
    });

    it("getQuarterNote queries quarters endpoint", async () => {
        const note = buildNote({ title: "Quarter" });
        server.get = vi.fn(async () => ({ noteId: note.noteId })) as typeof server.get;

        const result = await dateNotes.getQuarterNote("2025-Q2");

        expect(server.get).toHaveBeenCalledWith("special-notes/quarters/2025-Q2", "date-note");
        expect(result).toBe(note);
    });

    it("getYearNote queries years endpoint", async () => {
        const note = buildNote({ title: "Year" });
        server.get = vi.fn(async () => ({ noteId: note.noteId })) as typeof server.get;

        const result = await dateNotes.getYearNote("2025");

        expect(server.get).toHaveBeenCalledWith("special-notes/years/2025", "date-note");
        expect(result).toBe(note);
    });

    it("createSqlConsole posts and resolves the note", async () => {
        const note = buildNote({ title: "SQL console" });
        server.post = vi.fn(async () => ({ noteId: note.noteId })) as typeof server.post;

        const result = await dateNotes.createSqlConsole();

        expect(server.post).toHaveBeenCalledWith("special-notes/sql-console");
        expect(result).toBe(note);
    });

    it("createSearchNote posts with default empty opts", async () => {
        const note = buildNote({ title: "Search" });
        server.post = vi.fn(async () => ({ noteId: note.noteId })) as typeof server.post;

        const result = await dateNotes.createSearchNote();

        expect(server.post).toHaveBeenCalledWith("special-notes/search-note", {});
        expect(result).toBe(note);
    });

    it("createSearchNote posts with provided opts", async () => {
        const note = buildNote({ title: "Search with opts" });
        server.post = vi.fn(async () => ({ noteId: note.noteId })) as typeof server.post;

        const result = await dateNotes.createSearchNote({ searchString: "foo" });

        expect(server.post).toHaveBeenCalledWith("special-notes/search-note", { searchString: "foo" });
        expect(result).toBe(note);
    });

    it("createLlmChat posts and resolves the note", async () => {
        const note = buildNote({ title: "LLM chat" });
        server.post = vi.fn(async () => ({ noteId: note.noteId })) as typeof server.post;

        const result = await dateNotes.createLlmChat();

        expect(server.post).toHaveBeenCalledWith("special-notes/llm-chat");
        expect(result).toBe(note);
    });

    it("getMostRecentLlmChat returns null when the server has no chat", async () => {
        server.get = vi.fn(async () => null) as typeof server.get;

        const result = await dateNotes.getMostRecentLlmChat();

        expect(result).toBeNull();
        expect(ws.waitForMaxKnownEntityChangeId).not.toHaveBeenCalled();
    });

    it("getMostRecentLlmChat resolves the note when one exists", async () => {
        const note = buildNote({ title: "Recent chat" });
        server.get = vi.fn(async () => ({ noteId: note.noteId })) as typeof server.get;

        const result = await dateNotes.getMostRecentLlmChat();

        expect(server.get).toHaveBeenCalledWith("special-notes/most-recent-llm-chat");
        expect(ws.waitForMaxKnownEntityChangeId).toHaveBeenCalled();
        expect(result).toBe(note);
    });

    it("getOrCreateLlmChat resolves the note", async () => {
        const note = buildNote({ title: "Persistent chat" });
        server.get = vi.fn(async () => ({ noteId: note.noteId })) as typeof server.get;

        const result = await dateNotes.getOrCreateLlmChat();

        expect(server.get).toHaveBeenCalledWith("special-notes/get-or-create-llm-chat");
        expect(result).toBe(note);
    });

    it("getRecentLlmChats uses the default limit and returns the list", async () => {
        const chats = [{ noteId: "a", title: "A", dateModified: "2025-05-29" }];
        server.get = vi.fn(async () => chats) as typeof server.get;

        const result = await dateNotes.getRecentLlmChats();

        expect(server.get).toHaveBeenCalledWith("special-notes/recent-llm-chats?limit=10");
        expect(result).toBe(chats);
    });

    it("getRecentLlmChats honours an explicit limit", async () => {
        const chats = [{ noteId: "b", title: "B", dateModified: "2025-05-29" }];
        server.get = vi.fn(async () => chats) as typeof server.get;

        const result = await dateNotes.getRecentLlmChats(3);

        expect(server.get).toHaveBeenCalledWith("special-notes/recent-llm-chats?limit=3");
        expect(result).toBe(chats);
    });
});
