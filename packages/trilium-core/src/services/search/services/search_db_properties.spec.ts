import { beforeAll, describe, expect, it } from "vitest";

import { getContext } from "../../context.js";
import noteService from "../../notes.js";
import sql_init from "../../sql_init.js";
import searchService from "./search.js";

/**
 * `contentSize`, `contentAndAttachmentsSize`, `contentAndAttachmentsAndRevisionsSize` and
 * `revisionCount` are not held on the becca note — the search service computes them in
 * `loadNeededInfoFromDatabase()`, which only runs when an expression asked for it via
 * `searchContext.dbLoadNeeded`. That makes these the one group of properties that needs a real
 * database to test, hence this file rather than the mocked-becca `search.spec.ts`.
 *
 * Regression: PropertyComparisonExp used to set the flag by testing its case-mapped property name
 * ("contentSize") against a lower-cased list, so it never matched. The fields stayed undefined and
 * every comparison against them silently matched nothing, while `orderBy` on the same properties
 * worked (ValueExtractor does the equivalent check correctly).
 */
describe("search on database-backed note properties", () => {
    const BODY_LENGTH = 500;

    beforeAll(async () => {
        sql_init.initializeDb();
        await sql_init.dbReady;

        getContext().init(() =>
            noteService.createNewNote({
                parentNoteId: "root",
                title: "DbPropsProbe",
                type: "text",
                mime: "text/html",
                content: `<p>${"x".repeat(BODY_LENGTH)}</p>`
            })
        );
    });

    it("filters on contentSize instead of silently matching nothing", () => {
        const titleOnly = searchService.searchNotes("note.title *=* DbPropsProbe");
        expect(titleOnly).toHaveLength(1);

        // Every note clears `>= 0`, so this must not narrow the result at all.
        expect(searchService.searchNotes("note.title *=* DbPropsProbe AND note.contentSize >= 0")).toHaveLength(1);
        expect(searchService.searchNotes(`note.title *=* DbPropsProbe AND note.contentSize >= ${BODY_LENGTH}`)).toHaveLength(1);
        // ... and a threshold above the body really does exclude it, so the value is genuinely compared.
        expect(searchService.searchNotes(`note.title *=* DbPropsProbe AND note.contentSize > ${BODY_LENGTH * 10}`)).toHaveLength(0);
    });

    it("filters on the remaining database-backed properties", () => {
        for (const property of ["contentAndAttachmentsSize", "contentAndAttachmentsAndRevisionsSize", "revisionCount"]) {
            expect(searchService.searchNotes(`note.title *=* DbPropsProbe AND note.${property} >= 0`)).toHaveLength(1);
        }
    });

    it("still supports ordering by them", () => {
        // ValueExtractor sets the same flag for orderBy, which is why that path always worked.
        const ordered = searchService.searchNotes("note.title *=* DbPropsProbe orderBy note.contentSize desc");
        expect(ordered).toHaveLength(1);
    });
});
