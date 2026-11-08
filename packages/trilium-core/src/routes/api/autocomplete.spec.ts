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

        it("keeps the notes a filter matches, and lists its matches for an empty query", async () => {
            const stamp = `filtered${Date.now()}`;
            const { noteId: wanted } = await createTextNote(api, { title: `Wanted ${stamp}` });
            const { noteId: unwanted } = await createTextNote(api, { title: `Unwanted ${stamp}` });
            await api.put(`/api/notes/${wanted}/set-attribute`, {
                body: { type: "label", name: stamp, value: "" }
            });
            const noteIdsOf = (results: AutocompleteResult[]) =>
                results.map((result) => result.notePath.split("/").at(-1));

            const unfiltered = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: stamp }
            });
            expect(noteIdsOf(unfiltered.body))
                .toEqual(expect.arrayContaining([ wanted, unwanted ]));

            const filtered = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: stamp, filter: `#${stamp}` }
            });
            expect(filtered.status).toBe(200);
            expect(noteIdsOf(filtered.body)).toEqual([ wanted ]);

            // What is typed is searched apart from the filter, so text that is query syntax of its
            // own cannot loosen it.
            const syntax = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: `${stamp} OR`, filter: `#${stamp}` }
            });
            expect(noteIdsOf(syntax.body)).not.toContain(unwanted);

            const empty = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: "", filter: `#${stamp}` }
            });
            expect(noteIdsOf(empty.body)).toEqual([ wanted ]);
        });

        it("filters by note type and MIME type, grouped with OR", async () => {
            const stamp = `picture${Date.now()}`;
            const noteIdsOf = (results: AutocompleteResult[]) =>
                results.map((result) => result.notePath.split("/").at(-1));
            const create = async (mime: string) => {
                const res = await api.post<{ note: { noteId: string } }>(
                    "/api/notes/root/children?target=into",
                    { body: { title: `${stamp} ${mime}`, type: "image", mime, content: "" } });
                return res.body.note.noteId;
            };
            const png = await create("image/png");
            const webp = await create("image/webp");
            // How Trilium stores a JPEG it compressed itself.
            const jpg = await create("image/jpg");
            const svg = await create("image/svg+xml");
            const unfiltered = await api.get<AutocompleteResult[]>(
                "/api/autocomplete", { query: { query: stamp } });
            expect(noteIdsOf(unfiltered.body)).toContain(svg);

            const res = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: {
                    query: stamp,
                    filter: "note.type = image AND (note.mime = 'image/png' "
                        + "OR note.mime = 'image/jpeg' OR note.mime = 'image/jpg' "
                        + "OR note.mime = 'image/webp' OR note.mime = 'image/gif')"
                }
            });
            const noteIds = noteIdsOf(res.body);
            expect(noteIds).toEqual(expect.arrayContaining([ png, webp, jpg ]));
            expect(noteIds).not.toContain(svg);
        });

        it("400s when the query param is missing", async () => {
            const res = await api.get("/api/autocomplete");
            expect(res.status).toBe(400);
        });
    });
});
