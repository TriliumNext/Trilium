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

    it("turns a label into a relation by specifying the object, and back into a label", async () => {
        const source = await createTextNote(api, { title: "Climate paper" });
        const created = await api.put<{ attributeId: string }>(`/api/notes/${source.noteId}/attribute`, {
            body: { type: "label", name: "assurance", value: "0.8" }
        });
        const attributeId = created.body.attributeId;

        const bare = await api.get<{ options: unknown[] }>(`/api/reification-concepts/assurance/options`);
        expect(bare.status).toBe(200);
        expect(bare.body.options).toEqual([]);

        await api.post(`/api/reification-concepts/assurance`);
        const specified = await api.post<{ noteId: string; title: string; attributeId: string; created: boolean }>(
            `/api/attributes/${attributeId}/object`
        );
        expect(specified.status).toBe(200);
        expect(specified.body.created).toBe(true);
        expect(specified.body.title).toBe("0.8");

        const options = await api.get<{ options: { noteId: string; title: string }[] }>(
            `/api/reification-concepts/assurance/options`
        );
        expect(options.body.options).toEqual([ { noteId: specified.body.noteId, title: "0.8" } ]);

        const back = await api.delete<{ attributeId: string; value: string }>(
            `/api/attributes/${specified.body.attributeId}/object`
        );
        expect(back.status).toBe(200);
        expect(back.body.value).toBe("0.8");
    });

    it("creates the note that talks about a note, and returns the same one again", async () => {
        const mary = await createTextNote(api, { title: "Mary Toulmin" });
        const missing = await api.get<{ noteId: string | null }>(`/api/notes/${mary.noteId}/self-reification`);
        expect(missing.status).toBe(200);
        expect(missing.body.noteId).toBeNull();

        const created = await api.post<{ noteId: string; title: string; created: boolean }>(
            `/api/notes/${mary.noteId}/self-reification`
        );
        expect(created.status).toBe(200);
        expect(created.body.created).toBe(true);
        expect(created.body.title).toBe("Mary Toulmin'");

        const again = await api.post<{ noteId: string; created: boolean }>(
            `/api/notes/${mary.noteId}/self-reification`
        );
        expect(again.body.created).toBe(false);
        expect(again.body.noteId).toBe(created.body.noteId);

        const found = await api.get<{ noteId: string | null; title: string | null }>(
            `/api/notes/${mary.noteId}/self-reification`
        );
        expect(found.body).toEqual({ noteId: created.body.noteId, title: "Mary Toulmin'" });
    });

    it("stores a formula on its concept and fills it", async () => {
        const saved = await api.put<{ pattern: string }>(`/api/reification-concepts/apiArgument/pattern`, {
            body: { pattern: "apiArgument(A, B) = R(A, B); A'" }
        });
        expect(saved.status).toBe(200);
        expect(saved.body.pattern).toBe("apiArgument(A, B) = R(A, B); A'");

        const created = await api.post<{ noteId: string; title: string }>(`/api/reification-concepts/apiArgument/instance`);
        expect(created.status).toBe(200);
        expect(created.body.title).toBe("apiArgument(A, B)");

        const ann = await createTextNote(api, { title: "Ann" });
        const filled = await api.post<{ noteId: string; title: string }>(`/api/reification-concepts/apiArgument/instance`, {
            body: { notes: { A: ann.noteId } }
        });
        expect(filled.status).toBe(200);
        expect(filled.body.title).toBe("apiArgument(Ann, B)");

        const places = await api.post<{ places: { name: string; noteId: string | null; title: string | null }[] }>(
            `/api/notes/${filled.body.noteId}/reification-places`
        );
        expect(places.status).toBe(200);
        expect(places.body.places[1]).toEqual({ name: "B", noteId: null, title: null });

        const bob = await createTextNote(api, { title: "Bob" });
        const specified = await api.post<{ places: { title: string | null }[] }>(
            `/api/notes/${filled.body.noteId}/reification-places/B`,
            { body: { noteId: bob.noteId } }
        );
        expect(specified.status).toBe(200);
        expect(specified.body.places[1]?.title).toBe("Bob");

        const wrong = await api.put(`/api/reification-concepts/apiArgument/pattern`, {
            body: { pattern: "otherName(A) = A" }
        });
        expect(wrong.status).toBe(400);
    });
});
