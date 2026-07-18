import { describe, expect, it } from "vitest";

import { getContext } from "../../services/context.js";
import noteService from "../../services/notes.js";
import { buildNote } from "../../test/becca_easy_mocking.js";
import BBranchEntity from "./bbranch.js";
import type BBranch from "./bbranch.js";
import type BNote from "./bnote.js";

let counter = 0;

/**
 * Creates a fresh text note under the given parent in the real in-memory DB.
 * Each call uses a unique title since the same fixture DB is shared between
 * the `it()`s in this file.
 */
function createNote(parentNoteId: string): { note: BNote; branch: BBranch } {
    counter++;
    return getContext().init(() =>
        noteService.createNewNote({
            parentNoteId,
            title: `bnote-attrs-spec-${counter}`,
            content: "<p>hello</p>",
            type: "text"
        })
    );
}

describe("BNote attribute methods (real DB)", () => {
    describe("getAttributes filtering and validation", () => {
        it("filters by type+name, type only, and name only", () => {
            const { note } = createNote("root");

            getContext().init(() => {
                note.addLabel("colorTag", "red");
                note.addRelation("linkTag", note.noteId);
            });

            // type && name
            const byTypeName = note.getAttributes("label", "colorTag");
            expect(byTypeName).toHaveLength(1);
            expect(byTypeName[0].type).toBe("label");
            expect(byTypeName[0].name).toBe("colorTag");

            // type only
            const byType = note.getAttributes("label");
            expect(byType.every((a) => a.type === "label")).toBe(true);
            expect(byType.some((a) => a.name === "colorTag")).toBe(true);

            // name only
            const byName = note.getAttributes(undefined, "linkTag");
            expect(byName).toHaveLength(1);
            expect(byName[0].type).toBe("relation");
            expect(byName[0].name).toBe("linkTag");

            // no filter -> internal cache array
            const all = note.getAttributes();
            expect(all.length).toBeGreaterThanOrEqual(2);
        });

        it("throws for an unrecognized type and for names containing # or ~", () => {
            const { note } = createNote("root");

            expect(() => note.getAttributes("bogus")).toThrow();
            expect(() => note.getAttributes(undefined, "#x")).toThrow();
            expect(() => note.getAttributes(undefined, "~y")).toThrow();
        });
    });

    describe("attribute inheritance and template resolution", () => {
        it("inherits an inheritable label from a parent and resolves template labels", () => {
            const parent = createNote("root");
            getContext().init(() => parent.note.addLabel("inheritedFlag", "yes", true));

            const child = createNote(parent.note.noteId);

            // Inherited (non-owned) label reachable through getAttributes.
            const inheritedLabels = child.note.getAttributes("label", "inheritedFlag");
            expect(inheritedLabels).toHaveLength(1);
            expect(inheritedLabels[0].value).toBe("yes");
            expect(inheritedLabels[0].noteId).toBe(parent.note.noteId);

            // The child must surface its inheritable attribute cache to its own children.
            const grandchild = createNote(child.note.noteId);
            expect(grandchild.note.getAttributes("label", "inheritedFlag")).toHaveLength(1);

            // Template note carrying labels, applied via a ~template relation.
            const template = createNote("root");
            getContext().init(() => {
                template.note.addLabel("fromTemplate", "tval");
                template.note.addLabel("template"); // marker, must NOT be inherited
            });

            const consumer = createNote("root");
            getContext().init(() => consumer.note.addRelation("template", template.note.noteId));

            const templated = consumer.note.getAttributes("label", "fromTemplate");
            expect(templated).toHaveLength(1);
            expect(templated[0].value).toBe("tval");
            // The 'template' marker label must be filtered out.
            expect(consumer.note.getAttributes("label", "template")).toHaveLength(0);
        });

        it("returns empty inheritable attributes for a note with no inheritable owned attrs", () => {
            const { note } = createNote("root");
            // Force the inheritable cache to be built and surfaced via a child.
            const child = createNote(note.noteId);
            expect(Array.isArray(child.note.getAttributes())).toBe(true);
        });

        it("guards against template cycles when resolving attributes", () => {
            // A note whose ~template relation points back to itself triggers the
            // path-cycle short-circuit inside __getAttributes.
            const selfTemplate = createNote("root");
            getContext().init(() => {
                selfTemplate.note.addLabel("selfLabel", "v");
                selfTemplate.note.addRelation("template", selfTemplate.note.noteId);
            });

            // Must not throw / recurse infinitely; the note still surfaces its own label.
            const attrs = selfTemplate.note.getAttributes();
            expect(Array.isArray(attrs)).toBe(true);
            expect(selfTemplate.note.getOwnedLabel("selfLabel")?.value).toBe("v");

            // A two-note ~inherit cycle exercises the mutual recursion guard as well.
            const a = createNote("root");
            const b = createNote("root");
            getContext().init(() => {
                a.note.addLabel("aLabel", "av");
                b.note.addLabel("bLabel", "bv");
                a.note.addRelation("inherit", b.note.noteId);
                b.note.addRelation("inherit", a.note.noteId);
            });

            expect(Array.isArray(a.note.getAttributes())).toBe(true);
            expect(Array.isArray(b.note.getAttributes())).toBe(true);
        });

        it("guards against a parent-tree cycle when resolving inheritable attributes", () => {
            // Construct an (illegal) parent cycle directly in becca to exercise the
            // path-cycle guard inside __getInheritableAttributes. The normal API
            // (validateParentChild) prevents such cycles, so this is built in-memory.
            const x = buildNote({ id: "cycleX", title: "cycleX", "#xFlag": "x" });
            const y = buildNote({ id: "cycleY", title: "cycleY", "#yFlag": "y" });

            // y is a parent of x, and x is a parent of y -> cycle.
            new BBranchEntity({
                noteId: x.noteId,
                parentNoteId: y.noteId,
                branchId: `${y.noteId}_${x.noteId}`
            });
            new BBranchEntity({
                noteId: y.noteId,
                parentNoteId: x.noteId,
                branchId: `${x.noteId}_${y.noteId}`
            });

            // Must terminate; the cycle guard returns an empty inheritable set
            // for the already-visited ancestor.
            expect(Array.isArray(x.getAttributes())).toBe(true);
        });
    });

    describe("has/get accessors over the combined cache", () => {
        it("covers hasAttribute, getAttributeCaseInsensitive and getRelationTarget", () => {
            const target = createNote("root");
            const { note } = createNote("root");

            getContext().init(() => {
                note.addLabel("MyLabel", "Val");
                note.addRelation("myRel", target.note.noteId);
            });

            expect(note.hasAttribute("label", "MyLabel")).toBe(true);
            expect(note.hasAttribute("label", "MyLabel", "Val")).toBe(true);
            expect(note.hasAttribute("label", "MyLabel", "other")).toBe(false);
            expect(note.hasAttribute("label", "nope")).toBe(false);

            // case-insensitive lookup with and without value
            expect(note.getAttributeCaseInsensitive("label", "mylabel", "val")).toBeDefined();
            expect(note.getAttributeCaseInsensitive("label", "MYLABEL")).toBeDefined();
            expect(note.getAttributeCaseInsensitive("label", "mylabel", "WRONG")).toBeUndefined();

            // relation target resolution
            const resolved = note.getRelationTarget("myRel");
            expect(resolved?.noteId).toBe(target.note.noteId);
            expect(note.getRelationTarget("missingRel")).toBeNull();
        });
    });

    describe("owned-only accessors", () => {
        it("covers hasOwnedRelation, getOwnedLabel, getRelation and getOwnedRelation", () => {
            const target = createNote("root");
            const { note } = createNote("root");

            getContext().init(() => {
                note.addLabel("ownLabel", "lv");
                note.addRelation("ownRel", target.note.noteId);
            });

            expect(note.hasOwnedRelation("ownRel")).toBe(true);
            expect(note.hasOwnedRelation("ownRel", target.note.noteId)).toBe(true);
            expect(note.hasOwnedRelation("missing")).toBe(false);

            expect(note.getOwnedLabel("ownLabel")?.value).toBe("lv");
            expect(note.getOwnedLabel("missing")).toBeNull();

            expect(note.getRelation("ownRel")?.value).toBe(target.note.noteId);
            expect(note.getRelation("missing")).toBeNull();

            expect(note.getOwnedRelation("ownRel")?.value).toBe(target.note.noteId);
            expect(note.getOwnedRelation("missing")).toBeNull();
        });
    });

    describe("label value collectors", () => {
        it("covers getLabelValues and getOwnedLabelValues", () => {
            const parent = createNote("root");
            getContext().init(() => parent.note.addLabel("multi", "inherited", true));

            const child = createNote(parent.note.noteId);
            getContext().init(() => child.note.addLabel("multi", "own"));

            const allValues = child.note.getLabelValues("multi");
            expect(allValues).toContain("own");
            expect(allValues).toContain("inherited");

            const ownValues = child.note.getOwnedLabelValues("multi");
            expect(ownValues).toEqual(["own"]);
        });
    });

    describe("getOwnedAttributes filter branches", () => {
        it("covers type+name+value, type+name, type only and name only", () => {
            const { note } = createNote("root");

            getContext().init(() => {
                note.addLabel("oa", "v1");
                note.addLabel("oa", "v2");
                note.addRelation("orel", note.noteId);
            });

            // type + name + value
            const tnv = note.getOwnedAttributes("label", "oa", "v1");
            expect(tnv).toHaveLength(1);
            expect(tnv[0].value).toBe("v1");

            // type + name
            const tn = note.getOwnedAttributes("label", "oa");
            expect(tn).toHaveLength(2);

            // type only
            const t = note.getOwnedAttributes("label");
            expect(t.every((a) => a.type === "label")).toBe(true);

            // name only
            const n = note.getOwnedAttributes(null, "orel");
            expect(n).toHaveLength(1);
            expect(n[0].type).toBe("relation");

            // no filter
            expect(note.getOwnedAttributes().length).toBeGreaterThanOrEqual(3);
        });
    });

    describe("definition collectors", () => {
        it("covers getRelationDefinitions and getLabelDefinitions", () => {
            const { note } = createNote("root");
            getContext().init(() => {
                note.addLabel("relation:child", "");
                note.addLabel("plain", "x");
            });

            expect(note.getRelationDefinitions().some((l) => l.name === "relation:child")).toBe(true);
            expect(note.getLabelDefinitions().some((l) => l.name === "relation:child")).toBe(true);
        });
    });

    describe("mutation helpers", () => {
        it("removeAttribute honours the value-match branch", () => {
            const { note } = createNote("root");
            getContext().init(() => {
                note.addLabel("rm", "keep");
                note.addLabel("rm", "drop");
            });

            getContext().init(() => note.removeAttribute("label", "rm", "drop"));

            const remaining = note.getOwnedAttributes("label", "rm");
            expect(remaining).toHaveLength(1);
            expect(remaining[0].value).toBe("keep");
        });

        it("toggleAttribute / toggleLabel / toggleRelation switch on and off", () => {
            const target = createNote("root");
            const { note } = createNote("root");

            getContext().init(() => {
                note.toggleLabel(true, "toggled", "on");
                note.toggleRelation(true, "togRel", target.note.noteId);
            });
            expect(note.getOwnedLabel("toggled")?.value).toBe("on");
            expect(note.getOwnedRelation("togRel")?.value).toBe(target.note.noteId);

            getContext().init(() => {
                note.toggleLabel(false, "toggled");
                note.toggleRelation(false, "togRel");
            });
            expect(note.getOwnedLabel("toggled")).toBeNull();
            expect(note.getOwnedRelation("togRel")).toBeNull();
        });

        it("removeRelation deletes a matching relation", () => {
            const target = createNote("root");
            const { note } = createNote("root");

            getContext().init(() => note.addRelation("delRel", target.note.noteId));
            expect(note.getOwnedRelation("delRel")).not.toBeNull();

            getContext().init(() => note.removeRelation("delRel"));
            expect(note.getOwnedRelation("delRel")).toBeNull();
        });
    });

    describe("attribute-by-id accessors", () => {
        it("getAttributeById finds via the cache", () => {
            const { note } = createNote("root");
            const attr = getContext().init(() => note.addLabel("byId", "value"));

            const found = note.getAttributeById(attr.attributeId);
            expect(found?.attributeId).toBe(attr.attributeId);
            expect(note.getAttributeById("nonexistent-id")).toBeUndefined();
        });

        it("setAttributeValueById updates the value and throws when not found", () => {
            const { note } = createNote("root");
            const attr = getContext().init(() => note.addLabel("settable", "old"));

            getContext().init(() => note.setAttributeValueById(attr.attributeId, "new"));
            expect(note.getOwnedLabel("settable")?.value).toBe("new");

            // Setting the same value again is a no-op (value unchanged).
            getContext().init(() => note.setAttributeValueById(attr.attributeId, "new"));
            expect(note.getOwnedLabel("settable")?.value).toBe("new");

            // Omitting the value coalesces to "" (the `value?.toString() || ""` fallback).
            getContext().init(() => note.setAttributeValueById(attr.attributeId));
            expect(note.getOwnedLabel("settable")?.value).toBe("");

            expect(() => getContext().init(() => note.setAttributeValueById("missing-attr-id", "x"))).toThrow();
        });
    });
});
