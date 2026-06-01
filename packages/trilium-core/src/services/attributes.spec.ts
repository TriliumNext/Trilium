import type { AttributeRow } from "@triliumnext/commons";
import { beforeAll, describe, expect, it } from "vitest";

import becca from "../becca/becca.js";
import { init as clsInit } from "./context.js";
import noteService from "./notes.js";
import attributeService from "./attributes.js";

const {
    getNotesWithLabel,
    getNoteWithLabel,
    createLabel,
    createRelation,
    createAttribute,
    getAttributeNames,
    isAttributeType,
    isAttributeDangerous
} = attributeService;

/** Creates a fresh text note under root and returns its id (inside a CLS context). */
function makeNote(title: string): string {
    return clsInit(() =>
        noteService.createNewNote({
            parentNoteId: "root",
            title,
            content: "",
            type: "text"
        }).note.noteId
    );
}

describe("attributes service", () => {
    beforeAll(() => {
        // The in-memory fixture DB and initializeCore are booted by the
        // server suite setup (apps/server/spec/setup.ts), through which
        // co-located trilium-core specs run.
    });

    describe("isAttributeType (pure)", () => {
        it("recognizes only label and relation as attribute types", () => {
            expect(isAttributeType("label")).toBe(true);
            expect(isAttributeType("relation")).toBe(true);
            expect(isAttributeType("definition")).toBe(false);
            expect(isAttributeType("")).toBe(false);
            expect(isAttributeType("Label")).toBe(false); // case-sensitive
        });
    });

    describe("isAttributeDangerous (pure)", () => {
        it("flags built-in dangerous attributes and ignores the type/name combination", () => {
            // `run` is a dangerous label, `widget` is dangerous for both types.
            expect(isAttributeDangerous("label", "run")).toBe(true);
            expect(isAttributeDangerous("label", "widget")).toBe(true);
            expect(isAttributeDangerous("relation", "widget")).toBe(true);
            // `template` exists as both label and relation but is never dangerous.
            expect(isAttributeDangerous("label", "template")).toBe(false);
            expect(isAttributeDangerous("relation", "template")).toBe(false);
            // `run` is a label, not a relation, so the relation lookup misses.
            expect(isAttributeDangerous("relation", "run")).toBe(false);
        });

        it("matches case-insensitively and trims whitespace from the name", () => {
            expect(isAttributeDangerous("label", "RUN")).toBe(true);
            expect(isAttributeDangerous("label", "  run  ")).toBe(true);
            expect(isAttributeDangerous("label", "  WiDgEt ")).toBe(true);
        });

        it("returns false for unknown names and unknown types", () => {
            expect(isAttributeDangerous("label", "definitelyNotABuiltin")).toBe(false);
            expect(isAttributeDangerous("bogusType", "run")).toBe(false);
        });
    });

    describe("createAttribute / createLabel / createRelation (real DB)", () => {
        it("persists a label via createLabel and exposes it through becca", () => {
            const noteId = makeNote("createLabel target");

            const attr = clsInit(() => createLabel(noteId, "myUniqueLabelOne", "alpha"));

            expect(attr.attributeId).toBeTruthy();
            expect(attr.type).toBe("label");
            expect(attr.name).toBe("myUniqueLabelOne");
            expect(attr.value).toBe("alpha");

            const note = becca.getNote(noteId);
            expect(note?.getOwnedLabelValue("myUniqueLabelOne")).toBe("alpha");
            expect(becca.attributes[attr.attributeId]).toBe(attr);
        });

        it("defaults the label value to an empty string when omitted", () => {
            const noteId = makeNote("createLabel default value");

            const attr = clsInit(() => createLabel(noteId, "myUniqueLabelTwo"));

            expect(attr.value).toBe("");
            expect(becca.getNote(noteId)?.getOwnedLabelValue("myUniqueLabelTwo")).toBe("");
        });

        it("persists a relation pointing at the target note via createRelation", () => {
            const sourceId = makeNote("relation source");
            const targetId = makeNote("relation target");

            const attr = clsInit(() => createRelation(sourceId, "myUniqueRel", targetId));

            expect(attr.type).toBe("relation");
            expect(attr.name).toBe("myUniqueRel");
            expect(attr.value).toBe(targetId);

            const source = becca.getNote(sourceId);
            expect(source?.getRelationValue("myUniqueRel")).toBe(targetId);
            expect(source?.getRelationTarget("myUniqueRel")?.noteId).toBe(targetId);
        });

        it("createAttribute saves an arbitrary AttributeRow", () => {
            const noteId = makeNote("createAttribute target");
            const row: AttributeRow = {
                noteId,
                type: "label",
                name: "myUniqueRawAttr",
                value: "raw"
            };

            const attr = clsInit(() => createAttribute(row));

            expect(attr.attributeId).toBeTruthy();
            expect(becca.attributes[attr.attributeId]?.name).toBe("myUniqueRawAttr");
            expect(becca.getNote(noteId)?.getOwnedLabelValue("myUniqueRawAttr")).toBe("raw");
        });
    });

    describe("getNoteWithLabel (real DB, becca-optimized lookup)", () => {
        it("returns the note carrying the label when no value filter is given", () => {
            const noteId = makeNote("labelled note");
            clsInit(() => createLabel(noteId, "myFindableLabel", "someValue"));

            const found = getNoteWithLabel("myFindableLabel");
            expect(found?.noteId).toBe(noteId);
        });

        it("filters by value case-insensitively and returns null when nothing matches", () => {
            const noteId = makeNote("valued label note");
            clsInit(() => createLabel(noteId, "myValuedLabel", "MixedCaseValue"));

            // Matching value, but with different casing.
            expect(getNoteWithLabel("myValuedLabel", "mixedcasevalue")?.noteId).toBe(noteId);
            // No attribute has this value.
            expect(getNoteWithLabel("myValuedLabel", "nonExistentValue")).toBe(null);
        });

        it("returns undefined for a label that does not exist at all", () => {
            expect(getNoteWithLabel("noSuchLabelAnywhere")).toBeUndefined();
        });
    });

    describe("getNotesWithLabel (real DB, via search)", () => {
        it("returns all notes carrying a label, optionally filtered by value", () => {
            const first = makeNote("multi label A");
            const second = makeNote("multi label B");
            const third = makeNote("multi label C");

            clsInit(() => {
                createLabel(first, "mySharedLabel", "x");
                createLabel(second, "mySharedLabel", "x");
                createLabel(third, "mySharedLabel", "y");
            });

            const all = getNotesWithLabel("mySharedLabel");
            const allIds = all.map((n) => n.noteId);
            expect(allIds).toEqual(expect.arrayContaining([first, second, third]));

            const onlyX = getNotesWithLabel("mySharedLabel", "x").map((n) => n.noteId);
            expect(onlyX).toEqual(expect.arrayContaining([first, second]));
            expect(onlyX).not.toContain(third);
        });

        it("returns an empty array when no note carries the label", () => {
            expect(getNotesWithLabel("yetAnotherMissingLabel")).toEqual([]);
        });
    });

    describe("getAttributeNames (real DB + built-ins)", () => {
        it("returns built-in names matching the search, sorted with prefix matches first", () => {
            const names = getAttributeNames("label", "share");

            // All results match the (case-insensitive) substring.
            expect(names.every((n) => n.toLowerCase().includes("share"))).toBe(true);
            // Known built-in share labels are present.
            expect(names).toContain("shareAlias");
            expect(names).toContain("shareRoot");
            // Names that start with the query sort before those that merely contain it,
            // and within each group the order is alphabetical.
            const prefixNames = names.filter((n) => n.toLowerCase().startsWith("share"));
            const sortedPrefix = [...prefixNames].sort((a, b) => (a < b ? -1 : 1));
            expect(prefixNames).toEqual(sortedPrefix);
        });

        it("includes a user-created attribute name and matches case-insensitively", () => {
            const noteId = makeNote("named attr note");
            clsInit(() => createLabel(noteId, "zzCustomNamedLabel", "v"));

            // Upper-cased query still finds the lower-cased stored name.
            const names = getAttributeNames("label", "ZZCUSTOMNAMED");
            expect(names).toContain("zzCustomNamedLabel");
        });

        it("filters out internal link-style relation names", () => {
            const names = getAttributeNames("relation", "link");
            expect(names).not.toContain("internalLink");
            expect(names).not.toContain("imageLink");
            expect(names).not.toContain("relationMapLink");
        });

        it("returns no built-in noise for a query that matches nothing", () => {
            expect(getAttributeNames("label", "xyzzy_no_such_attr_name")).toEqual([]);
        });
    });
});
