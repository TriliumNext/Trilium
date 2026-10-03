import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
    getActiveContextNoteId, getActiveContext, getInboxTarget, getInboxNotePath, chooseNoteType, createNote, translate, logError,
    getAllCommands, searchCommands
} = vi.hoisted(() => ({
    getActiveContextNoteId: vi.fn<() => string | null>(() => "activeNote"),
    getActiveContext: vi.fn<() => { hoistedNoteId: string } | undefined>(() => ({ hoistedNoteId: "hoisted" })),
    getInboxNotePath: vi.fn<() => Promise<string | undefined>>(async () => "root/inbox"),
    chooseNoteType: vi.fn(),
    createNote: vi.fn(),
    getInboxTarget: vi.fn<() => Promise<unknown>>(
        async () => ({ kind: "inbox", noteId: "inb", title: "Inbox" })
    ),
    // i18next is never initialized here, so the real `t` returns undefined. Echoing the key keeps
    // the label assertions about which string is chosen rather than about its English.
    translate: vi.fn((key: string, _opts?: Record<string, unknown>) => key),
    logError: vi.fn(),
    getAllCommands: vi.fn(() => [] as CommandDefinition[]),
    searchCommands: vi.fn((_query: string) => [] as CommandDefinition[])
}));

vi.mock("./command_registry.js", () => ({
    default: { getAllCommands, searchCommands }
}));

vi.mock("../components/app_context.js", () => ({
    default: { tabManager: { getActiveContextNoteId, getActiveContext } }
}));

vi.mock("./date_notes.js", () => ({
    default: { getInboxTarget, getInboxNotePath }
}));

vi.mock("./note_create.js", () => ({
    default: { chooseNoteType, createNote }
}));

vi.mock("./i18n.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./i18n.js")>()),
    t: translate
}));

// Narrows the blanket ws mock from test/setup.ts to a spy, so what the module reports can be asserted.
vi.mock("./ws.js", () => ({
    default: {
        subscribeToMessages() {},
        async waitForMaxKnownEntityChangeId() {}
    },
    subscribeToMessages() {},
    unsubscribeToMessage() {},
    async waitForMaxKnownEntityChangeId() {},
    logError
}));

import type { CommandDefinition } from "./command_registry.js";
import { createNoteFromSuggestion, createSearchScheduler, getCommandSuggestions, getNoteSuggestions, recentNoteGroup, type Suggestion } from "./note_autocomplete.js";
import server from "./server.js";

beforeEach(() => {
    vi.clearAllMocks();
    getActiveContextNoteId.mockReturnValue("activeNote");
    getActiveContext.mockReturnValue({ hoistedNoteId: "hoisted" });
    server.get = vi.fn(async () => []) as typeof server.get;
});

describe("getNoteSuggestions", () => {
    it("queries the server and returns its rows as they are", async () => {
        server.get = vi.fn(async () => [ { noteTitle: "Result", notePath: "root/x" } ]) as typeof server.get;

        expect(await getNoteSuggestions("a b")).toEqual([ { noteTitle: "Result", notePath: "root/x" } ]);
        expect(server.get).toHaveBeenCalledWith("autocomplete?query=a%20b&activeNoteId=activeNote&fastSearch=true");

        await getNoteSuggestions("a", { fastSearch: false });
        expect(server.get).toHaveBeenLastCalledWith(expect.stringContaining("fastSearch=false"));
        // A limit is passed on for the server to stop at; left out, none is sent.
        await getNoteSuggestions("a", { limit: 10 });
        expect(server.get).toHaveBeenLastCalledWith("autocomplete?query=a&activeNoteId=activeNote&fastSearch=true&limit=10");
        expect(getInboxTarget).not.toHaveBeenCalled();
    });

    it("places both creation rows last, after the results", async () => {
        server.get = vi.fn(async () => [ { noteTitle: "Existing", notePath: "root/y" } ]) as typeof server.get;

        const rows = await getNoteSuggestions("New", { allowCreatingNotes: true });
        expect(rows.map((r) => r.action)).toEqual([ undefined, "create-note", "create-child-note" ]);
        expect(rows.map((r) => r.noteTitle)).toEqual([ "Existing", "New", "New" ]);
        // The inbox is resolved when the row is picked, so the row carries no parent.
        expect(rows[1].parentNoteId).toBeUndefined();
        expect(rows[2].parentNoteId).toBe("activeNote");
    });

    it("uses root as the child-note parent when there is no active note", async () => {
        getActiveContextNoteId.mockReturnValue(null);

        const rows = await getNoteSuggestions("New", { allowCreatingNotes: true });
        expect(rows.find((r) => r.action === "create-child-note")).toMatchObject({ parentNoteId: "root" });
    });

    it("adds no creation rows for a blank term", async () => {
        server.get = vi.fn(async () => [ { noteTitle: "Recent", notePath: "root/r" } ]) as typeof server.get;

        expect(await getNoteSuggestions("   ", { allowCreatingNotes: true })).toEqual([ { noteTitle: "Recent", notePath: "root/r" } ]);
        expect(getInboxTarget).not.toHaveBeenCalled();
    });

    it.each([
        { kind: "inbox", title: "Inbox" },
        { kind: "workspaceInbox", title: "Work" },
        { kind: "workspaceRoot", title: "Project" }
    ])("names the $kind destination in the create-note row", async ({ kind, title }) => {
        getInboxTarget.mockResolvedValueOnce({ kind, title });

        const rows = await getNoteSuggestions("New", { allowCreatingNotes: true });
        expect(rows[0].highlightedNotePathTitle).toBe("note_autocomplete.create-note-into");
        expect(translate).toHaveBeenCalledWith("note_autocomplete.create-note-into", { term: "New", parentTitle: title });
    });

    it.each([
        { kind: "root", key: "note_autocomplete.create-note-into-root" },
        { kind: "dayNote", key: "note_autocomplete.create-note-into-day-note" },
        { kind: "dailyInbox", key: "note_autocomplete.create-note-into-daily-inbox" }
    ])("labels the $kind destination without its title", async ({ kind, key }) => {
        getInboxTarget.mockResolvedValueOnce({ kind, noteId: "root", title: "root" });

        const rows = await getNoteSuggestions("New", { allowCreatingNotes: true });
        expect(rows[0].highlightedNotePathTitle).toBe(key);
        expect(translate).toHaveBeenCalledWith(key, { term: "New" });
    });

    it.each([
        { when: "the lookup fails", arrange: () => getInboxTarget.mockRejectedValueOnce(new Error("nope")) },
        { when: "the destination has no title", arrange: () => getInboxTarget.mockResolvedValueOnce({ kind: "inbox" }) }
    ])("falls back to an unqualified label when $when", async ({ arrange }) => {
        arrange();

        const rows = await getNoteSuggestions("New", { allowCreatingNotes: true });
        expect(rows[0]).toMatchObject({ action: "create-note", highlightedNotePathTitle: "note_autocomplete.create-note" });
    });

    it("reports a failed inbox lookup", async () => {
        getInboxTarget.mockRejectedValueOnce(new Error("nope"));

        await getNoteSuggestions("New", { allowCreatingNotes: true });
        expect(logError).toHaveBeenCalledWith(expect.stringContaining("nope"));
    });

    it("adds the external-link row first for a URL, and the search row after the notes for any term", async () => {
        server.get = vi.fn(async () => [ { noteTitle: "A", notePath: "root/a" } ]) as typeof server.get;
        const all = { allowCreatingNotes: true, allowJumpToSearchNotes: true, allowExternalLinks: true };

        const rows = await getNoteSuggestions("https://example.com/x", all);
        expect(rows.map((r) => r.action)).toEqual([ "external-link", undefined, "search-notes", "create-note", "create-child-note" ]);
        expect(rows[0]).toMatchObject({ externalLink: "https://example.com/x", highlightedNotePathTitle: "note_autocomplete.insert-external-link" });
        expect(rows[2]).toMatchObject({ noteTitle: "https://example.com/x", highlightedNotePathTitle: "note_autocomplete.show-in-full-search" });

        // Not a URL, and a blank term: neither row is offered.
        expect((await getNoteSuggestions("plain", all)).map((r) => r.action)).not.toContain("external-link");
        expect((await getNoteSuggestions("   ", all)).map((r) => r.action)).toEqual([ undefined ]);
        // And only when asked for.
        expect((await getNoteSuggestions("https://example.com/x")).map((r) => r.action)).toEqual([ undefined ]);
    });
});

describe("createSearchScheduler", () => {
    const WINDOW_MS = 50;

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    /** A search that records the term it ran for. */
    function searchFor(ran: string[], term: string, run: () => void | Promise<void> = () => {}) {
        return () => {
            ran.push(term);
            return run();
        };
    }

    it("runs the first search of a burst at once, and the last of the rest once typing stops", async () => {
        const schedule = createSearchScheduler();
        const ran: string[] = [];

        for (const term of [ "h", "he", "hel", "hell" ]) {
            schedule(searchFor(ran, term));
        }
        // No timer is advanced: an idle input queries on the keystroke itself.
        expect(ran).toEqual([ "h" ]);

        await vi.runAllTimersAsync();
        expect(ran).toEqual([ "h", "hell" ]);
    });

    it("holds the window open while typing continues instead of pacing searches", async () => {
        const schedule = createSearchScheduler();
        const ran: string[] = [];

        // Keystrokes arriving closer together than the window: the one that opens the burst
        // queries at once, and each one after it pushes the pending search back again.
        schedule(searchFor(ran, "h"));
        for (const term of [ "he", "hel", "hell" ]) {
            await vi.advanceTimersByTimeAsync(30);
            schedule(searchFor(ran, term));
        }
        expect(ran).toEqual([ "h" ]);

        await vi.runAllTimersAsync();
        expect(ran).toEqual([ "h", "hell" ]);
    });

    it("gives each input its own timer, so one cannot cancel another's pending search", async () => {
        const first = createSearchScheduler();
        const second = createSearchScheduler();
        const ran: string[] = [];

        // The leading-edge search of each burst, so both hold a debounced one afterwards.
        first(searchFor(ran, "a1"));
        second(searchFor(ran, "b1"));
        first(searchFor(ran, "a2"));
        second(searchFor(ran, "b2"));
        await vi.runAllTimersAsync();

        expect(ran).toEqual(expect.arrayContaining([ "a2", "b2" ]));
    });

    it("keeps one search in flight, so a slow one cannot make the rest queue behind it", async () => {
        const schedule = createSearchScheduler();
        const ran: string[] = [];
        let finishFirst = () => {};

        schedule(searchFor(ran, "h", () => new Promise<void>((resolve) => { finishFirst = resolve; })));
        // Each keystroke opens its own burst, so without single-flight every one of them would
        // start while the first search is still running.
        for (const term of [ "he", "hel", "hell", "hello" ]) {
            await vi.advanceTimersByTimeAsync(WINDOW_MS + 10);
            schedule(searchFor(ran, term));
        }
        expect(ran).toEqual([ "h" ]);

        finishFirst();
        await vi.runAllTimersAsync();
        // Only the newest term is searched for; the ones typed past are dropped, not queued.
        expect(ran).toEqual([ "h", "hello" ]);
    });

    it("reports a failed search and keeps accepting the next one", async () => {
        const schedule = createSearchScheduler();
        const ran: string[] = [];

        schedule(searchFor(ran, "h", async () => { throw new Error("boom"); }));
        await vi.runAllTimersAsync();
        // The scheduler awaits the search, so a rejection has to be reported here rather than
        // left to surface as an unhandled one.
        expect(logError).toHaveBeenCalledWith(expect.stringContaining("boom"));

        await vi.advanceTimersByTimeAsync(WINDOW_MS + 10);
        schedule(searchFor(ran, "hi"));
        // The failure released the slot, rather than wedging the input for good.
        expect(ran).toEqual([ "h", "hi" ]);
    });
});

describe("getCommandSuggestions", () => {
    const command: CommandDefinition = { id: "cmd1", name: "Cmd One", description: "desc", shortcut: "Ctrl+1", icon: "bx bx-cog" };

    it("lists every command for a bare marker, and searches what follows it", () => {
        getAllCommands.mockReturnValue([ command ]);
        expect(getCommandSuggestions(">")).toEqual([ {
            action: "command",
            commandId: "cmd1",
            noteTitle: "Cmd One",
            notePathTitle: ">Cmd One",
            highlightedNotePathTitle: "Cmd One",
            commandDescription: "desc",
            commandShortcut: "Ctrl+1",
            icon: "bx bx-cog"
        } ]);
        expect(searchCommands).not.toHaveBeenCalled();

        searchCommands.mockReturnValue([ { id: "c", name: "C" } ]);
        expect(getCommandSuggestions("> hello").map((row) => row.commandId)).toEqual([ "c" ]);
        expect(searchCommands).toHaveBeenCalledWith("hello");
    });
});

describe("createNoteFromSuggestion", () => {
    beforeEach(() => {
        chooseNoteType.mockResolvedValue({ success: true, noteType: "text", templateNoteId: undefined, notePath: undefined });
        createNote.mockResolvedValue({ note: { getBestNotePathString: (hoisted: string) => `root/${hoisted}/created` } });
    });

    it("creates the note in the inbox, or under the row's parent, and returns its path", async () => {
        expect(await createNoteFromSuggestion({ action: "create-note", noteTitle: "Created" })).toBe("root/hoisted/created");
        expect(createNote).toHaveBeenLastCalledWith("root/inbox", expect.objectContaining({ title: "Created", type: "text", activate: false }));

        await createNoteFromSuggestion({ action: "create-child-note", noteTitle: "Child", parentNoteId: "parent" });
        expect(createNote).toHaveBeenLastCalledWith("parent", expect.objectContaining({ title: "Child" }));
        expect(getInboxNotePath).toHaveBeenCalledTimes(1);
    });

    it("puts a child note under the parent the host gives, over the row's own", async () => {
        await createNoteFromSuggestion({ action: "create-child-note", noteTitle: "Child", parentNoteId: "active" }, "root/edited");
        expect(createNote).toHaveBeenLastCalledWith("root/edited", expect.objectContaining({ title: "Child" }));

        // The host's parent is for a child note only; the other row still goes to the inbox.
        await createNoteFromSuggestion({ action: "create-note", noteTitle: "Inboxed" }, "root/edited");
        expect(createNote).toHaveBeenLastCalledWith("root/inbox", expect.objectContaining({ title: "Inboxed" }));
    });

    it("puts the note where the type chooser says, over the row's own parent", async () => {
        chooseNoteType.mockResolvedValue({ success: true, noteType: "code", notePath: "chosen/path" });

        await createNoteFromSuggestion({ action: "create-child-note", noteTitle: "X", parentNoteId: "p" });
        expect(createNote).toHaveBeenCalledWith("chosen/path", expect.objectContaining({ type: "code" }));
    });

    it.each([
        { when: "the type chooser is canceled", arrange: () => chooseNoteType.mockResolvedValue({ success: false }) },
        { when: "there is no inbox", arrange: () => getInboxNotePath.mockResolvedValueOnce(undefined) }
    ])("creates nothing when $when", async ({ arrange }) => {
        arrange();

        expect(await createNoteFromSuggestion({ action: "create-note", noteTitle: "X" })).toBeUndefined();
        expect(createNote).not.toHaveBeenCalled();
    });

    it("returns nothing for a note that was not created", async () => {
        createNote.mockResolvedValue({ note: undefined });
        getActiveContext.mockReturnValue(undefined);

        expect(await createNoteFromSuggestion({ action: "create-note", noteTitle: "X" })).toBeUndefined();
    });
});

describe("recentNoteGroup", () => {
    // In the local time zone, as the groups are local days.
    const now = new Date(2026, 9, 15, 10, 30);
    const visited = (year: number, month: number, day: number, hours = 12) =>
        new Date(year, month, day, hours).toISOString().replace("T", " ");

    it("groups a visit by the local day it falls on, as far back as a month", () => {
        expect(recentNoteGroup(visited(2026, 9, 15, 0), now)).toBe("today");
        expect(recentNoteGroup(visited(2026, 9, 14, 23), now)).toBe("yesterday");
        expect(recentNoteGroup(visited(2026, 9, 14, 0), now)).toBe("yesterday");
        expect(recentNoteGroup(visited(2026, 9, 13), now)).toBe("past-week");
        expect(recentNoteGroup(visited(2026, 9, 9), now)).toBe("past-week");
        expect(recentNoteGroup(visited(2026, 9, 8), now)).toBe("past-month");
        expect(recentNoteGroup(visited(2026, 8, 16), now)).toBe("past-month");
        expect(recentNoteGroup(visited(2026, 8, 15), now)).toBe("older");
        expect(recentNoteGroup(visited(2025, 0, 1), now)).toBe("older");
    });
});
