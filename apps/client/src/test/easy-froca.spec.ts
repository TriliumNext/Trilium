import { describe, expect, it } from "vitest";

import froca from "../services/froca.js";
import { buildNote, buildNotes } from "./easy-froca.js";

describe("buildNote", () => {
    it("registers the note with its type, content and blob in the froca", async () => {
        const note = buildNote({ title: "Code", type: "code", mime: "text/plain", content: "hello" });

        expect(froca.getNoteFromCache(note.noteId)).toBe(note);
        expect(note.type).toBe("code");
        expect(note.mime).toBe("text/plain");
        await expect(note.getContent()).resolves.toBe("hello");
        await expect(note.getBlob().then((blob) => blob?.content)).resolves.toBe("hello");
    });

    it("links children to their parent in both directions, with branches", () => {
        const parent = buildNote({ title: "Parent", children: [{ id: "kid", title: "Kid" }] });
        const child = froca.getNoteFromCache("kid");

        expect(parent.children).toEqual(["kid"]);
        expect(child?.parents).toEqual([parent.noteId]);
        expect(froca.getBranch(`${parent.noteId}_kid`)?.parentNoteId).toBe(parent.noteId);
    });

    it("creates owned labels via # and relations via ~", () => {
        const note = buildNote({ title: "N", "#color": "red", "~template": "tpl" });

        expect(note.getLabelValue("color")).toBe("red");
        expect(note.getOwnedRelations("template").map((attr) => attr.value)).toEqual(["tpl"]);
    });

    it("creates one attribute per element when the value is an array, in order", () => {
        const note = buildNote({ title: "N", "~worksFor": ["acme", "globex"], "#tag": ["a", "b"] });

        expect(note.getRelations("worksFor").map((attr) => attr.value)).toEqual(["acme", "globex"]);
        expect(note.getLabels("tag").map((attr) => attr.value)).toEqual(["a", "b"]);
    });

    it("spreads an (inheritable) attribute to every descendant, but keeps it off the owned set", () => {
        buildNote({
            id: "grandparent",
            title: "Grandparent",
            "#shared(inheritable)": "x",
            children: [{
                id: "parent-with-attrs",
                title: "Parent",
                // The cached attribute list is seeded from these, which is what would hide the
                // inherited attribute without the spreading step.
                "#own": "y",
                children: [{ id: "grandchild", title: "Grandchild", "#own": "z" }]
            }]
        });

        for (const noteId of ["parent-with-attrs", "grandchild"]) {
            const note = froca.getNoteFromCache(noteId);
            expect(note?.getLabelValue("shared"), noteId).toBe("x");
            expect(note?.getOwnedLabelValue("shared"), noteId).toBeNull();
        }
    });

    it("does not leak inheritable attributes to notes outside the subtree", () => {
        buildNotes([
            { id: "tree-a", title: "A", "#leaky(inheritable)": "x", children: [{ id: "a-kid", title: "AK" }] },
            { id: "tree-b", title: "B", children: [{ id: "b-kid", title: "BK" }] }
        ]);

        expect(froca.getNoteFromCache("a-kid")?.getLabelValue("leaky")).toBe("x");
        expect(froca.getNoteFromCache("tree-b")?.getLabelValue("leaky")).toBeNull();
        expect(froca.getNoteFromCache("b-kid")?.getLabelValue("leaky")).toBeNull();
    });
});
