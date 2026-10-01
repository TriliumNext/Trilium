import { beforeAll, describe, expect, it } from "vitest";

import type { NoteMapNote } from "@triliumnext/commons";

import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

let api: CoreApiTester;

describe("Reification API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    it("turns one relation into a note, then lets another relation point at that note", async () => {
        const map = await createTextNote(api, { title: "Map" });
        const source = await createTextNote(api, { title: "Note A" });
        const target = await createTextNote(api, { title: "Note B" });
        const critic = await createTextNote(api, { title: "Note C" });

        const created = await api.put<{ attributeId: string }>(
            `/api/notes/${source.noteId}/relations/supports/to/${target.noteId}`
        );
        expect(created.status).toBe(200);
        const attributeId = created.body.attributeId;
        expect(attributeId).toBeTruthy();

        const reified = await api.post<{ noteId: string; title: string; created: boolean }>(
            `/api/attributes/${attributeId}/reification`
        );
        expect(reified.status).toBe(200);
        expect(reified.body.created).toBe(true);
        expect(reified.body.title).toBe("supports(Note A, Note B)");

        const again = await api.post<{ noteId: string; created: boolean }>(
            `/api/attributes/${attributeId}/reification`
        );
        expect(again.status).toBe(200);
        expect(again.body.created).toBe(false);
        expect(again.body.noteId).toBe(reified.body.noteId);

        const lookedUp = await api.get<{ noteId: string }>(`/api/attributes/${attributeId}/reification`);
        expect(lookedUp.status).toBe(200);
        expect(lookedUp.body.noteId).toBe(reified.body.noteId);

        const rebuts = await api.put(`/api/notes/${critic.noteId}/relations/rebuts/to/${reified.body.noteId}`);
        expect(rebuts.status).toBe(200);

        const outsider = await createTextNote(api, { title: "Note D" });
        const cites = await api.put(`/api/notes/${reified.body.noteId}/relations/cites/to/${outsider.noteId}`);
        expect(cites.status).toBe(200);

        const mapped = await api.post<{
            relations: Array<{ name: string; sourceNoteId: string; targetNoteId: string }>;
            reifications: Array<{ noteId: string; attributeId: string; kind: string; title: string }>;
        }>("/api/relation-map", {
            body: {
                relationMapNoteId: map.noteId,
                noteIds: [ source.noteId, target.noteId, critic.noteId ]
            }
        });
        expect(mapped.status).toBe(200);

        const token = mapped.body.reifications.find((item) => item.attributeId === attributeId);
        expect(token).toMatchObject({
            noteId: reified.body.noteId,
            kind: "relation",
            title: "supports(Note A, Note B)"
        });

        const names = mapped.body.relations.map((relation) => relation.name);
        expect(names).toContain("supports");
        expect(names).toContain("rebuts");
        expect(names).not.toContain("reificationSubject");
        expect(names).not.toContain("reificationObject");

        const arrowAtArrow = mapped.body.relations.find((relation) => relation.name === "rebuts");
        expect(arrowAtArrow).toMatchObject({
            sourceNoteId: critic.noteId,
            targetNoteId: reified.body.noteId
        });

        const leavesTheArrow = mapped.body.relations.find((relation) => relation.name === "cites");
        expect(leavesTheArrow).toMatchObject({
            sourceNoteId: reified.body.noteId,
            targetNoteId: outsider.noteId
        });

        const listed = await api.get<{ items: { noteId: string; direct: boolean }[] }>(
            `/api/attributes/${attributeId}/reifications`
        );
        expect(listed.status).toBe(200);
        expect(listed.body.items).toContainEqual({
            noteId: reified.body.noteId,
            title: "supports(Note A, Note B)",
            attributeId,
            direct: true
        });

        const mark = await createTextNote(api, { title: "Mark" });
        await api.put(`/api/notes/${target.noteId}/relations/loves/to/${mark.noteId}`);

        const jealousy = await createTextNote(api, { title: "Jealousy" });
        const has = await api.put<{ attributeId: string }>(
            `/api/notes/${mark.noteId}/relations/has/to/${jealousy.noteId}`
        );
        const hasFact = await api.post<{ noteId: string }>(
            `/api/attributes/${has.body.attributeId}/reification`
        );
        const caused = await api.put(
            `/api/notes/${reified.body.noteId}/relations/cause/to/${hasFact.body.noteId}`
        );
        expect(caused.status).toBe(200);

        const linkMap = await api.post<{
            notes: NoteMapNote[];
            reificationLinks: Array<{
                linkId: string;
                name: string;
                outgoing: boolean;
                note?: NoteMapNote;
                otherFact?: { linkId: string; predicate: string };
            }>;
        }>(`/api/note-map/${source.noteId}/link`, {
            body: {}
        });
        expect(linkMap.status).toBe(200);
        expect(linkMap.body.notes.map((entry) => entry[0])).not.toContain(reified.body.noteId);
        expect(linkMap.body.reificationLinks).toContainEqual(expect.objectContaining({
            linkId: `${source.noteId}-${target.noteId}`,
            name: "cites",
            outgoing: true,
            note: expect.arrayContaining([ outsider.noteId, "Note D" ])
        }));
        expect(linkMap.body.reificationLinks).toContainEqual(expect.objectContaining({
            linkId: `${source.noteId}-${target.noteId}`,
            name: "cause",
            outgoing: true,
            otherFact: expect.objectContaining({
                linkId: `${mark.noteId}-${jealousy.noteId}`,
                predicate: "has"
            })
        }));

        const factMap = await api.post<{ notes: NoteMapNote[] }>(`/api/note-map/${reified.body.noteId}/link`, {
            body: {}
        });
        const factIds = factMap.body.notes.map((entry) => entry[0]);
        expect(factIds).toContain(reified.body.noteId);
        expect(factIds).toContain(outsider.noteId);
        expect(factIds).toContain(critic.noteId);
        expect(factIds).toContain(hasFact.body.noteId);
        expect(factIds).not.toContain(source.noteId);
        expect(factIds).not.toContain(jealousy.noteId);
        expect(factIds).not.toContain(target.noteId);
        expect(factIds).not.toContain(mark.noteId);

        const removed = await api.delete(`/api/attributes/${attributeId}/reification`);
        expect(removed.status).toBe(204);
        const gone = await api.get(`/api/attributes/${attributeId}/reification`);
        expect(gone.status).toBe(204);

        const missing = await api.post(`/api/attributes/missingAttribute/reification`);
        expect(missing.status).toBe(404);
    });
});
