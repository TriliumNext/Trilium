import type { SearchLintResponse } from "@triliumnext/commons";
import { beforeAll, describe, expect, it } from "vitest";

import { CoreApiTester } from "../../test/api_tester";

let api: CoreApiTester;

describe("Search lint (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    it("answers nothing for a query the engine accepts", async () => {
        for (const searchString of [ "", "towers #book", "~author.title = tolkien", "note.text *=* hello" ]) {
            const res = await api.post("/api/search/lint", { body: { searchString } });

            expect(res.status, searchString).toBe(200);
            expect(res.body, searchString).toEqual({ error: null });
        }
    });

    it("reports the fault in a query the engine refuses", async () => {
        const res = await api.post<SearchLintResponse>("/api/search/lint", { body: { searchString: "~author = tolkien" } });

        expect(res.status).toBe(200);
        expect(res.body.error).toContain("Relation can be compared only with property");

        // Faults the client's own rules do not cover, which is the point of asking the engine.
        const mixed = await api.post<SearchLintResponse>("/api/search/lint", { body: { searchString: "#a and #b or #c" } });
        expect(mixed.body.error).toContain("Mixed usage of AND/OR");

        const ordering = await api.post<SearchLintResponse>("/api/search/lint", { body: { searchString: "#book orderBy foo" } });
        expect(ordering.body.error).toContain("must start with 'note'");
    });

    it("describes a query cut short rather than throwing out of the route", async () => {
        // `parseNoteProperty` reads the token past the end of these, so validation has to survive it.
        for (const searchString of [ "note.labels", "note.relations", "note.parents" ]) {
            const res = await api.post<SearchLintResponse>("/api/search/lint", { body: { searchString } });

            expect(res.status, searchString).toBe(200);
            expect(res.body.error, searchString).toBeTruthy();
        }
    });

    it("refuses a body that carries no query", async () => {
        const res = await api.post("/api/search/lint", { body: {} });

        expect(res.status).toBe(400);
    });
});
