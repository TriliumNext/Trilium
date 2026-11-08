import { describe, expect, it, vi } from "vitest";

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

    it("carries each note's creation and modification dates as ISO strings, nested rows included", async () => {
        const parent = buildNote({
            title: "Collection",
            children: [
                { title: "Task", children: [ { title: "Subtask" } ] },
                { title: "Unknown to the server" }
            ]
        });
        const [ task, unknown ] = await Promise.all(parent.getChildBranches().map((branch) => branch.getNote()));
        const subtask = await task?.getChildBranches()[0]?.getNote();
        if (!task || !subtask || !unknown) throw new Error("expected the child notes to be built");

        const post = vi.spyOn(server, "post").mockResolvedValue({
            [task.noteId]: {
                utcDateCreated: "2026-01-05 09:30:00.000Z",
                utcDateModified: "2026-03-01 12:00:00.000Z"
            },
            [subtask.noteId]: {
                utcDateCreated: "2026-02-10 08:00:00.000Z",
                utcDateModified: "2026-02-11 08:00:00.000Z"
            }
        });

        const { definitions } = await buildRowDefinitions(parent, [], false);

        // The whole tree in one request rather than one per level.
        expect(post.mock.calls.filter(([ url ]) => url === "notes/metadata")).toHaveLength(1);
        expect(definitions).toMatchObject([
            {
                title: "Task",
                dateCreated: "2026-01-05T09:30:00.000Z",
                dateModified: "2026-03-01T12:00:00.000Z",
                _children: [ {
                    title: "Subtask",
                    dateCreated: "2026-02-10T08:00:00.000Z",
                    dateModified: "2026-02-11T08:00:00.000Z"
                } ]
            },
            { title: "Unknown to the server", dateCreated: undefined, dateModified: undefined }
        ]);
        post.mockRestore();
    });

    it("loads the notes it is missing one level at a time, not one note at a time", async () => {
        const parent = buildNote({
            title: "Collection",
            children: [ "A", "B", "C" ].map((title) => ({
                title,
                children: [ 1, 2 ].map((n) => ({ title: `${title}${n}`, children: [ { title: `${title}${n}.x` } ] }))
            }))
        });
        // Everything below the direct children is known only by its branch, as after `GET /api/tree`.
        const unloaded = new Map<string, FNote>();
        const childrenOf = (note: FNote) => froca.getNotesFromCache(note.children);
        for (const child of childrenOf(parent)) {
            for (const grandchild of childrenOf(child)) {
                for (const note of [ grandchild, ...childrenOf(grandchild) ]) {
                    unloaded.set(note.noteId, note);
                    delete froca.notes[note.noteId];
                }
            }
        }
        const post = vi.spyOn(server, "post").mockImplementation((async (url: string, data: { noteIds: string[] }) => {
            if (url !== "tree/load") return {};
            for (const noteId of data.noteIds) {
                const note = unloaded.get(noteId);
                if (note) froca.notes[noteId] = note;
            }
            return { notes: [], branches: [], attributes: [] };
        }) as unknown as typeof server.post);

        const { definitions } = await buildRowDefinitions(parent, [], false);

        expect(post.mock.calls.filter(([ url ]) => url === "tree/load").map(([ , data ]) => (data as { noteIds: string[] }).noteIds.length))
            .toEqual([ 6, 6 ]);
        expect(definitions[2]._children?.[1]._children?.[0]).toMatchObject({ title: "C2.x" });
        post.mockRestore();
    });

    it("leaves out the hidden subtree, as the note tree does under root", async () => {
        const parent = buildNote({
            title: "Root",
            children: [
                { title: "Task" },
                { id: "_hidden", title: "Hidden Notes", children: [ { title: "Help" } ] }
            ]
        });
        const hiddenChild = froca.getNoteFromCache("_hidden")?.children[0];
        if (!hiddenChild) throw new Error("expected the hidden subtree to be built");
        delete froca.notes[hiddenChild];
        const post = vi.spyOn(server, "post").mockResolvedValue({});

        const { definitions, hasSubtree } = await buildRowDefinitions(parent, [], false);

        expect(definitions.map((def) => def.title)).toEqual([ "Task" ]);
        expect(hasSubtree).toBe(false);
        expect(post.mock.calls.filter(([ url ]) => url === "tree/load")).toHaveLength(0);
        post.mockRestore();
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
