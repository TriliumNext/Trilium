import { beforeAll, describe, expect, it } from "vitest";

import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

let api: CoreApiTester;

interface AttrRow {
    attributeId: string;
    type: string;
    name: string;
    value: string;
}

describe("Attributes API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    describe("reading", () => {
        it("returns the effective attributes of a note", async () => {
            const res = await api.get<AttrRow[]>("/api/notes/_hidden/attributes");
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.some((a) => a.name === "docName")).toBe(true);
        });

        it("returns attribute names filtered by type and query", async () => {
            const res = await api.get("/api/attribute-names", {
                query: { type: "label", query: "" }
            });
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });

        it("400s when type/query params are missing", async () => {
            const res = await api.get("/api/attribute-names");
            expect(res.status).toBe(400);
        });

        it("returns distinct values for an attribute name", async () => {
            const res = await api.get("/api/attribute-values/docName");
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);
        });
    });

    describe("writing", () => {
        it("adds a label, reads it back, then deletes it", async () => {
            const { noteId } = await createTextNote(api);

            const add = await api.post(`/api/notes/${noteId}/attributes`, {
                body: { type: "label", name: "myLabel", value: "myValue" }
            });
            expect(add.status).toBe(204);

            const afterAdd = await api.get<AttrRow[]>(`/api/notes/${noteId}/attributes`);
            const added = afterAdd.body.find((a) => a.name === "myLabel");
            expect(added).toMatchObject({ type: "label", value: "myValue" });

            const del = await api.delete(`/api/notes/${noteId}/attributes/${added!.attributeId}`);
            expect(del.status).toBe(204);

            const afterDelete = await api.get<AttrRow[]>(`/api/notes/${noteId}/attributes`);
            const remainingIds = afterDelete.body.map((a) => a.attributeId);
            expect(remainingIds).not.toContain(added!.attributeId);
        });

        it("sets an attribute idempotently via set-attribute", async () => {
            const { noteId } = await createTextNote(api);

            const first = await api.put(`/api/notes/${noteId}/set-attribute`, {
                body: { type: "label", name: "color", value: "red" }
            });
            expect(first.status).toBe(204);

            await api.put(`/api/notes/${noteId}/set-attribute`, {
                body: { type: "label", name: "color", value: "blue" }
            });

            const res = await api.get<AttrRow[]>(`/api/notes/${noteId}/attributes`);
            const colors = res.body.filter((a) => a.name === "color");
            expect(colors).toHaveLength(1);
            expect(colors[0].value).toBe("blue");
        });

        it("creates a relation between two notes", async () => {
            const { noteId } = await createTextNote(api);

            const res = await api.put<AttrRow>(`/api/notes/${noteId}/relations/myRelation/to/root`);
            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({ type: "relation", name: "myRelation", value: "root" });
        });

        it("reuses the existing relation on repeated create", async () => {
            const { noteId } = await createTextNote(api);

            const first = await api.put<AttrRow>(`/api/notes/${noteId}/relations/dup/to/root`);
            const second = await api.put<AttrRow>(`/api/notes/${noteId}/relations/dup/to/root`);
            expect(second.status).toBe(200);
            expect(second.body.attributeId).toBe(first.body.attributeId);
        });

        it("creates then deletes a relation via the relations endpoint", async () => {
            const { noteId } = await createTextNote(api);

            await api.put(`/api/notes/${noteId}/relations/delMe/to/root`);
            const del = await api.delete(`/api/notes/${noteId}/relations/delMe/to/root`);
            expect(del.status).toBe(204);

            const after = await api.get<AttrRow[]>(`/api/notes/${noteId}/attributes`);
            expect(after.body.some((a) => a.name === "delMe")).toBe(false);

            // deleting a relation that does not exist is a no-op (no attributeId branch)
            const delAgain = await api.delete(`/api/notes/${noteId}/relations/delMe/to/root`);
            expect(delAgain.status).toBe(204);
        });

        it("404s when deleting an attribute owned by another note", async () => {
            const owner = await createTextNote(api, { title: "Owner" });
            const other = await createTextNote(api, { title: "Other" });

            const add = await api.post(`/api/notes/${owner.noteId}/attributes`, {
                body: { type: "label", name: "owned", value: "x" }
            });
            expect(add.status).toBe(204);
            const attrs = await api.get<AttrRow[]>(`/api/notes/${owner.noteId}/attributes`);
            const attrId = attrs.body.find((a) => a.name === "owned")!.attributeId;

            const del = await api.delete(`/api/notes/${other.noteId}/attributes/${attrId}`);
            expect(del.status).toBe(400);
        });
    });

    describe("updateNoteAttribute", () => {
        async function addLabel(noteId: string, name: string, value: string) {
            await api.post(`/api/notes/${noteId}/attributes`, {
                body: { type: "label", name, value }
            });
            const attrs = await api.get<AttrRow[]>(`/api/notes/${noteId}/attributes`);
            return attrs.body.find((a) => a.name === name)!.attributeId;
        }

        it("creates a new label when no attributeId is given", async () => {
            const { noteId } = await createTextNote(api);
            const res = await api.put<{ attributeId: string }>(`/api/notes/${noteId}/attribute`, {
                body: { type: "label", name: "fresh", value: "v" }
            });
            expect(res.status).toBe(200);
            expect(res.body.attributeId).toBeTruthy();

            const attrs = await api.get<AttrRow[]>(`/api/notes/${noteId}/attributes`);
            expect(attrs.body.find((a) => a.attributeId === res.body.attributeId)?.value).toBe("v");
        });

        it("creates a relation with a target and updates its value in place", async () => {
            const { noteId } = await createTextNote(api);
            const created = await api.put<{ attributeId: string }>(`/api/notes/${noteId}/attribute`, {
                body: { type: "relation", name: "rel", value: "root" }
            });
            expect(created.status).toBe(200);
            expect(created.body.attributeId).toBeTruthy();

            // same id, same type/name, only the relation value changes -> clone + delete
            const child = await createTextNote(api, { title: "rel target" });
            const changed = await api.put<{ attributeId: string }>(`/api/notes/${noteId}/attribute`, {
                body: { attributeId: created.body.attributeId, type: "relation", name: "rel", value: child.noteId }
            });
            expect(changed.status).toBe(200);
            expect(changed.body.attributeId).not.toBe(created.body.attributeId);
        });

        it("returns {} when creating a relation with no target and no id", async () => {
            const { noteId } = await createTextNote(api);
            const res = await api.put<Record<string, never>>(`/api/notes/${noteId}/attribute`, {
                body: { type: "relation", name: "noTarget", value: "  " }
            });
            expect(res.status).toBe(200);
            expect(res.body).toEqual({});
        });

        it("clones the attribute when type or name changes", async () => {
            const { noteId } = await createTextNote(api);
            const attrId = await addLabel(noteId, "rename", "v");

            const res = await api.put<{ attributeId: string | null }>(`/api/notes/${noteId}/attribute`, {
                body: { attributeId: attrId, type: "label", name: "renamed", value: "v" }
            });
            expect(res.status).toBe(200);
            expect(res.body.attributeId).toBeTruthy();
            expect(res.body.attributeId).not.toBe(attrId);
        });

        it("updates the value when only the value changes", async () => {
            const { noteId } = await createTextNote(api);
            const attrId = await addLabel(noteId, "stable", "old");

            const res = await api.put<{ attributeId: string }>(`/api/notes/${noteId}/attribute`, {
                body: { attributeId: attrId, type: "label", name: "stable", value: "new" }
            });
            expect(res.status).toBe(200);
            expect(res.body.attributeId).toBe(attrId);

            const attrs = await api.get<AttrRow[]>(`/api/notes/${noteId}/attributes`);
            expect(attrs.body.find((a) => a.attributeId === attrId)?.value).toBe("new");
        });

        it("deletes a relation when its value is cleared", async () => {
            const { noteId } = await createTextNote(api);
            const created = await api.put<{ attributeId: string }>(`/api/notes/${noteId}/attribute`, {
                body: { type: "relation", name: "clearable", value: "root" }
            });

            // same id/type/name, value emptied -> falls through to the markAsDeleted branch
            const res = await api.put<{ attributeId: string }>(`/api/notes/${noteId}/attribute`, {
                body: { attributeId: created.body.attributeId, type: "relation", name: "clearable", value: "   " }
            });
            expect(res.status).toBe(200);

            const attrs = await api.get<AttrRow[]>(`/api/notes/${noteId}/attributes`);
            expect(attrs.body.some((a) => a.name === "clearable")).toBe(false);
        });

        it("400s when the attribute is not owned by the note", async () => {
            const owner = await createTextNote(api, { title: "Attr owner" });
            const other = await createTextNote(api, { title: "Attr other" });
            const attrId = await addLabel(owner.noteId, "foreign", "v");

            const res = await api.put(`/api/notes/${other.noteId}/attribute`, {
                body: { attributeId: attrId, type: "label", name: "foreign", value: "v2" }
            });
            expect(res.status).toBe(400);
        });
    });

    describe("updateNoteAttributes (bulk)", () => {
        it("400s when the note does not exist", async () => {
            const res = await api.put("/api/notes/missingNote123/attributes", { body: [] });
            expect(res.status).toBe(400);
        });

        it("creates, repositions, updates, and deletes attributes to match the payload", async () => {
            const { noteId } = await createTextNote(api);

            // seed two labels
            await api.put(`/api/notes/${noteId}/attributes`, {
                body: [
                    { type: "label", name: "keep", value: "1", isInheritable: false },
                    { type: "label", name: "change", value: "old", isInheritable: false },
                    { type: "label", name: "drop", value: "x", isInheritable: false }
                ]
            });

            // re-send: keep (perfect match, new position), change (value update), add new, drop removed
            const res = await api.put(`/api/notes/${noteId}/attributes`, {
                body: [
                    { type: "label", name: "added", value: "new", isInheritable: false },
                    { type: "label", name: "keep", value: "1", isInheritable: false },
                    { type: "label", name: "change", value: "updated", isInheritable: false }
                ]
            });
            expect(res.status).toBe(204);

            const attrs = await api.get<AttrRow[]>(`/api/notes/${noteId}/attributes`);
            const byName = Object.fromEntries(attrs.body.map((a) => [ a.name, a.value ]));
            expect(byName.keep).toBe("1");
            expect(byName.change).toBe("updated");
            expect(byName.added).toBe("new");
            expect(attrs.body.some((a) => a.name === "drop")).toBe(false);
        });

        it("skips relations whose target note does not exist", async () => {
            const { noteId } = await createTextNote(api);
            const res = await api.put(`/api/notes/${noteId}/attributes`, {
                body: [ { type: "relation", name: "ghost", value: "missingTarget123", isInheritable: false } ]
            });
            expect(res.status).toBe(204);

            const attrs = await api.get<AttrRow[]>(`/api/notes/${noteId}/attributes`);
            expect(attrs.body.some((a) => a.name === "ghost")).toBe(false);
        });
    });
});
