import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getContext } from "../services/context.js";
import noteService from "../services/notes.js";
import { getSql } from "../services/sql/index.js";
import { registerVirtualNoteProvider, unregisterVirtualNoteProvider, type VirtualSubtreeItem } from "../services/virtual_notes.js";
import becca from "./becca.js";
import { load } from "./becca_loader.js";
import BAttribute from "./entities/battribute.js";
import BBranch from "./entities/bbranch.js";

const SUBTREE: VirtualSubtreeItem[] = [
    {
        id: "_vtest",
        title: "Virtual root",
        type: "book",
        icon: "bx-cube",
        isExpanded: true,
        children: [
            {
                id: "_vtestPage",
                title: "Virtual page",
                type: "text",
                attributes: [{ type: "label", name: "docName", value: "vtest_page" }]
            },
            {
                id: "_vtestLinked",
                title: "Linked page",
                type: "text",
                // relation to a sibling that is injected *after* this note — exercises the
                // backfill of forward references within a virtual subtree
                attributes: [{ type: "relation", name: "seeAlso", value: "_vtestLast" }]
            },
            { id: "_vtestLast", title: "Last page", type: "text" }
        ]
    }
];

function reloadBecca() {
    getContext().init(() => load());
}

function countRows(table: string, column: string): number {
    return getSql().getValue<number>(`SELECT COUNT(*) FROM ${table} WHERE ${column} LIKE '\\_vtest%' ESCAPE '\\'`);
}

describe("virtual note injection", () => {
    beforeAll(() => {
        registerVirtualNoteProvider({
            namespace: "_vtest",
            parentNoteId: "_hidden",
            getSubtree: () => SUBTREE,
            getContent: (noteId) => (noteId === "_vtestPage" ? "<p>virtual content</p>" : null)
        });
        reloadBecca();
    });

    afterAll(() => {
        unregisterVirtualNoteProvider("_vtest");
        reloadBecca();
    });

    it("builds the subtree in becca with virtual notes, branches and attributes", () => {
        const root = becca.getNoteOrThrow("_vtest");
        expect(root.isVirtual).toBe(true);
        expect(root.title).toBe("Virtual root");
        expect(root.type).toBe("book");
        expect(root.getParentNotes().map((note) => note.noteId)).toEqual(["_hidden"]);
        expect(root.getChildNotes().map((note) => note.noteId)).toEqual(["_vtestPage", "_vtestLinked", "_vtestLast"]);

        // deterministic branch IDs, registered in all becca maps
        const rootBranch = becca.getBranch("_hidden__vtest");
        expect(rootBranch?.isVirtual).toBe(true);
        expect(rootBranch?.isExpanded).toBe(true);
        expect(becca.getBranchFromChildAndParent("_vtestPage", "_vtest")?.isVirtual).toBe(true);

        // the root sorts after the anchor's persisted children
        const siblingPositions = becca.getNoteOrThrow("_hidden")
            .getChildBranches()
            .filter((branch) => branch && branch.noteId !== "_vtest")
            .map((branch) => branch?.notePosition ?? 0);
        expect(rootBranch?.notePosition).toBeGreaterThan(Math.max(...siblingPositions));

        // attributes: explicit ones and the icon-derived label
        const page = becca.getNoteOrThrow("_vtestPage");
        expect(page.getLabelValue("docName")).toBe("vtest_page");
        expect(becca.getNoteOrThrow("_vtest").getLabelValue("iconClass")).toBe("bx bx-cube");
        expect(page.getOwnedAttributes().every((attribute) => attribute.isVirtual)).toBe(true);
    });

    it("persists nothing to the database", () => {
        expect(countRows("notes", "noteId")).toBe(0);
        expect(countRows("branches", "noteId")).toBe(0);
        expect(countRows("attributes", "noteId")).toBe(0);
        expect(getSql().getValue<number>(`SELECT COUNT(*) FROM entity_changes WHERE entityId LIKE '\\_vtest%' ESCAPE '\\'`)).toBe(0);
    });

    it("virtual entities are read-only", () => {
        const note = becca.getNoteOrThrow("_vtestPage");
        expect(() => getContext().init(() => note.save())).toThrow(/read-only/);
        expect(() => getContext().init(() => note.setContent("<p>nope</p>"))).toThrow(/read-only/);
        expect(() => getContext().init(() => note.markAsDeleted())).toThrow(/read-only/);

        const branch = becca.getBranch("_hidden__vtest");
        expect(branch).toBeTruthy();
        expect(() => getContext().init(() => branch?.markAsDeleted())).toThrow(/read-only/);

        const attribute = note.getOwnedAttributes()[0];
        expect(() => getContext().init(() => attribute.save())).toThrow(/read-only/);
    });

    it("rejects persisting branches or attributes that reference virtual notes", () => {
        const realNote = getContext().init(() =>
            noteService.createNewNote({
                parentNoteId: "root",
                title: "real note for virtual tests",
                content: "",
                type: "text"
            }).note
        );

        // cloning a virtual note out into the persisted tree
        expect(() => getContext().init(() =>
            new BBranch({ noteId: "_vtestPage", parentNoteId: realNote.noteId, isExpanded: false }).save()
        )).toThrow(/cloned or moved/);

        // placing a persisted note under a virtual parent
        expect(() => getContext().init(() =>
            new BBranch({ noteId: realNote.noteId, parentNoteId: "_vtest", isExpanded: false }).save()
        )).toThrow(/receive children/);

        // annotating a virtual note
        expect(() => getContext().init(() =>
            new BAttribute({ noteId: "_vtest", type: "label", name: "myLabel", value: "x" }).save()
        )).toThrow(/virtual/);
    });

    it("serves content from the provider, defaulting to empty", () => {
        expect(becca.getNoteOrThrow("_vtestPage").getContent()).toBe("<p>virtual content</p>");
        expect(becca.getNoteOrThrow("_vtest").getContent()).toBe("");
    });

    it("resolves relations targeting virtual notes across reloads (backfill)", () => {
        const realNote = getContext().init(() =>
            noteService.createNewNote({
                parentNoteId: "root",
                title: "note linking into virtual subtree",
                content: "",
                type: "text"
            }).note
        );
        getContext().init(() =>
            new BAttribute({ noteId: realNote.noteId, type: "relation", name: "linksTo", value: "_vtestLinked" }).save()
        );

        // On reload the persisted relation loads before the virtual notes exist; the
        // injection backfill must re-establish the target-relation backlink.
        reloadBecca();

        const target = becca.getNoteOrThrow("_vtestLinked");
        expect(target.isVirtual).toBe(true);
        expect(target.targetRelations.some((rel) => rel.name === "linksTo" && rel.noteId === realNote.noteId)).toBe(true);

        // ...including forward references between virtual notes themselves
        const last = becca.getNoteOrThrow("_vtestLast");
        expect(last.targetRelations.some((rel) => rel.name === "seeAlso" && rel.noteId === "_vtestLinked")).toBe(true);
    });

    it("skips providers whose anchor note does not exist, without creating skeletons", () => {
        registerVirtualNoteProvider({
            namespace: "_vghost",
            parentNoteId: "_doesNotExist",
            getSubtree: () => [{ id: "_vghost", title: "Ghost", type: "text" }]
        });

        try {
            reloadBecca();
            expect(becca.getNote("_vghost")).toBeNull();
            expect(becca.getNote("_doesNotExist")).toBeNull();
        } finally {
            unregisterVirtualNoteProvider("_vghost");
        }
    });

    it("skips a provider whose subtree strays outside its namespace, leaving others intact", () => {
        registerVirtualNoteProvider({
            namespace: "_vbad",
            parentNoteId: "_hidden",
            getSubtree: () => [{
                id: "_vbad",
                title: "Bad",
                type: "text",
                children: [{ id: "_outsider", title: "Outside the namespace", type: "text" }]
            }]
        });

        try {
            reloadBecca();
            // validation runs before injection, so nothing of the bad provider materializes
            expect(becca.getNote("_vbad")).toBeNull();
            expect(becca.getNote("_outsider")).toBeNull();
            // and the healthy provider is unaffected
            expect(becca.getNote("_vtest")?.isVirtual).toBe(true);
        } finally {
            unregisterVirtualNoteProvider("_vbad");
        }
    });
});
