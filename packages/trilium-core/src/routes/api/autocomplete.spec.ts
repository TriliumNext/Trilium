import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ValidationError } from "../../errors";
import * as cls from "../../services/context";
import searchService from "../../services/search/services/search";
import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";
import autocompleteApi from "./autocomplete";

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
    noteType?: string;
    workspace?: true;
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

        it("searches inside a named note, and through the whole tree when that note is root, whatever the real hoist", async () => {
            const stamp = `focus${Date.now()}`;
            const { noteId: shelfId } = await createTextNote(api, { title: `Shelf ${stamp}` });
            const { noteId: insideId } = await createTextNote(api, {
                parentNoteId: shelfId, title: `Inside ${stamp}`
            });
            const { noteId: outsideId } = await createTextNote(api, { title: `Outside ${stamp}` });
            await api.put(`/api/notes/${insideId}/set-attribute`, {
                body: { type: "label", name: "workspace", value: "" }
            });
            vi.spyOn(cls, "getHoistedNoteId").mockReturnValue(shelfId);
            const noteIdOf = (result: AutocompleteResult) => result.notePath.split("/").at(-1);

            // The real hoist leaves a match outside it out.
            const scoped = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: `Outside ${stamp}` }
            });
            expect(scoped.body.map(noteIdOf)).not.toContain(outsideId);

            const inside = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: `Inside ${stamp}`, ancestorNoteId: shelfId }
            });
            expect(inside.body.map(noteIdOf)).toEqual([ insideId ]);
            expect(inside.body[0].workspace).toBe(true);
            expect(inside.body[0].noteType).toBe("text");
            // A note under the hoist leads with its own title. The hoist's title is not a prefix.
            expect(inside.body[0].highlightedNoteTitle).toContain("Inside");
            expect(inside.body[0].highlightedParentPathTitle ?? "").not.toContain("Shelf");

            // The hoisted note itself still has a title. The path stops at it, so nothing follows.
            const shelf = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: `Shelf ${stamp}` }
            });
            const shelfRow = shelf.body.find((result) => noteIdOf(result) === shelfId);
            expect(shelfRow?.highlightedNoteTitle).toContain(`Shelf`);
            expect(shelfRow?.highlightedNoteTitle).toContain(stamp);

            // Naming the root searches the whole tree while the real hoist stays on the shelf.
            const everywhere = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: `Outside ${stamp}`, ancestorNoteId: "root" }
            });
            expect(everywhere.body.map(noteIdOf)).toContain(outsideId);

            const stillInside = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: `Outside ${stamp}`, ancestorNoteId: shelfId }
            });
            expect(stillInside.body.map(noteIdOf)).not.toContain(outsideId);

            await api.post("/api/recent-notes", { body: { noteId: outsideId, notePath: `root/${outsideId}` } });
            await api.post("/api/recent-notes", {
                body: { noteId: insideId, notePath: `root/${shelfId}/${insideId}` }
            });
            const scopedRecents = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: "", ancestorNoteId: shelfId }
            });
            const scopedRecentIds = scopedRecents.body.map(noteIdOf);
            expect(scopedRecentIds).toContain(insideId);
            expect(scopedRecentIds).not.toContain(outsideId);

            const wideRecents = await api.get<AutocompleteResult[]>("/api/autocomplete", {
                query: { query: "", ancestorNoteId: "root" }
            });
            expect(wideRecents.body.map(noteIdOf)).toContain(outsideId);
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

        it("rejects an ancestor that is not one note id", () => {
            expect(() => autocompleteApi.getAutocomplete({
                query: { query: "root", ancestorNoteId: [ "root", "other" ] }
            } as never)).toThrow(ValidationError);
        });

        it("searches the whole tree from a hidden hoist, and treats a blank ancestor as omitted", async () => {
            const stamp = `hiddenfocus${Date.now()}`;
            const { noteId: visibleId } = await createTextNote(api, { title: `Visible ${stamp}` });
            const { noteId: shelfId } = await createTextNote(api, { title: `Shelf ${stamp}` });
            vi.spyOn(cls, "getHoistedNoteId").mockReturnValue("_lbBookmarks");
            const noteIdOf = (result: AutocompleteResult) => result.notePath.split("/").at(-1);
            const idsFor = async (query: Record<string, string>) => {
                const res = await api.get<AutocompleteResult[]>("/api/autocomplete", { query });
                expect(res.status).toBe(200);
                return res.body.map(noteIdOf);
            };

            expect(await idsFor({ query: `Visible ${stamp}` })).toContain(visibleId);
            expect(await idsFor({ query: `Visible ${stamp}`, ancestorNoteId: "_lbBookmarks" })).toContain(visibleId);
            expect(await idsFor({ query: `Visible ${stamp}`, ancestorNoteId: shelfId })).not.toContain(visibleId);
            expect(await idsFor({ query: `Visible ${stamp}`, ancestorNoteId: "" })).toContain(visibleId);
            expect(await idsFor({ query: `Visible ${stamp}`, ancestorNoteId: "   " })).toContain(visibleId);

            await api.post("/api/recent-notes", { body: { noteId: visibleId, notePath: `root/${visibleId}` } });
            expect(await idsFor({ query: "" })).toContain(visibleId);
            expect(await idsFor({ query: "", ancestorNoteId: shelfId })).not.toContain(visibleId);
        });

        it("leaves a result whose note is gone as the search returned it", async () => {
            vi.spyOn(searchService, "searchNotesForAutocomplete").mockReturnValue([
                {
                    noteId: "blank", notePath: "", noteTitle: "Blank", notePathTitle: "",
                    highlightedNotePathTitle: "", icon: "bx bx-note"
                },
                {
                    noteId: "gone", notePath: "root/gone", noteTitle: "Gone", notePathTitle: "Gone",
                    highlightedNotePathTitle: "Gone", icon: "bx bx-note"
                }
            ] as never);

            const res = await api.get<AutocompleteResult[]>("/api/autocomplete", { query: { query: "gone" } });
            expect(res.status).toBe(200);
            expect(res.body.map((result) => result.noteType)).toEqual([ undefined, undefined ]);
            expect(res.body[1].noteTitle).toBe("Gone");
        });
    });
});
