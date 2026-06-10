import { beforeAll, describe, expect, it } from "vitest";

import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared core similar-notes route through {@link CoreApiTester} (no Express),
 * so this spec runs under both the node and standalone (WASM) suites.
 */
let api: CoreApiTester;

interface SimilarNote {
    score: number;
    notePath: string[];
    noteId: string;
}

describe("Similar Notes API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    it("returns a list of similar notes for an existing note", async () => {
        const res = await api.get<SimilarNote[]>("/api/similar-notes/root");
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        for (const similar of res.body) {
            expect(typeof similar.noteId).toBe("string");
            expect(typeof similar.score).toBe("number");
            expect(Array.isArray(similar.notePath)).toBe(true);
        }
    });

    it("finds a freshly created note that shares content with another", async () => {
        const shared = "alphabet bicycle continuous determination elephant fountain";
        const first = await createTextNote(api, {
            title: "Similar source",
            content: `<p>${shared}</p>`
        });
        const { noteId } = await createTextNote(api, {
            title: "Similar source",
            content: `<p>${shared}</p>`
        });

        const res = await api.get<SimilarNote[]>(`/api/similar-notes/${noteId}`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        // The sibling sharing the same content is actually found (not a vacuous pass).
        expect(res.body.some((similar) => similar.noteId === first.noteId)).toBe(true);
        // The note never lists itself as similar.
        expect(res.body.every((similar) => similar.noteId !== noteId)).toBe(true);
    });

    it("404s for a missing note", async () => {
        const res = await api.get("/api/similar-notes/missingNote123");
        expect(res.status).toBe(404);
    });
});
