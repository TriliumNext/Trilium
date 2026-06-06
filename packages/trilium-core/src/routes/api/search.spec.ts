import { beforeAll, describe, expect, it } from "vitest";

import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

let api: CoreApiTester;
const UNIQUE_TOKEN = "ZzUniqueSearchTokenQwerty";

describe("Search API (core)", () => {
    let createdNoteId: string;

    beforeAll(async () => {
        api = CoreApiTester.build();
        ({ noteId: createdNoteId } = await createTextNote(api, { title: UNIQUE_TOKEN }));
    });

    it("returns matching note ids for a full search", async () => {
        const res = await api.get<string[]>(`/api/search/${UNIQUE_TOKEN}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body).toContain(createdNoteId);
    });

    it("returns structured quick-search results with snippets", async () => {
        const res = await api.get<{ searchResultNoteIds: string[]; searchResults: unknown[] }>(
            `/api/quick-search/${UNIQUE_TOKEN}`
        );
        expect(res.status).toBe(200);
        expect(res.body.searchResultNoteIds).toContain(createdNoteId);
        expect(Array.isArray(res.body.searchResults)).toBe(true);
    });

    it("lists template note ids including a freshly-labelled template", async () => {
        const { noteId } = await createTextNote(api, { title: "A template note" });
        await api.post(`/api/notes/${noteId}/attributes`, {
            body: { type: "label", name: "template", value: "" }
        });

        const res = await api.get<string[]>("/api/search-templates");
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body).toContain(noteId);
    });

    it("400s when searching from a note that is not a search note", async () => {
        const res = await api.get("/api/search-note/root");
        expect(res.status).toBe(400);
    });

    it("returns related notes for an attribute query", async () => {
        const res = await api.post<{ count: number; results: unknown[] }>("/api/search-related", {
            body: { type: "label", name: "docName", value: "hidden" }
        });
        expect(res.status).toBe(200);
        expect(typeof res.body.count).toBe("number");
        expect(Array.isArray(res.body.results)).toBe(true);
    });

    it("caps related-note results at 20 even with many matches", async () => {
        // Create more than 20 notes carrying the same label so the result loop
        // hits its >= 20 break.
        for (let i = 0; i < 22; i++) {
            const { noteId } = await createTextNote(api, { title: `Related ${i}` });
            await api.post(`/api/notes/${noteId}/attributes`, {
                body: { type: "label", name: "relTestLabel", value: "relTestValue" }
            });
        }

        const res = await api.post<{ count: number; results: unknown[] }>("/api/search-related", {
            body: { type: "label", name: "relTestLabel", value: "relTestValue" }
        });
        expect(res.status).toBe(200);
        expect(res.body.count).toBeGreaterThanOrEqual(22);
        expect(res.body.results).toHaveLength(20);
    });

    it("runs a saved search note and executes bulk actions over it", async () => {
        const created = await api.post<{ noteId: string; type: string }>(
            "/api/special-notes/search-note",
            { body: { searchString: UNIQUE_TOKEN } }
        );
        expect(created.body.type).toBe("search");
        const searchNoteId = created.body.noteId;

        const fromNote = await api.get<{ searchResultNoteIds: string[] }>(
            `/api/search-note/${searchNoteId}`
        );
        expect(fromNote.status).toBe(200);
        expect(fromNote.body.searchResultNoteIds).toContain(createdNoteId);

        // searchAndExecute returns no body (204) — the note has no action labels,
        // so executing over the results is a safe no-op.
        const exec = await api.post(`/api/search-and-execute-note/${searchNoteId}`);
        expect(exec.status).toBe(204);
    });

    it("400s when executing a note that is not a search note", async () => {
        const res = await api.post("/api/search-and-execute-note/root");
        expect(res.status).toBe(400);
    });
});
