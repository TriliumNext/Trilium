import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import becca from "../../becca/becca";
import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared core tree routes through the in-process {@link CoreApiTester}
 * (no Express / HTTP server), so this same spec runs under both the node
 * (better-sqlite3) and standalone (sql.js WASM) suites against the seeded demo DB.
 */
let api: CoreApiTester;

interface TreeResponse {
    notes: { noteId: string }[];
    branches: { branchId: string }[];
    attributes: unknown[];
}

describe("Tree API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    it("returns notes, branches and attributes rooted at root", async () => {
        const res = await api.get<TreeResponse>("/api/tree");

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.notes)).toBe(true);
        expect(res.body.notes.some((n) => n.noteId === "root")).toBe(true);
        // root always gets the synthetic `none_root` branch (parentNoteId "none").
        expect(res.body.branches.some((b) => b.branchId === "none_root")).toBe(true);
    });

    it("scopes the tree to a subtree via subTreeNoteId", async () => {
        const res = await api.get<TreeResponse>("/api/tree", {
            query: { subTreeNoteId: "_hidden" }
        });
        expect(res.status).toBe(200);
        expect(res.body.notes.some((n) => n.noteId === "_hidden")).toBe(true);
    });

    it("404s for an unknown subtree note", async () => {
        const res = await api.get("/api/tree", { query: { subTreeNoteId: "doesNotExist123" } });
        expect(res.status).toBe(404);
    });

    it("loads an explicit set of note ids", async () => {
        const res = await api.post<TreeResponse>("/api/tree/load", {
            body: { noteIds: [ "root" ] }
        });
        expect(res.status).toBe(200);
        expect(res.body.notes.some((n) => n.noteId === "root")).toBe(true);
    });

    describe("edge cases", () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("skips requested note ids that are not in the cache", async () => {
            // Hits the `if (!note) continue` guard while still returning the valid ones.
            const res = await api.post<TreeResponse>("/api/tree/load", {
                body: { noteIds: [ "root", "doesNotExist123" ] }
            });
            expect(res.status).toBe(200);
            expect(res.body.notes.some((n) => n.noteId === "root")).toBe(true);
            expect(res.body.notes.some((n) => n.noteId === "doesNotExist123")).toBe(false);
        });

        it("skips a collected branch id that is missing from the cache", async () => {
            // Force a dangling branchId into the collection (via the child-branch
            // lookup in collectEntityIds) so the `becca.branches[branchId]` lookup
            // misses and the guard runs. Use `load` so getTree's own collect()
            // recursion (which needs a real childNote) isn't affected.
            const original = becca.getBranchFromChildAndParent.bind(becca);
            vi.spyOn(becca, "getBranchFromChildAndParent").mockImplementation((childNoteId, parentNoteId) => {
                const branch = original(childNoteId, parentNoteId);
                if (branch) {
                    Object.defineProperty(branch, "branchId", { value: "ghostBranch123", configurable: true });
                }
                return branch;
            });

            const res = await api.post<TreeResponse>("/api/tree/load", { body: { noteIds: [ "root" ] } });
            expect(res.status).toBe(200);
            expect(res.body.branches.some((b) => b.branchId === "ghostBranch123")).toBe(false);
        });

        it("skips a collected attribute id that is missing from the cache", async () => {
            const { noteId } = await createTextNote(api, { title: "Note with ghost attribute" });
            const note = becca.notes[noteId];
            // Replace the note's owned attributes with one whose id is absent from becca.attributes.
            vi.spyOn(note, "ownedAttributes", "get").mockReturnValue([
                { attributeId: "ghostAttr123", type: "label", name: "x", targetNote: undefined } as never
            ]);

            const res = await api.post<TreeResponse>("/api/tree/load", { body: { noteIds: [ noteId ] } });
            expect(res.status).toBe(200);
            const attrs = res.body.attributes as { attributeId?: string }[];
            expect(attrs.some((a) => a.attributeId === "ghostAttr123")).toBe(false);
        });
    });
});
