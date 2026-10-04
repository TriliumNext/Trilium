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
    utcDateVisited?: string;
    highlightedNoteTitle?: string;
    highlightedParentPathTitle?: string;
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

        it("splits a result's path into the note's title and the path to it, both highlighted", async () => {
            const stamp = Date.now();
            const { noteId: shelfId } = await createTextNote(api, { title: `Shelf ${stamp}` });
            const { noteId } = await createTextNote(api, { parentNoteId: shelfId, title: `Ledger <${stamp}>` });

            const found = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: `ledger ${stamp}` }
            });
            const match = found.body.find((r) => r.notePath.endsWith(noteId));
            expect(match?.highlightedNoteTitle).toBe(`<b>Ledger</b> &lt;<b>${stamp}</b>&gt;`);
            expect(match?.highlightedParentPathTitle).toBe(`Shelf <b>${stamp}</b>`);
            // A note at the top level has no path to it.
            const shelf = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: `shelf ${stamp}` }
            });
            expect(shelf.body.find((r) => r.notePath.endsWith(shelfId))?.highlightedParentPathTitle).toBe("");

            // The recent notes come split too, escaped as there is nothing to highlight.
            await api.post("/api/recent-notes", { body: { noteId, notePath: `root/${shelfId}/${noteId}` } });
            const recent = await api.get<AutocompleteResult[]>("/api/autocomplete", { query: { query: "" } });
            const visited = recent.body.find((r) => r.notePath.endsWith(noteId));
            expect(visited?.highlightedNoteTitle).toBe(`Ledger &lt;${stamp}&gt;`);
            expect(visited?.highlightedParentPathTitle).toBe(`Shelf ${stamp}`);
        });

        it("returns recent notes for an empty query, with when each was visited", async () => {
            const { noteId } = await createTextNote(api, { title: "Recently visited" });
            await api.post("/api/recent-notes", { body: { noteId, notePath: `root/${noteId}` } });

            const res = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: "" }
            });
            expect(res.status).toBe(200);
            const visited = res.body.find((r) => r.notePath === `root/${noteId}`);
            expect(visited?.utcDateVisited).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);

            // A search answers with no visit times.
            const searched = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: "Recently visited" }
            });
            expect(searched.body.find((r) => r.notePath.endsWith(noteId))?.utcDateVisited).toBeUndefined();
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

        it("returns at most one dropdown's worth of results", async () => {
            const marker = `capmarker${Date.now()}`;
            for (let i = 0; i < 30; i++) {
                await createTextNote(api, { title: `${marker} note ${i}` });
            }

            const res = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: marker }
            });
            expect(res.status).toBe(200);
            expect(res.body.length).toBe(25);
        });

        it("stops at the limit a caller gives, which lowers the caps and never raises them", async () => {
            const marker = `limitmarker${Date.now()}`;
            for (let i = 0; i < 30; i++) {
                const { noteId } = await createTextNote(api, { title: `${marker} note ${i}` });
                await api.post("/api/recent-notes", { body: { noteId, notePath: `root/${noteId}` } });
            }
            const count = async (query: string, limit: string) =>
                (await api.get<AutocompleteResult[]>("/api/autocomplete", { query: { query, limit } })).body.length;

            expect(await count(marker, "10")).toBe(10);
            expect(await count(marker, "100")).toBe(25);
            // The recent notes, for an empty query.
            expect(await count("", "10")).toBe(10);
        });

        it.each([ "0", "-1", "2.5", "ten" ])("400s for a limit of %s", async (limit) => {
            const res = await api.get("/api/autocomplete", { query: { query: "root", limit } });
            expect(res.status).toBe(400);
        });

        it("400s when the query param is missing", async () => {
            const res = await api.get("/api/autocomplete");
            expect(res.status).toBe(400);
        });
    });
});
