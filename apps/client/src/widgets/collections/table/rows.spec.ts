import { describe, expect, it } from "vitest";

import FAttribute from "../../../entities/fattribute";
import type FNote from "../../../entities/fnote";
import froca from "../../../services/froca";
import noteAttributeCache from "../../../services/note_attribute_cache";
import server from "../../../services/server";
import { randomString } from "../../../services/utils";
import { buildNote } from "../../../test/easy-froca";
import getAttributeDefinitionInformation, { buildRowDefinitions } from "./rows.js";

describe("getAttributeDefinitionInformation", () => {
    it("handles attributes with colons in their names", async () => {
        const note = buildNote({
            title: "Note 1",
            "#label:TEST:TEST1(inheritable)": "promoted,alias=Test1,single,text",
            "#label:Test_Test2(inheritable)": "promoted,alias=Test2,single,text",
            "#label:TEST:Test3(inheritable)": "promoted,alias=test3,single,text",
            "#relation:TEST:TEST4(inheritable)": "promoted,alias=Test4,single",
            "#relation:TEST:TEST5(inheritable)": "promoted,alias=Test5,single",
            "#label:_TEST:TEST:TEST:Test1(inheritable)": "promoted,alias=Test01,single,text"
        });
        const infos = getAttributeDefinitionInformation(note);
        expect(infos).toMatchObject([
            { name: "TEST:TEST1", type: "text" },
            { name: "Test_Test2", type: "text" },
            { name: "TEST:Test3", type: "text" },
            { name: "TEST:TEST4", type: "relation" },
            { name: "TEST:TEST5", type: "relation" },
            { name: "_TEST:TEST:TEST:Test1", type: "text" }
        ]);
    });

    it("holds several values of every kind of attribute, relations included", async () => {
        const note = buildNote({
            title: "Note 1",
            "#label:tags(inheritable)": "promoted,multi,text",
            "#label:due(inheritable)": "promoted,multi,date",
            "#label:site(inheritable)": "promoted,multi,url",
            "#label:status(inheritable)": "promoted,multi,select,options=Todo;Done",
            "#label:tint(inheritable)": "promoted,multi,color",
            "#label:done(inheritable)": "promoted,multi,boolean",
            "#relation:crew(inheritable)": "promoted,multi",
            "#label:owner(inheritable)": "promoted,single,text"
        });

        expect(getAttributeDefinitionInformation(note)).toMatchObject([
            { name: "tags", type: "text", isMulti: true },
            { name: "due", type: "date", isMulti: true },
            { name: "site", type: "url", isMulti: true },
            { name: "status", type: "select", isMulti: true },
            { name: "tint", type: "color", isMulti: true },
            { name: "done", type: "boolean", isMulti: true },
            { name: "crew", type: "relation", isMulti: true },
            { name: "owner", type: "text", isMulti: false }
        ]);
    });
});

describe("buildRowDefinitions", () => {
    it("carries each relation target's title, so a relation column can sort by what it shows", async () => {
        const alpha = buildNote({ title: "Alpha" });
        const beta = buildNote({ title: "Beta" });
        const parent = buildNote({
            title: "Collection",
            "#relation:assignee(inheritable)": "promoted,alias=Assignee,single",
            children: [
                { title: "Task 1", "~assignee": beta.noteId },
                { title: "Task 2", "~assignee": alpha.noteId },
                // A row without the relation sorts as nothing rather than as an id or a crash.
                { title: "Task 3" }
            ]
        });

        const info = getAttributeDefinitionInformation(parent);
        const { definitions } = await buildRowDefinitions(parent, info, false);
        expect(definitions).toMatchObject([
            { title: "Task 1", relations: { assignee: beta.noteId }, relationTitles: { assignee: "Beta" } },
            { title: "Task 2", relations: { assignee: alpha.noteId }, relationTitles: { assignee: "Alpha" } },
            { title: "Task 3", relations: { assignee: null }, relationTitles: { assignee: "" } }
        ]);
    });

    it("holds every target of a multi relation, titled as one string for the sort to read", async () => {
        const alpha = buildNote({ title: "Alpha" });
        const beta = buildNote({ title: "Beta" });
        const parent = buildNote({
            title: "Collection",
            "#relation:crew(inheritable)": "promoted,multi",
            children: [
                { title: "Task 1", "~crew": alpha.noteId },
                // A row without the relation holds an empty set rather than nothing at all.
                { title: "Task 2" }
            ]
        });
        const taskOne = await parent.getChildBranches()[0]?.getNote();
        if (!taskOne) throw new Error("expected the child note to be built");
        // A second target under the same name, which one object literal cannot spell.
        holdRelation(taskOne, "crew", beta.noteId);

        const info = getAttributeDefinitionInformation(parent);
        const { definitions } = await buildRowDefinitions(parent, info, false);
        expect(definitions).toMatchObject([
            {
                title: "Task 1",
                relations: { crew: [ alpha.noteId, beta.noteId ] },
                relationTitles: { crew: "Alpha, Beta" }
            },
            { title: "Task 2", relations: { crew: [] }, relationTitles: { crew: "" } }
        ]);
    });

    it("titles the whole subtree in the one visit, nested rows included", async () => {
        const target = buildNote({ title: "Deep target" });
        const parent = buildNote({
            title: "Collection",
            "#relation:assignee(inheritable)": "promoted,single",
            children: [
                { title: "Task", children: [ { title: "Subtask", "~assignee": target.noteId } ] }
            ]
        });

        const info = getAttributeDefinitionInformation(parent);
        const { definitions, hasSubtree } = await buildRowDefinitions(parent, info, false);

        expect(hasSubtree).toBe(true);
        expect(definitions[0]._children?.[0]).toMatchObject({
            title: "Subtask",
            relationTitles: { assignee: "Deep target" }
        });
    });

    it("has no titles to fill where no row holds a target at all", async () => {
        const parent = buildNote({
            title: "Collection",
            "#relation:assignee(inheritable)": "promoted,single",
            children: [ { title: "Task" } ]
        });

        const info = getAttributeDefinitionInformation(parent);
        const { definitions } = await buildRowDefinitions(parent, info, false);

        // No batch is fetched and nothing is written: an empty map sorts as nothing, same as "".
        expect(definitions[0].relationTitles).toEqual({});
    });

    it("titles a target since deleted as nothing, rather than as its id or a crash", async () => {
        // The target is not in the cache, so the batch asks the server — which no longer has it.
        server.post = (async () => ({ branches: [], notes: [], attributes: [] })) as unknown as typeof server.post;
        const parent = buildNote({
            title: "Collection",
            "#relation:assignee(inheritable)": "promoted,single",
            children: [ { title: "Task", "~assignee": "gonemissing12" } ]
        });

        const info = getAttributeDefinitionInformation(parent);
        const { definitions } = await buildRowDefinitions(parent, info, false);

        expect(definitions[0]).toMatchObject({
            relations: { assignee: "gonemissing12" },
            relationTitles: { assignee: "" }
        });
    });
});

/** Gives the note another relation under a name it already carries, which one literal cannot. */
function holdRelation(note: FNote, name: string, value: string) {
    const attributeId = randomString(12);
    const attribute = new FAttribute(froca, {
        noteId: note.noteId,
        attributeId,
        type: "relation",
        name,
        value,
        position: 100,
        isInheritable: false
    });

    froca.attributes[attributeId] = attribute;
    note.attributes.push(attributeId);
    noteAttributeCache.attributes[note.noteId]?.push(attribute);
}
