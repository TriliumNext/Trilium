import { beforeAll, describe, expect, it } from "vitest";

import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared core bulk-action routes through {@link CoreApiTester} (no
 * Express), so this spec runs under both the node and standalone (WASM) suites.
 */
let api: CoreApiTester;

interface AffectedCount {
    affectedNoteCount: number;
}

interface Attribute {
    type: string;
    name: string;
    value: string;
}

function getLabels(noteId: string) {
    return api.get<Attribute[]>(`/api/notes/${noteId}/attributes`);
}

describe("Bulk action API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    describe("affected note count", () => {
        it("counts a single existing note", async () => {
            const { noteId } = await createTextNote(api, { title: "Affected single" });

            const res = await api.post<AffectedCount>("/api/bulk-action/affected-notes", {
                body: { noteIds: [ noteId ], includeDescendants: false }
            });
            expect(res.status).toBe(200);
            expect(res.body.affectedNoteCount).toBe(1);
        });

        it("includes descendants when requested", async () => {
            const { noteId: parentId } = await createTextNote(api, { title: "Affected parent" });
            await createTextNote(api, { parentNoteId: parentId, title: "Affected child" });

            const shallow = await api.post<AffectedCount>("/api/bulk-action/affected-notes", {
                body: { noteIds: [ parentId ], includeDescendants: false }
            });
            const deep = await api.post<AffectedCount>("/api/bulk-action/affected-notes", {
                body: { noteIds: [ parentId ], includeDescendants: true }
            });

            expect(shallow.body.affectedNoteCount).toBe(1);
            expect(deep.body.affectedNoteCount).toBeGreaterThan(shallow.body.affectedNoteCount);
        });

        it("ignores note IDs that do not exist", async () => {
            const res = await api.post<AffectedCount>("/api/bulk-action/affected-notes", {
                body: { noteIds: [ "missingNote123" ], includeDescendants: false }
            });
            expect(res.status).toBe(200);
            expect(res.body.affectedNoteCount).toBe(0);
        });
    });

    describe("executing actions", () => {
        it("adds a label to the targeted notes (round-trip)", async () => {
            const { noteId } = await createTextNote(api, { title: "Label target" });

            const exec = await api.post("/api/bulk-action/execute", {
                body: {
                    noteIds: [ noteId ],
                    includeDescendants: false,
                    actions: [
                        { name: "addLabel", labelName: "bulkAdded", labelValue: "yes" }
                    ]
                }
            });
            expect(exec.status).toBe(204);

            const after = await getLabels(noteId);
            const added = after.body.find((attr) => attr.name === "bulkAdded");
            expect(added).toBeTruthy();
            expect(added?.value).toBe("yes");
        });

        it("deletes a label from the targeted notes (round-trip)", async () => {
            const { noteId } = await createTextNote(api, { title: "Label removal target" });

            await api.post("/api/bulk-action/execute", {
                body: {
                    noteIds: [ noteId ],
                    actions: [
                        { name: "addLabel", labelName: "toRemove", labelValue: "1" }
                    ]
                }
            });
            const withLabel = await getLabels(noteId);
            expect(withLabel.body.some((attr) => attr.name === "toRemove")).toBe(true);

            const exec = await api.post("/api/bulk-action/execute", {
                body: {
                    noteIds: [ noteId ],
                    actions: [ { name: "deleteLabel", labelName: "toRemove" } ]
                }
            });
            expect(exec.status).toBe(204);

            const afterDelete = await getLabels(noteId);
            expect(afterDelete.body.some((attr) => attr.name === "toRemove")).toBe(false);
        });

        it("falls back to the _bulkAction note when no actions are provided", async () => {
            const { noteId } = await createTextNote(api, { title: "No actions" });

            const exec = await api.post("/api/bulk-action/execute", {
                body: { noteIds: [ noteId ], actions: [] }
            });
            expect(exec.status).toBe(204);
        });
    });

    describe("error handling", () => {
        it("errors when noteIds is not an array", async () => {
            const res = await api.post("/api/bulk-action/execute", {
                body: { noteIds: "not-an-array", actions: [] }
            });
            expect(res.status).toBe(500);
        });

        it("errors when an action is missing a name", async () => {
            const { noteId } = await createTextNote(api, { title: "Bad action" });

            const res = await api.post("/api/bulk-action/execute", {
                body: { noteIds: [ noteId ], actions: [ { labelName: "x" } ] }
            });
            expect(res.status).toBe(500);
        });
    });
});
