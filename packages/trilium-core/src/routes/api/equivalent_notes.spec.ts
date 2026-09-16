import { beforeAll, describe, expect, it } from "vitest";

import becca from "../../becca/becca.js";
import { createTextNote } from "../../test/api_fixtures.js";
import { CoreApiTester } from "../../test/api_tester.js";

let api: CoreApiTester;

describe("Equivalent notes API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    it("returns members of a ~equiv class and 404s for a missing note", async () => {
        const car = await createTextNote(api, { title: "Car" });
        const auto = await createTextNote(api, { title: "Auto" });
        await api.put(`/api/notes/${car.noteId}/relations/equiv/to/${auto.noteId}`);

        const res = await api.get<{
            groups: { relationName: string; members: { noteId: string }[] }[];
        }>(`/api/notes/${car.noteId}/equivalent-notes`);

        expect(res.status).toBe(200);
        const equivGroup = res.body.groups.find((g) => g.relationName === "equiv");
        expect(equivGroup?.members.map((m) => m.noteId)).toContain(auto.noteId);
        expect(equivGroup?.members.map((m) => m.noteId)).toContain(car.noteId);

        const missing = await api.get("/api/notes/missingEquivNote/equivalent-notes");
        expect(missing.status).toBe(404);

        const lone = await createTextNote(api, { title: "Lone" });
        const empty = await api.get<{ groups: unknown[] }>(`/api/notes/${lone.noteId}/equivalent-notes`);
        expect(empty.status).toBe(200);
        expect(empty.body.groups).toEqual([]);
        expect(becca.getNote(car.noteId)).toBeTruthy();
    });

    it("returns each member's name in that type", async () => {
        const de = await createTextNote(api, { title: "Auto" });
        const en = await createTextNote(api, { title: "Car" });
        await api.put(`/api/notes/${de.noteId}/relations/equiv/to/${en.noteId}`);
        await api.put(`/api/notes/${de.noteId}/set-attribute`, {
            body: { type: "label", name: "equivLabel", value: "German" }
        });
        await api.put(`/api/notes/${en.noteId}/set-attribute`, {
            body: { type: "label", name: "equivLabel", value: "English" }
        });

        const res = await api.get<{
            groups: { relationName: string; members: { noteId: string; displayName?: string }[] }[];
        }>(`/api/notes/${de.noteId}/equivalent-notes`);

        expect(res.status).toBe(200);
        const equivGroup = res.body.groups.find((g) => g.relationName === "equiv");
        const byId = new Map((equivGroup?.members ?? []).map((m) => [ m.noteId, m.displayName ]));
        expect(byId.get(de.noteId)).toBe("German");
        expect(byId.get(en.noteId)).toBe("English");
    });
});
