import { beforeAll, describe, expect, it } from "vitest";

import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared core relation-map route through {@link CoreApiTester} (no Express),
 * so this spec runs under both the node and standalone (WASM) suites.
 */
let api: CoreApiTester;

interface RelationMapResponse {
    noteTitles: Record<string, string>;
    relations: Array<{
        attributeId: string;
        sourceNoteId: string;
        targetNoteId: string;
        name: string;
    }>;
    inverseRelations: Record<string, string>;
}

describe("Relation Map API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    it("returns the default empty response when no note ids are supplied", async () => {
        const res = await api.post<RelationMapResponse>("/api/relation-map", {
            body: { relationMapNoteId: "root", noteIds: [] }
        });

        expect(res.status).toBe(200);
        expect(res.body.noteTitles).toEqual({});
        expect(res.body.relations).toEqual([]);
        expect(res.body.inverseRelations.internalLink).toBe("internalLink");
    });

    it("returns the default empty response when note ids are omitted", async () => {
        const res = await api.post<RelationMapResponse>("/api/relation-map", {
            body: { relationMapNoteId: "root" }
        });

        expect(res.status).toBe(200);
        expect(res.body.relations).toEqual([]);
        expect(res.body.inverseRelations.internalLink).toBe("internalLink");
    });

    it("maps titles and relations between the supplied notes", async () => {
        const map = await createTextNote(api, { title: "Map" });
        const source = await createTextNote(api, { title: "Source" });
        const target = await createTextNote(api, { title: "Target" });

        const rel = await api.put(
            `/api/notes/${source.noteId}/relations/links/to/${target.noteId}`
        );
        expect(rel.status).toBe(200);

        const res = await api.post<RelationMapResponse>("/api/relation-map", {
            body: {
                relationMapNoteId: map.noteId,
                noteIds: [ source.noteId, target.noteId ]
            }
        });

        expect(res.status).toBe(200);
        expect(res.body.noteTitles[source.noteId]).toBe("Source");
        expect(res.body.noteTitles[target.noteId]).toBe("Target");

        const mapped = res.body.relations.find(
            (relation) => relation.sourceNoteId === source.noteId
        );
        expect(mapped).toMatchObject({
            sourceNoteId: source.noteId,
            targetNoteId: target.noteId,
            name: "links"
        });
        expect(mapped?.attributeId).toBeTruthy();
    });

    it("omits relations whose target is not part of the requested note ids", async () => {
        const map = await createTextNote(api, { title: "Map" });
        const source = await createTextNote(api, { title: "Source" });
        const target = await createTextNote(api, { title: "Target" });

        const rel = await api.put(
            `/api/notes/${source.noteId}/relations/links/to/${target.noteId}`
        );
        expect(rel.status).toBe(200);

        const res = await api.post<RelationMapResponse>("/api/relation-map", {
            body: {
                relationMapNoteId: map.noteId,
                noteIds: [ source.noteId ]
            }
        });

        expect(res.status).toBe(200);
        expect(res.body.relations).toEqual([]);
    });

    it("includes inverse relation definitions of the requested notes", async () => {
        const map = await createTextNote(api, { title: "Map" });
        const source = await createTextNote(api, { title: "Source" });

        // A promoted relation definition with an inverse relation populates the
        // inverseRelations map for both directions.
        const attr = await api.post(`/api/notes/${source.noteId}/attributes`, {
            body: { type: "label", name: "relation:spouse", value: "inverse=spouse" }
        });
        expect(attr.status).toBe(204);

        const res = await api.post<RelationMapResponse>("/api/relation-map", {
            body: { relationMapNoteId: map.noteId, noteIds: [ source.noteId ] }
        });

        expect(res.status).toBe(200);
        expect(res.body.inverseRelations.spouse).toBe("spouse");
    });

    it("honours displayRelations and hideRelations labels on the map note", async () => {
        const map = await createTextNote(api, { title: "Map" });
        const source = await createTextNote(api, { title: "Source" });
        const target = await createTextNote(api, { title: "Target" });

        // displayRelations acts as an allow-list: only "links" is kept, "ignored" dropped.
        for (const label of [
            { name: "displayRelations", value: "links, other" },
            { name: "hideRelations", value: "ignored" }
        ]) {
            const res = await api.post(`/api/notes/${map.noteId}/attributes`, {
                body: { type: "label", name: label.name, value: label.value }
            });
            expect(res.status).toBe(204);
        }

        for (const name of [ "links", "ignored" ]) {
            await api.put(`/api/notes/${source.noteId}/relations/${name}/to/${target.noteId}`);
        }

        const res = await api.post<RelationMapResponse>("/api/relation-map", {
            body: {
                relationMapNoteId: map.noteId,
                noteIds: [ source.noteId, target.noteId ]
            }
        });

        expect(res.status).toBe(200);
        const names = res.body.relations.map((relation) => relation.name);
        expect(names).toContain("links");
        expect(names).not.toContain("ignored");
    });

    it("404s when the relation map note does not exist", async () => {
        const { noteId } = await createTextNote(api, { title: "Source" });

        const res = await api.post("/api/relation-map", {
            body: { relationMapNoteId: "missingNote123", noteIds: [ noteId ] }
        });

        expect(res.status).toBe(404);
    });
});
