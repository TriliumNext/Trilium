import type { SearchResultDetailsResponse } from "@triliumnext/commons";
import { beforeAll, describe, expect, it } from "vitest";

import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

let api: CoreApiTester;
const UNIQUE_TOKEN = "ZzUniqueSearchTokenQwerty";

async function createSearchNote(searchString: string): Promise<string> {
    const created = await api.post<{ noteId: string }>("/api/special-notes/search-note", {
        body: { searchString }
    });
    return created.body.noteId;
}

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

    describe("result-details endpoint", () => {
        it("returns snippet details in requested order with highlightedTokenInfos", async () => {
            const token = "ZzDetailsUniqueQwerty";
            const alpha = await createTextNote(api, {
                title: `${token} Alpha`,
                content: `<p>${token} shows up in the alpha body text</p>`
            });
            const beta = await createTextNote(api, {
                title: `${token} Beta`,
                content: `<p>${token} shows up in the beta body text</p>`
            });
            await api.post(`/api/notes/${alpha.noteId}/attributes`, {
                body: { type: "label", name: token, value: "" }
            });

            const searchNoteId = await createSearchNote(token);

            // Request in the reverse of natural order to prove requested-order preservation.
            const res = await api.post<SearchResultDetailsResponse>(
                `/api/search-note/${searchNoteId}/result-details`,
                { body: { noteIds: [beta.noteId, alpha.noteId] } }
            );

            expect(res.status).toBe(200);
            expect(res.body.results.map((r) => r.noteId)).toEqual([beta.noteId, alpha.noteId]);
            expect(res.body.error).toBeNull();

            const alphaDetail = res.body.results.find((r) => r.noteId === alpha.noteId);
            expect(alphaDetail?.noteTitle).toContain(token);
            expect(alphaDetail?.notePath).toContain(alpha.noteId);
            expect(alphaDetail?.icon).toBeTruthy();
            expect(alphaDetail?.contentSnippet).toContain(token);
            expect(alphaDetail?.highlightedContentSnippet).toContain(`<b>${token}</b>`);
            expect(alphaDetail?.attributeSnippet).toContain(token);

            expect(
                res.body.highlightedTokenInfos.some(
                    (t) => t.token.toLowerCase() === token.toLowerCase() && t.type === "plain"
                )
            ).toBe(true);
        });

        it("omits requested ids that are not in the result set", async () => {
            const token = "ZzOmitUniqueQwerty";
            const inScope = await createTextNote(api, { title: `${token} note`, content: `<p>${token}</p>` });
            const outOfScope = await createTextNote(api, { title: "Unrelated note", content: "<p>nothing here</p>" });

            const searchNoteId = await createSearchNote(token);

            const res = await api.post<SearchResultDetailsResponse>(
                `/api/search-note/${searchNoteId}/result-details`,
                { body: { noteIds: [inScope.noteId, outOfScope.noteId, "nonexistentNoteId"] } }
            );

            expect(res.status).toBe(200);
            expect(res.body.results.map((r) => r.noteId)).toEqual([inScope.noteId]);
        });

        it("400s on a note that is not a search note", async () => {
            const res = await api.post("/api/search-note/root/result-details", { body: { noteIds: [] } });
            expect(res.status).toBe(400);
        });

        it("400s when more than 100 noteIds are requested", async () => {
            const searchNoteId = await createSearchNote("anything");
            const noteIds = Array.from({ length: 101 }, (_, i) => `note${i}`);

            const res = await api.post(`/api/search-note/${searchNoteId}/result-details`, {
                body: { noteIds }
            });
            expect(res.status).toBe(400);
        });

        it("400s when noteIds is not a string array", async () => {
            const searchNoteId = await createSearchNote("anything");

            const res = await api.post(`/api/search-note/${searchNoteId}/result-details`, {
                body: { noteIds: "not-an-array" }
            });
            expect(res.status).toBe(400);
        });

        it("produces a regex token info and a match-centered snippet for a %= query", async () => {
            const marker = "ZzRegexHaystackQwerty";
            const target = await createTextNote(api, {
                title: "Regex target",
                content: `<p>${"padding words ".repeat(30)}${marker}${" trailing words".repeat(30)}</p>`
            });

            const searchNoteId = await createSearchNote(`note.content %= '${marker}'`);

            const res = await api.post<SearchResultDetailsResponse>(
                `/api/search-note/${searchNoteId}/result-details`,
                { body: { noteIds: [target.noteId] } }
            );

            expect(res.status).toBe(200);
            expect(res.body.highlightedTokenInfos.some((t) => t.type === "regex")).toBe(true);

            const detail = res.body.results.find((r) => r.noteId === target.noteId);
            expect(detail?.contentSnippet).toContain(marker);
            expect(detail?.highlightedContentSnippet).toContain(`<b>${marker}</b>`);
            // Match-centered: the padding-heavy head is trimmed to an ellipsis, not shown from index 0.
            expect(detail?.contentSnippet?.startsWith("padding words padding")).toBe(false);
        });
    });
});
