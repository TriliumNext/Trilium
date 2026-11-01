import { describe, expect, it } from "vitest";

import { getContext } from "../../services/context.js";
import noteService from "../../services/notes.js";
import { randomString } from "../../services/utils/index.js";
import { getBecca } from "../becca.js";
import BAttribute from "./battribute.js";
import BNote from "./bnote.js";

let counter = 0;

/** Creates a fresh text note under root in the real in-memory DB. */
function createNote(): BNote {
    counter++;
    return getContext().init(() =>
        noteService.createNewNote({
            parentNoteId: "root",
            title: `battribute-spec-${counter}`,
            content: "<p>hello</p>",
            type: "text"
        }).note
    );
}

describe("BAttribute", () => {
    describe("init", () => {
        it("creates a skeleton note when the owner noteId is not yet in becca", () => {
            const skeletonNoteId = `skeleton-${randomString(8)}`;
            expect(skeletonNoteId in getBecca().notes).toBe(false);

            const attr = new BAttribute({
                attributeId: `attr-${randomString(8)}`,
                noteId: skeletonNoteId,
                type: "label",
                name: "x",
                value: "",
                position: 0,
                isInheritable: false
            });

            const skeleton = getBecca().getNote(skeletonNoteId);
            expect(skeleton).not.toBeNull();
            expect(skeleton?.ownedAttributes).toContain(attr);
        });

        it("registers a relation against its target note's targetRelations", () => {
            const owner = createNote();
            const target = createNote();

            const attr = new BAttribute({
                attributeId: `attr-${randomString(8)}`,
                noteId: owner.noteId,
                type: "relation",
                name: "myrel",
                value: target.noteId,
                position: 0,
                isInheritable: false
            });

            expect(target.targetRelations).toContain(attr);
        });
    });

    describe("validate", () => {
        it("throws on an invalid attribute type", () => {
            const owner = createNote();
            const attr = new BAttribute({
                attributeId: `attr-${randomString(8)}`,
                noteId: owner.noteId,
                type: "bogus" as never,
                name: "x",
                value: "",
                position: 0,
                isInheritable: false
            });

            expect(() => attr.validate()).toThrow();
        });

        it("throws on an empty name", () => {
            const owner = createNote();
            const attr = new BAttribute({
                attributeId: `attr-${randomString(8)}`,
                noteId: owner.noteId,
                type: "label",
                name: "   ",
                value: "",
                position: 0,
                isInheritable: false
            });

            expect(() => attr.validate()).toThrow();
        });

        it("throws when a relation targets a non-existent note", () => {
            const owner = createNote();
            const attr = new BAttribute({
                attributeId: `attr-${randomString(8)}`,
                noteId: owner.noteId,
                type: "relation",
                name: "myrel",
                value: `does-not-exist-${randomString(8)}`,
                position: 0,
                isInheritable: false
            });

            expect(() => attr.validate()).toThrow();
        });

        it("passes for a valid label", () => {
            const owner = createNote();
            const attr = new BAttribute({
                attributeId: `attr-${randomString(8)}`,
                noteId: owner.noteId,
                type: "label",
                name: "valid",
                value: "v",
                position: 0,
                isInheritable: false
            });

            expect(() => attr.validate()).not.toThrow();
        });
    });

    describe("isAffectingSubtree", () => {
        it("is true for an inheritable label", () => {
            const owner = createNote();
            const attr = new BAttribute({
                attributeId: `attr-${randomString(8)}`,
                noteId: owner.noteId,
                type: "label",
                name: "inh",
                value: "",
                position: 0,
                isInheritable: true
            });

            expect(attr.isAffectingSubtree).toBe(true);
        });

        it("is true for a template relation", () => {
            const owner = createNote();
            const target = createNote();
            const attr = new BAttribute({
                attributeId: `attr-${randomString(8)}`,
                noteId: owner.noteId,
                type: "relation",
                name: "template",
                value: target.noteId,
                position: 0,
                isInheritable: false
            });

            expect(attr.isAffectingSubtree).toBe(true);
        });

        it("is false for a plain non-inheritable label", () => {
            const owner = createNote();
            const attr = new BAttribute({
                attributeId: `attr-${randomString(8)}`,
                noteId: owner.noteId,
                type: "label",
                name: "plain",
                value: "",
                position: 0,
                isInheritable: false
            });

            expect(attr.isAffectingSubtree).toBe(false);
        });
    });

    describe("targetNoteId", () => {
        it("returns the value for a relation", () => {
            const owner = createNote();
            const target = createNote();
            const attr = new BAttribute({
                attributeId: `attr-${randomString(8)}`,
                noteId: owner.noteId,
                type: "relation",
                name: "myrel",
                value: target.noteId,
                position: 0,
                isInheritable: false
            });

            expect(attr.targetNoteId).toBe(target.noteId);
        });

        it("returns undefined for a label", () => {
            const owner = createNote();
            const attr = new BAttribute({
                attributeId: `attr-${randomString(8)}`,
                noteId: owner.noteId,
                type: "label",
                name: "lbl",
                value: "v",
                position: 0,
                isInheritable: false
            });

            expect(attr.targetNoteId).toBeUndefined();
        });
    });

    describe("isAutoLink", () => {
        it("is true for an internalBookmark label", () => {
            const owner = createNote();
            const attr = new BAttribute({
                attributeId: `attr-${randomString(8)}`,
                noteId: owner.noteId,
                type: "label",
                name: "internalBookmark",
                value: "",
                position: 0,
                isInheritable: false
            });

            expect(attr.isAutoLink()).toBe(true);
        });

        it("is true for an internalLink relation", () => {
            const owner = createNote();
            const target = createNote();
            const attr = new BAttribute({
                attributeId: `attr-${randomString(8)}`,
                noteId: owner.noteId,
                type: "relation",
                name: "internalLink",
                value: target.noteId,
                position: 0,
                isInheritable: false
            });

            expect(attr.isAutoLink()).toBe(true);
        });

        it("is false for a plain label", () => {
            const owner = createNote();
            const attr = new BAttribute({
                attributeId: `attr-${randomString(8)}`,
                noteId: owner.noteId,
                type: "label",
                name: "plain",
                value: "",
                position: 0,
                isInheritable: false
            });

            expect(attr.isAutoLink()).toBe(false);
        });

        it("is false when the type is neither label nor relation", () => {
            const owner = createNote();
            const attr = new BAttribute({
                attributeId: `attr-${randomString(8)}`,
                noteId: owner.noteId,
                type: "label",
                name: "plain",
                value: "",
                position: 0,
                isInheritable: false
            });

            // Force an out-of-band type so neither the relation nor the label
            // branch matches, hitting the final fallthrough return.
            attr.type = "bogus" as never;

            expect(attr.isAutoLink()).toBe(false);
        });
    });

    describe("getNote", () => {
        it("returns the owner note when present", () => {
            const owner = createNote();
            const attr = new BAttribute({
                attributeId: `attr-${randomString(8)}`,
                noteId: owner.noteId,
                type: "label",
                name: "lbl",
                value: "",
                position: 0,
                isInheritable: false
            });

            expect(attr.getNote().noteId).toBe(owner.noteId);
        });

        it("throws when the owner note is missing from becca", () => {
            const owner = createNote();
            const attr = new BAttribute({
                attributeId: `attr-${randomString(8)}`,
                noteId: owner.noteId,
                type: "label",
                name: "lbl",
                value: "",
                position: 0,
                isInheritable: false
            });

            // Point the attribute at a noteId that does not exist in getBecca().
            attr.noteId = `gone-${randomString(8)}`;

            expect(() => attr.getNote()).toThrow();
        });
    });

    describe("getTargetNote", () => {
        it("throws when the attribute is not a relation", () => {
            const owner = createNote();
            const attr = new BAttribute({
                attributeId: `attr-${randomString(8)}`,
                noteId: owner.noteId,
                type: "label",
                name: "lbl",
                value: "",
                position: 0,
                isInheritable: false
            });

            expect(() => attr.getTargetNote()).toThrow();
        });

        it("returns null for a relation with an empty value", () => {
            const owner = createNote();
            const attr = new BAttribute({
                attributeId: `attr-${randomString(8)}`,
                noteId: owner.noteId,
                type: "relation",
                name: "myrel",
                value: "",
                position: 0,
                isInheritable: false
            });

            expect(attr.getTargetNote()).toBeNull();
        });

        it("returns the target note for a relation with a value", () => {
            const owner = createNote();
            const target = createNote();
            const attr = new BAttribute({
                attributeId: `attr-${randomString(8)}`,
                noteId: owner.noteId,
                type: "relation",
                name: "myrel",
                value: target.noteId,
                position: 0,
                isInheritable: false
            });

            expect(attr.getTargetNote()?.noteId).toBe(target.noteId);
        });
    });

    describe("isDefinition / getDefinition / getDefinedName", () => {
        it("recognises a label-definition and parses its defined name and definition", () => {
            const owner = createNote();
            const attr = new BAttribute({
                attributeId: `attr-${randomString(8)}`,
                noteId: owner.noteId,
                type: "label",
                name: "label:foo",
                value: "promoted,single,text",
                position: 0,
                isInheritable: false
            });

            expect(attr.isDefinition()).toBe(true);
            expect(attr.getDefinedName()).toBe("foo");

            const def = attr.getDefinition();
            expect(def.isPromoted).toBe(true);
            expect(def.multiplicity).toBe("single");
            expect(def.labelType).toBe("text");
        });

        it("recognises a relation-definition and parses its defined name", () => {
            const owner = createNote();
            const attr = new BAttribute({
                attributeId: `attr-${randomString(8)}`,
                noteId: owner.noteId,
                type: "label",
                name: "relation:bar",
                value: "",
                position: 0,
                isInheritable: false
            });

            expect(attr.isDefinition()).toBe(true);
            expect(attr.getDefinedName()).toBe("bar");
        });

        it("treats a plain label as not a definition and leaves the name unchanged", () => {
            const owner = createNote();
            const attr = new BAttribute({
                attributeId: `attr-${randomString(8)}`,
                noteId: owner.noteId,
                type: "label",
                name: "plain",
                value: "",
                position: 0,
                isInheritable: false
            });

            expect(attr.isDefinition()).toBe(false);
            expect(attr.getDefinedName()).toBe("plain");
        });
    });
});
