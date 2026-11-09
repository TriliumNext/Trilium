import { beforeAll, describe, expect, it } from "vitest";

import { ConflictError, HttpError, NotFoundError, ValidationError } from "../../errors.js";
import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";
import { getContext } from "../context.js";
import noteService from "../notes.js";
import { deserializeSearchQueryError, runSearchQuery, type SearchQueryArgs, type SearchQueryKind, serializeSearchQueryError } from "./search_queries.js";

let api: CoreApiTester;
const TOKEN = "ZzSearchQueriesTokenQwerty";

interface Case<K extends SearchQueryKind> {
    name: string;
    kind: K;
    args: SearchQueryArgs[K];
    request: () => Promise<{ status: number; body: unknown }>;
}

describe("search queries", () => {
    let hoistNoteId: string;
    let hoistedChildId: string;
    let searchNoteId: string;
    let scriptedSearchNoteId: string;
    let orderedSearchNoteId: string;
    const cases: Case<SearchQueryKind>[] = [];

    function addCase<K extends SearchQueryKind>(testCase: Case<K>) {
        cases.push(testCase as unknown as Case<SearchQueryKind>);
    }

    beforeAll(async () => {
        api = CoreApiTester.build();

        const hoist = await createTextNote(api, { title: `${TOKEN} workspace` });
        hoistNoteId = hoist.noteId;
        const child = await createTextNote(api, {
            parentNoteId: hoistNoteId,
            title: `${TOKEN} child`,
            content: `<p>The body mentions ${TOKEN} and a fuzzy wrd.</p>`
        });
        hoistedChildId = child.noteId;
        await createTextNote(api, { title: `${TOKEN} outside`, content: "<p>word</p>" });
        await api.post(`/api/notes/${hoistedChildId}/attributes`, {
            body: { type: "label", name: "queriesLabel", value: "alpha", isInheritable: true }
        });
        await api.post(`/api/notes/${hoistNoteId}/attributes`, {
            body: { type: "label", name: "queriesLabel", value: "beta" }
        });
        await api.post("/api/recent-notes", { body: { noteId: hoistedChildId, notePath: `root/${hoistNoteId}/${hoistedChildId}` } });

        searchNoteId = await createSearchNote(TOKEN);
        orderedSearchNoteId = await createSearchNote(`${TOKEN} orderBy:note.title desc limit 2`);

        const scriptNote = getContext().init(() => noteService.createNewNote({
            parentNoteId: "root",
            title: "Search script",
            type: "code",
            mime: "application/javascript;env=backend",
            content: "return [];"
        }).note);
        scriptedSearchNoteId = await createSearchNote(TOKEN);
        await api.post(`/api/notes/${scriptedSearchNoteId}/attributes`, {
            body: { type: "relation", name: "searchScript", value: scriptNote.noteId }
        });

        const hoisted = { "trilium-hoisted-note-id": hoistNoteId };

        addCase({
            name: "quick search, unhoisted",
            kind: "quickSearch",
            args: { hoistedNoteId: "root", searchString: TOKEN },
            request: () => api.get("/api/quick-search", { query: { searchString: TOKEN } })
        });
        addCase({
            name: "quick search, hoisted",
            kind: "quickSearch",
            args: { hoistedNoteId: hoistNoteId, searchString: TOKEN },
            request: () => api.get("/api/quick-search", { query: { searchString: TOKEN }, headers: hoisted })
        });
        addCase({
            name: "quick search with an attribute filter",
            kind: "quickSearch",
            args: { hoistedNoteId: "root", searchString: "#queriesLabel=alpha" },
            request: () => api.get("/api/quick-search", { query: { searchString: "#queriesLabel=alpha" } })
        });
        addCase({
            name: "full search",
            kind: "search",
            args: { hoistedNoteId: "root", searchString: TOKEN },
            request: () => api.get("/api/search", { query: { searchString: TOKEN } })
        });
        addCase({
            name: "full search with tokens, ancestor and archived notes left out",
            kind: "search",
            args: {
                hoistedNoteId: "root", searchString: `${TOKEN} #queriesLabel`, ancestorNoteId: hoistNoteId,
                includeTokens: "true", includeArchivedNotes: "false"
            },
            request: () => api.get("/api/search", {
                query: {
                    searchString: `${TOKEN} #queriesLabel`, ancestorNoteId: hoistNoteId,
                    includeTokens: "true", includeArchivedNotes: "false"
                }
            })
        });
        addCase({
            name: "full search with orderBy and limit",
            kind: "search",
            args: { hoistedNoteId: "root", searchString: `${TOKEN} orderBy note.title limit 2`, includeTokens: "true" },
            request: () => api.get("/api/search", {
                query: { searchString: `${TOKEN} orderBy note.title limit 2`, includeTokens: "true" }
            })
        });
        addCase({
            name: "full search with an ancestor query",
            kind: "search",
            args: { hoistedNoteId: "root", searchString: `note.ancestors.noteId = ${hoistNoteId}` },
            request: () => api.get("/api/search", { query: { searchString: `note.ancestors.noteId = ${hoistNoteId}` } })
        });
        addCase({
            name: "related notes",
            kind: "relatedNotes",
            args: { hoistedNoteId: "root", attribute: { type: "label", name: "queriesLabel", value: "alpha" } },
            request: () => api.post("/api/search-related", { body: { type: "label", name: "queriesLabel", value: "alpha" } })
        });
        addCase({
            name: "saved search note",
            kind: "searchFromNote",
            args: { hoistedNoteId: "root", noteId: searchNoteId },
            request: () => api.get(`/api/search-note/${searchNoteId}`)
        });
        addCase({
            name: "saved search note with orderBy and limit",
            kind: "searchFromNote",
            args: { hoistedNoteId: "root", noteId: orderedSearchNoteId },
            request: () => api.get(`/api/search-note/${orderedSearchNoteId}`)
        });
        addCase({
            name: "saved search result details",
            kind: "searchResultDetails",
            args: { hoistedNoteId: "root", noteId: searchNoteId, body: { noteIds: [ hoistedChildId, hoistNoteId ] } },
            request: () => api.post(`/api/search-note/${searchNoteId}/result-details`, {
                body: { noteIds: [ hoistedChildId, hoistNoteId ] }
            })
        });
        addCase({
            name: "autocomplete",
            kind: "autocomplete",
            args: { hoistedNoteId: "root", query: TOKEN },
            request: () => api.get("/api/autocomplete", { query: { query: TOKEN } })
        });
        addCase({
            name: "autocomplete, hoisted, slow search, limited",
            kind: "autocomplete",
            args: { hoistedNoteId: hoistNoteId, query: TOKEN, fastSearch: "false", limit: "1" },
            request: () => api.get("/api/autocomplete", {
                query: { query: TOKEN, fastSearch: "false", limit: "1" }, headers: hoisted
            })
        });
        addCase({
            name: "autocomplete with a filter",
            kind: "autocomplete",
            args: { hoistedNoteId: "root", query: TOKEN, filter: "note.type = text" },
            request: () => api.get("/api/autocomplete", { query: { query: TOKEN, filter: "note.type = text" } })
        });
        addCase({
            name: "autocomplete, empty query with a filter",
            kind: "autocomplete",
            args: { hoistedNoteId: "root", query: "", filter: "#queriesLabel" },
            request: () => api.get("/api/autocomplete", { query: { query: "", filter: "#queriesLabel" } })
        });
        addCase({
            name: "autocomplete, empty query lists recent notes",
            kind: "autocomplete",
            args: { hoistedNoteId: "root", query: "", activeNoteId: hoistNoteId },
            request: () => api.get("/api/autocomplete", { query: { query: "", activeNoteId: hoistNoteId } })
        });
    });

    it("returns what the routes return, and survives a structured clone", async () => {
        for (const fuzzy of [ "true", "false" ]) {
            await api.put(`/api/options/searchAutocompleteFuzzy/${fuzzy}`);
            await api.put(`/api/options/searchEnableFuzzyMatching/${fuzzy}`);

            for (const testCase of cases) {
                const response = await testCase.request();
                expect(response.status, testCase.name).toBe(200);

                const result = runSearchQuery(testCase.kind, testCase.args);
                expect(JSON.parse(JSON.stringify(result)), `${testCase.name}, fuzzy ${fuzzy}`).toEqual(response.body);
                expect(structuredClone(result), testCase.name).toEqual(result);
            }
        }
    });

    it("finds the hoisted note only inside the hoisted subtree", () => {
        const hoisted = runSearchQuery("quickSearch", { hoistedNoteId: hoistNoteId, searchString: TOKEN });
        const unhoisted = runSearchQuery("quickSearch", { hoistedNoteId: "root", searchString: TOKEN });
        expect(hoisted.searchResultNoteIds).toContain(hoistedChildId);
        expect(unhoisted.searchResultNoteIds.length).toBeGreaterThan(hoisted.searchResultNoteIds.length);
    });

    it("returns plain related-note records carrying the note path", () => {
        const related = runSearchQuery("relatedNotes", {
            hoistedNoteId: "root", attribute: { type: "label", name: "queriesLabel", value: "alpha" }
        });
        expect(related.count).toBe(2);
        expect(related.results[0].notePathArray.at(-1)).toBe(hoistedChildId);
        expect(Object.getPrototypeOf(related.results[0])).toBe(Object.prototype);
    });

    it("hands a script-based saved search back to the main process", async () => {
        const deferred = { deferScripts: true };
        expect(runSearchQuery("searchFromNote", { hoistedNoteId: "root", noteId: scriptedSearchNoteId }, deferred))
            .toEqual({ needsMain: true });
        expect(runSearchQuery("searchResultDetails", {
            hoistedNoteId: "root", noteId: scriptedSearchNoteId, body: { noteIds: [] }
        }, deferred)).toEqual({ needsMain: true });
        expect(runSearchQuery("searchFromNote", { hoistedNoteId: "root", noteId: searchNoteId }, deferred))
            .not.toHaveProperty("needsMain");

        const response = await api.get(`/api/search-note/${scriptedSearchNoteId}`);
        expect(response.status).toBe(200);
        expect(runSearchQuery("searchFromNote", { hoistedNoteId: "root", noteId: scriptedSearchNoteId }))
            .toEqual(response.body);
    });

    it("throws the errors the routes map to status codes, and rebuilds them from the wire", () => {
        const cases: [ () => unknown, typeof HttpError, number ][] = [
            [ () => runSearchQuery("quickSearch", { hoistedNoteId: "root", searchString: "" }), ValidationError, 400 ],
            [ () => runSearchQuery("search", { hoistedNoteId: "root" }), ValidationError, 400 ],
            [ () => runSearchQuery("autocomplete", { hoistedNoteId: "root", query: 1 }), ValidationError, 400 ],
            [ () => runSearchQuery("autocomplete", { hoistedNoteId: "root", query: "x", limit: "0" }), ValidationError, 400 ],
            [ () => runSearchQuery("searchFromNote", { hoistedNoteId: "root", noteId: "root" }), ValidationError, 400 ],
            [ () => runSearchQuery("searchFromNote", { hoistedNoteId: "root", noteId: "missingQueryNote" }), NotFoundError, 404 ],
            [ () => runSearchQuery("searchResultDetails", { hoistedNoteId: "root", noteId: searchNoteId, body: {} }), ValidationError, 400 ]
        ];

        for (const [ run, errorClass, status ] of cases) {
            let thrown: unknown;
            try {
                run();
            } catch (e) {
                thrown = e;
            }
            expect(thrown).toBeInstanceOf(errorClass);

            const rebuilt = deserializeSearchQueryError(structuredClone(serializeSearchQueryError(thrown)));
            expect(rebuilt).toBeInstanceOf(errorClass);
            expect((rebuilt as HttpError).statusCode).toBe(status);
            expect(rebuilt.message).toBe((thrown as Error).message);
        }

        const conflict = deserializeSearchQueryError(serializeSearchQueryError(new ConflictError("moved")));
        expect(conflict).toBeInstanceOf(HttpError);
        expect([ (conflict as HttpError).statusCode, conflict.name ]).toEqual([ 409, "ConflictError" ]);

        const plain = deserializeSearchQueryError(serializeSearchQueryError(new TypeError("broken")));
        expect(plain).not.toBeInstanceOf(HttpError);
        expect([ plain.name, plain.message ]).toEqual([ "TypeError", "broken" ]);
        expect(serializeSearchQueryError("text")).toEqual({ name: "Error", message: "text" });
    });
});

async function createSearchNote(searchString: string): Promise<string> {
    const created = await api.post<{ noteId: string }>("/api/special-notes/search-note", {
        body: { searchString }
    });
    return created.body.noteId;
}
