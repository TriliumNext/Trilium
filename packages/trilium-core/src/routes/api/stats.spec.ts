import { beforeAll, describe, expect, it } from "vitest";

import { CoreApiTester } from "../../test/api_tester";

let api: CoreApiTester;

describe("Stats API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    it("returns the blob size of a note", async () => {
        const res = await api.get<{ noteSize: number }>("/api/stats/note-size/root");
        expect(res.status).toBe(200);
        expect(typeof res.body.noteSize).toBe("number");
        expect(res.body.noteSize).toBeGreaterThanOrEqual(0);
    });

    it("returns the subtree size and note count", async () => {
        const res = await api.get<{ subTreeSize: number; subTreeNoteCount: number }>(
            "/api/stats/subtree-size/root"
        );
        expect(res.status).toBe(200);
        expect(typeof res.body.subTreeSize).toBe("number");
        expect(res.body.subTreeNoteCount).toBeGreaterThan(1);
    });

    // note-size runs a pure SQL aggregate (no note lookup), so a missing note is
    // 0 bytes rather than an error; subtree-size resolves the note first and 404s.
    it("reports zero size for a missing note", async () => {
        const res = await api.get<{ noteSize: number }>("/api/stats/note-size/missingNote123");
        expect(res.status).toBe(200);
        expect(res.body.noteSize).toBe(0);
    });

    it("404s for the subtree size of a missing note", async () => {
        const res = await api.get("/api/stats/subtree-size/missingNote123");
        expect(res.status).toBe(404);
    });
});
