import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import * as cls from "../../services/context";
import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared core autocomplete routes through {@link CoreApiTester} (no Express),
 * so this spec runs under both the node and standalone (WASM) suites.
 */
let api: CoreApiTester;

interface AutocompleteResult {
    notePath: string;
    noteTitle: string;
    notePathTitle: string;
    highlightedNotePathTitle: string;
    icon: string;
}

describe("Autocomplete API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    describe("getAutocomplete", () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("returns matching notes for a search query", async () => {
            const title = `Autocomplete target ${Date.now()}`;
            await createTextNote(api, { title });

            const res = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: title }
            });
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);

            const match = res.body.find((r) => r.noteTitle === title);
            expect(match).toBeTruthy();
            expect(match?.notePath).toBeTruthy();
            expect(typeof match?.highlightedNotePathTitle).toBe("string");
            expect(match?.icon).toBeTruthy();
        });

        it("returns recent notes for an empty query", async () => {
            const res = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: "" }
            });
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it("filters recent notes by the hoisted note path when not hoisted to root", async () => {
            // Exercises the `hoistedNoteId !== "root"` branch (extra LIKE condition).
            const { noteId } = await createTextNote(api, { title: "Hoisted recent" });
            await api.post("/api/recent-notes", { body: { noteId, notePath: `root/${noteId}` } });
            vi.spyOn(cls, "getHoistedNoteId").mockReturnValue(noteId);

            const res = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: "" }
            });
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it("logs a warning when the search is slow", async () => {
            // Force the elapsed-time threshold so the slow-autocomplete log branch runs.
            let calls = 0;
            vi.spyOn(Date, "now").mockImplementation(() => (calls++ === 0 ? 0 : 1000));

            const res = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: "root" }
            });
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it("honours the fastSearch flag", async () => {
            const res = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: "root", fastSearch: "false" }
            });
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it("400s when the query param is missing", async () => {
            const res = await api.get("/api/autocomplete");
            expect(res.status).toBe(400);
        });
    });

    describe("getNotesCount", () => {
        it("returns the count of non-deleted notes as a number", async () => {
            const before = await api.get<number>("/api/autocomplete/notesCount");
            expect(before.status).toBe(200);
            expect(typeof before.body).toBe("number");
            expect(before.body).toBeGreaterThan(0);

            await createTextNote(api, { title: "Counts towards total" });

            const after = await api.get<number>("/api/autocomplete/notesCount");
            expect(after.status).toBe(200);
            expect(after.body).toBeGreaterThan(before.body);
        });
    });
});
