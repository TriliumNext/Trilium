import { beforeAll, describe, expect, it } from "vitest";

import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared core special-notes routes through {@link CoreApiTester}
 * (no Express), so this spec runs under both the node and standalone (WASM)
 * suites. Date-note GETs lazily create the calendar hierarchy, and the SQL
 * console / search-note POSTs create disposable notes — all safe operations.
 */
let api: CoreApiTester;

interface NotePojo {
    noteId: string;
    type: string;
    title: string;
}

interface CloneResponse {
    success: boolean;
    branchId?: string;
}

describe("Special notes API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    describe("date notes", () => {
        it("returns the inbox note for a date", async () => {
            const res = await api.get<NotePojo>("/api/special-notes/inbox/2025-01-01");
            expect(res.status).toBe(200);
            expect(res.body.noteId).toBeTruthy();
            expect(res.body.type).toBeTruthy();
        });

        it("returns (and lazily creates) the day note", async () => {
            const res = await api.get<NotePojo>("/api/special-notes/days/2025-01-01");
            expect(res.status).toBe(200);
            expect(res.body.noteId).toBeTruthy();
            expect(res.body.type).toBeTruthy();
        });

        it("returns the first day of the week for a date", async () => {
            const res = await api.get<NotePojo>("/api/special-notes/week-first-day/2025-01-01");
            expect(res.status).toBe(200);
            expect(res.body.noteId).toBeTruthy();
        });

        it("returns the week note (null unless week notes are enabled)", async () => {
            const res = await api.get<NotePojo | null>("/api/special-notes/weeks/2025-W03");
            expect(res.status).toBe(200);
            // Week notes require `enableWeekNote` on the calendar root, which the
            // demo fixture does not set, so the handler returns null here.
            expect(res.body === null || typeof res.body.noteId === "string").toBe(true);
        });

        it("returns the day note scoped to an explicit calendar root", async () => {
            const res = await api.get<NotePojo>("/api/special-notes/days/2025-02-10", {
                query: { calendarRootId: "root" }
            });
            expect(res.status).toBe(200);
            expect(res.body.noteId).toBeTruthy();
        });

        it("returns a filtered map of day notes for a month with a calendar root", async () => {
            const created = await api.get<NotePojo>("/api/special-notes/days/2025-03-05");

            const res = await api.get<Record<string, string>>(
                "/api/special-notes/notes-for-month/2025-03",
                { query: { calendarRoot: "root" } }
            );
            expect(res.status).toBe(200);
            expect(res.body["2025-03-05"]).toBe(created.body.noteId);

            // A calendar root that is not an ancestor filters everything out.
            const none = await api.get<Record<string, string>>(
                "/api/special-notes/notes-for-month/2025-03",
                { query: { calendarRoot: "_hidden" } }
            );
            expect(none.status).toBe(200);
            expect(none.body["2025-03-05"]).toBeUndefined();
        });

        it("returns the month note", async () => {
            const res = await api.get<NotePojo>("/api/special-notes/months/2025-01");
            expect(res.status).toBe(200);
            expect(res.body.noteId).toBeTruthy();
        });

        it("returns the quarter note", async () => {
            const res = await api.get<NotePojo>("/api/special-notes/quarters/2025-Q1");
            expect(res.status).toBe(200);
            expect(res.body.noteId).toBeTruthy();
        });

        it("returns the year note", async () => {
            const res = await api.get<NotePojo>("/api/special-notes/years/2025");
            expect(res.status).toBe(200);
            expect(res.body.noteId).toBeTruthy();
        });

        it("returns a map of day notes for a month", async () => {
            await api.get("/api/special-notes/days/2025-01-01");

            const res = await api.get<Record<string, string>>(
                "/api/special-notes/notes-for-month/2025-01"
            );
            expect(res.status).toBe(200);
            expect(typeof res.body).toBe("object");
            expect(res.body["2025-01-01"]).toBeTruthy();
        });

        it("404s for the day note when the calendar root does not exist", async () => {
            const res = await api.get("/api/special-notes/days/2025-01-01", {
                query: { calendarRootId: "missingCalendarRoot123" }
            });
            expect(res.status).toBe(404);
        });
    });

    describe("SQL console", () => {
        it("creates a SQL console note and saves it (round-trip)", async () => {
            const created = await api.post<NotePojo>("/api/special-notes/sql-console");
            expect(created.status).toBe(200);
            expect(created.body.noteId).toBeTruthy();
            expect(created.body.type).toBe("code");

            const saved = await api.post<CloneResponse>("/api/special-notes/save-sql-console", {
                body: { sqlConsoleNoteId: created.body.noteId }
            });
            expect(saved.status).toBe(200);
            expect(saved.body.success).toBe(true);
            expect(saved.body.branchId).toBeTruthy();
        });

        it("500s when saving a non-existent SQL console note", async () => {
            const res = await api.post("/api/special-notes/save-sql-console", {
                body: { sqlConsoleNoteId: "missingSqlConsole123" }
            });
            expect(res.status).toBe(500);
        });
    });

    describe("search notes", () => {
        it("creates a search note and saves it (round-trip)", async () => {
            const created = await api.post<NotePojo>("/api/special-notes/search-note", {
                body: { searchString: "#someLabel" }
            });
            expect(created.status).toBe(200);
            expect(created.body.noteId).toBeTruthy();
            expect(created.body.type).toBe("search");

            const saved = await api.post<CloneResponse>("/api/special-notes/save-search-note", {
                body: { searchNoteId: created.body.noteId }
            });
            expect(saved.status).toBe(200);
            expect(saved.body.success).toBe(true);
            expect(saved.body.branchId).toBeTruthy();
        });

        it("500s when saving a non-existent search note", async () => {
            const res = await api.post("/api/special-notes/save-search-note", {
                body: { searchNoteId: "missingSearchNote123" }
            });
            expect(res.status).toBe(500);
        });

        it("creates a search note defaulting the ancestor to the hoisted note", async () => {
            const res = await api.post<NotePojo>("/api/special-notes/search-note", {
                body: {}
            });
            expect(res.status).toBe(200);
            expect(res.body.type).toBe("search");
        });
    });

    describe("launchers", () => {
        it("creates a launcher under a parent and resets it", async () => {
            const created = await api.post<{ success: boolean; note: NotePojo }>(
                "/api/special-notes/launchers/_lbVisibleLaunchers/note"
            );
            expect(created.status).toBe(200);
            expect(created.body.success).toBe(true);
            expect(created.body.note.noteId).toBeTruthy();

            const reset = await api.post(
                `/api/special-notes/launchers/${created.body.note.noteId}/reset`
            );
            // resetLauncher returns nothing, so the result handler maps it to 204.
            expect(reset.status).toBe(204);
        });

        it("creates or updates a script launcher from the API", async () => {
            const res = await api.put<NotePojo>("/api/special-notes/api-script-launcher", {
                body: {
                    id: "specLauncher1",
                    title: "Spec launcher",
                    action: "() => console.log('hi')",
                    icon: "bx-home",
                    shortcut: "ctrl+alt+s"
                }
            });
            expect(res.status).toBe(200);
            expect(res.body.title).toBe("Spec launcher");

            // Update path: same id, now without icon/shortcut (exercises the remove branches).
            const update = await api.put<NotePojo>("/api/special-notes/api-script-launcher", {
                body: {
                    id: "specLauncher1",
                    title: "Spec launcher renamed",
                    action: "() => 1"
                }
            });
            expect(update.status).toBe(200);
            expect(update.body.title).toBe("Spec launcher renamed");
        });

        // Destructive: deletes _lbRoot's children, so keep this last in the file.
        it("resets a launchbar root by clearing its children, and ignores non-launchers", async () => {
            // _lbRoot is a protected launchbar config root → children are reset.
            const rootReset = await api.post("/api/special-notes/launchers/_lbRoot/reset");
            expect(rootReset.status).toBe(204);

            // root is not a launcher → the no-op branch.
            const nonLauncher = await api.post("/api/special-notes/launchers/root/reset");
            expect(nonLauncher.status).toBe(204);
        });
    });
});
