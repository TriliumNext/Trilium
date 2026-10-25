import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { NotFoundError, ValidationError } from "../../errors.js";
import attributeService from "../attributes.js";
import config from "../config.js";
import { getContext } from "../context.js";
import { getSql } from "../sql/index.js";
import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";
import { getSearchExecutor, inProcessSearchExecutor, initSearchExecutor, type SearchExecutor } from "./search_executor.js";
import {
    deserializeSearchQueryError, runSearchQuery, type SearchQueryArgs, type SearchQueryKind, serializeSearchQueryError
} from "./search_queries.js";

let api: CoreApiTester;
const TOKEN = "ZzSearchExecutorTokenQwerty";

interface Call {
    kind: SearchQueryKind;
    args: SearchQueryArgs[SearchQueryKind];
}

describe("search executor", () => {
    let noteId: string;
    let searchNoteId: string;

    beforeAll(async () => {
        api = CoreApiTester.build();
        ({ noteId } = await createTextNote(api, { title: TOKEN }));
        const created = await api.post<{ noteId: string }>("/api/special-notes/search-note", {
            body: { searchString: TOKEN }
        });
        searchNoteId = created.body.noteId;
    });

    afterEach(() => initSearchExecutor());

    it("defaults to running the queries in this process", async () => {
        initSearchExecutor();
        expect(getSearchExecutor()).toBe(inProcessSearchExecutor);
        expect(await inProcessSearchExecutor.run("search", { hoistedNoteId: "root", searchString: TOKEN }))
            .toEqual([ noteId ]);
        await expect(inProcessSearchExecutor.run("search", { hoistedNoteId: "root" })).rejects.toBeInstanceOf(ValidationError);
    });

    it("sends every search route through the installed executor with the caller's hoisted note", async () => {
        const calls: Call[] = [];
        const fake: SearchExecutor = {
            run(kind, args) {
                calls.push({ kind, args });
                return Promise.resolve(runSearchQuery(kind, args));
            }
        };
        initSearchExecutor(fake);

        const headers = { "trilium-hoisted-note-id": "root" };
        const responses = [
            await api.get("/api/quick-search", { query: { searchString: TOKEN }, headers }),
            await api.get("/api/search", { query: { searchString: ` ${TOKEN}  ` } }),
            await api.post("/api/search-related", { body: { type: "label", name: "x", value: "y" } }),
            await api.get(`/api/search-note/${searchNoteId}`),
            await api.post(`/api/search-note/${searchNoteId}/result-details`, { body: { noteIds: [ noteId ] } }),
            await api.get("/api/autocomplete", { query: { query: TOKEN, limit: "3" } })
        ];

        expect(responses.map((response) => response.status)).toEqual([ 200, 200, 200, 200, 200, 200 ]);
        expect(calls).toEqual([
            { kind: "quickSearch", args: { hoistedNoteId: "root", searchString: TOKEN } },
            {
                kind: "search",
                args: {
                    hoistedNoteId: "root", searchString: ` ${TOKEN}  `,
                    ancestorNoteId: undefined, includeTokens: undefined, includeArchivedNotes: undefined
                }
            },
            { kind: "relatedNotes", args: { hoistedNoteId: "root", attribute: { type: "label", name: "x", value: "y" } } },
            { kind: "searchFromNote", args: { hoistedNoteId: "root", noteId: searchNoteId } },
            { kind: "searchResultDetails", args: { hoistedNoteId: "root", noteId: searchNoteId, body: { noteIds: [ noteId ] } } },
            {
                kind: "autocomplete",
                args: {
                    hoistedNoteId: "root", query: TOKEN, fastSearch: undefined, limit: "3",
                    filter: undefined, activeNoteId: undefined
                }
            }
        ]);
        expect(responses[1].body).toEqual([ noteId ]);
        expect(responses[1].locals?.logSummary).toBe(`Search: ${TOKEN}  (returned 1 items)`);
        for (const call of calls) {
            expect(structuredClone(call.args)).toEqual(call.args);
        }
    });

    it("uses the executor's answer and counts it for the request log", async () => {
        initSearchExecutor({
            run: () => Promise.resolve({ searchResultNoteIds: [ "a", "b" ], highlightedTokens: [], error: null }) as never
        });

        const response = await api.get("/api/search", { query: { searchString: "anything", includeTokens: "true" } });
        expect(response.body).toEqual({ searchResultNoteIds: [ "a", "b" ], highlightedTokens: [], error: null });
        expect(response.locals?.logSummary).toBe("Search: anything  (returned 2 items)");
    });

    it("runs a search the executor hands back in this process", async () => {
        initSearchExecutor({ run: () => Promise.resolve({ needsMain: true }) as never });

        const fromNote = await api.get(`/api/search-note/${searchNoteId}`);
        expect(fromNote.status).toBe(200);
        expect(fromNote.body).toEqual(runSearchQuery("searchFromNote", { hoistedNoteId: "root", noteId: searchNoteId }));

        const details = await api.post(`/api/search-note/${searchNoteId}/result-details`, { body: { noteIds: [ noteId ] } });
        expect(details.status).toBe(200);
        expect(details.body).toEqual(runSearchQuery("searchResultDetails", {
            hoistedNoteId: "root", noteId: searchNoteId, body: { noteIds: [ noteId ] }
        }));
    });

    it("answers an error that crossed a process boundary with the status the route gave it", async () => {
        const remote: SearchExecutor = {
            run(kind, args) {
                try {
                    return Promise.resolve(runSearchQuery(kind, args));
                } catch (e) {
                    return Promise.reject(deserializeSearchQueryError(structuredClone(serializeSearchQueryError(e))));
                }
            }
        };
        initSearchExecutor(remote);

        expect((await api.get("/api/quick-search", { query: { searchString: "" } })).status).toBe(400);
        expect((await api.get("/api/autocomplete", { query: { query: "x", limit: "-1" } })).status).toBe(400);
        expect((await api.get("/api/search-note/root")).status).toBe(400);
        expect((await api.get("/api/search-note/missingExecutorNote")).status).toBe(404);
        expect((await api.post(`/api/search-note/${searchNoteId}/result-details`, { body: {} })).status).toBe(400);

        initSearchExecutor({ run: () => Promise.reject(new NotFoundError("gone")) });
        expect((await api.get("/api/autocomplete", { query: { query: "x" } })).status).toBe(404);
    });

    it("runs a script-based saved search in one transaction, keeping its writes only when it succeeds", async () => {
        const originalScriptingEnabled = config.Security.backendScriptingEnabled;
        config.Security.backendScriptingEnabled = true;
        const scriptSearch = async (title: string, tail: string) => {
            const script = await api.post<{ note: { noteId: string } }>("/api/notes/root/children?target=into", {
                body: {
                    title: "Search script",
                    type: "code",
                    mime: "application/javascript;env=backend",
                    content: `api.createTextNote("root", "${title}", "written by a search script");\n${tail}`
                }
            });
            const saved = await api.post<{ noteId: string }>("/api/special-notes/search-note", { body: {} });
            getContext().init(() => attributeService.createRelation(saved.body.noteId, "searchScript", script.body.note.noteId));
            return saved.body.noteId;
        };
        const countTitled = (title: string) =>
            getSql().getValue<number>("SELECT COUNT(*) FROM notes WHERE title = ? AND isDeleted = 0", [ title ]);

        try {
            const failing = await scriptSearch("ZzFailingScriptWrite", "throw new Error(\"search script failed\");");
            const succeeding = await scriptSearch("ZzSucceedingScriptWrite", "return [];");
            const executors: Record<string, SearchExecutor> = {
                inProcess: inProcessSearchExecutor,
                needsMain: { run: () => Promise.resolve({ needsMain: true }) as never }
            };

            for (const [ name, executor ] of Object.entries(executors)) {
                initSearchExecutor(executor);
                const failingBefore = countTitled("ZzFailingScriptWrite");
                const succeedingBefore = countTitled("ZzSucceedingScriptWrite");

                expect((await api.get(`/api/search-note/${failing}`)).status).toBe(500);
                expect(countTitled("ZzFailingScriptWrite"), name).toBe(failingBefore);

                expect((await api.get(`/api/search-note/${succeeding}`)).status).toBe(200);
                expect(countTitled("ZzSucceedingScriptWrite"), name).toBe(succeedingBefore + 1);
            }
        } finally {
            config.Security.backendScriptingEnabled = originalScriptingEnabled;
        }
    });
});
