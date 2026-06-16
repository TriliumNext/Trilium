import { describe, expect, it, vi } from "vitest";

import type { Froca } from "../services/froca-interface.js";
import FAttribute, { type AttributeType, type FAttributeRow } from "./fattribute.js";

describe("FAttribute", () => {
    it("getNote() returns the owning note from froca.notes", () => {
        const ownerNote = { noteId: "owner1" };
        const froca = makeFroca({ owner1: ownerNote });
        const attr = makeAttribute(froca, { type: "label", name: "foo", value: "bar", noteId: "owner1" });

        expect(attr.getNote()).toBe(ownerNote);
    });

    it("targetNoteId returns value for a relation and getTargetNote() awaits froca.getNote", async () => {
        const targetNote = { noteId: "target1" };
        const getNote = vi.fn(async () => targetNote);
        const froca = makeFroca({}, getNote);
        const attr = makeAttribute(froca, { type: "relation", name: "myrel", value: "target1" });

        expect(attr.targetNoteId).toBe("target1");

        const resolved = await attr.getTargetNote();
        expect(resolved).toBe(targetNote);
        expect(getNote).toHaveBeenCalledWith("target1", true);
    });

    it("targetNoteId throws for a non-relation (label) attribute", () => {
        const froca = makeFroca({});
        const attr = makeAttribute(froca, { type: "label", name: "foo", value: "bar" });

        expect(() => attr.targetNoteId).toThrow();
    });

    it("isAutoLink reflects relation and label auto-link names", () => {
        const froca = makeFroca({});

        for (const name of ["internalLink", "imageLink", "relationMapLink", "includeNoteLink"]) {
            const relAttr = makeAttribute(froca, { type: "relation", name, value: "x" });
            expect(relAttr.isAutoLink).toBe(true);
        }

        const otherRel = makeAttribute(froca, { type: "relation", name: "someRel", value: "x" });
        expect(otherRel.isAutoLink).toBe(false);

        const bookmarkLabel = makeAttribute(froca, { type: "label", name: "internalBookmark", value: "" });
        expect(bookmarkLabel.isAutoLink).toBe(true);

        const otherLabel = makeAttribute(froca, { type: "label", name: "foo", value: "" });
        expect(otherLabel.isAutoLink).toBe(false);

        const unknownType = makeAttribute(froca, { type: "weird" as AttributeType, name: "foo", value: "" });
        expect(unknownType.isAutoLink).toBe(false);
    });

    it("toString getter returns a string containing the attributeId", () => {
        const froca = makeFroca({});
        const attr = makeAttribute(froca, { attributeId: "attr-xyz", type: "label", name: "foo", value: "bar" });

        const str = attr.toString;
        expect(typeof str).toBe("string");
        expect(str).toContain("attr-xyz");
    });

    it("isDefinition() detects label/relation definition names", () => {
        const froca = makeFroca({});

        expect(makeAttribute(froca, { type: "label", name: "label:foo", value: "" }).isDefinition()).toBe(true);
        expect(makeAttribute(froca, { type: "label", name: "relation:foo", value: "" }).isDefinition()).toBe(true);
        expect(makeAttribute(froca, { type: "label", name: "foo", value: "" }).isDefinition()).toBe(false);
        expect(makeAttribute(froca, { type: "relation", name: "label:foo", value: "x" }).isDefinition()).toBe(false);
    });

    it("getDefinition() parses the value via the promoted attribute definition parser", () => {
        const froca = makeFroca({});
        const attr = makeAttribute(froca, { type: "label", name: "label:foo", value: "promoted,text,single" });

        expect(attr.getDefinition()).toEqual({ isPromoted: true, labelType: "text", multiplicity: "single" });
    });

    it("isDefinitionFor(attr) matches a definition by type:name", () => {
        const froca = makeFroca({});
        const def = makeAttribute(froca, { type: "label", name: "label:foo", value: "" });
        const matching = makeAttribute(froca, { type: "label", name: "foo", value: "v" });
        const nonMatching = makeAttribute(froca, { type: "label", name: "bar", value: "v" });

        expect(def.isDefinitionFor(matching)).toBe(true);
        expect(def.isDefinitionFor(nonMatching)).toBe(false);
    });

    it("dto getter returns a plain object without the froca property but with attributeId", () => {
        const froca = makeFroca({});
        const attr = makeAttribute(froca, { attributeId: "attr-dto", type: "label", name: "foo", value: "bar" });

        const dto = attr.dto;
        expect("froca" in dto).toBe(false);
        expect(dto.attributeId).toBe("attr-dto");
    });
});

function makeFroca(notes: Record<string, unknown>, getNote: (...args: unknown[]) => Promise<unknown> = vi.fn(async () => undefined)): Froca {
    return { notes, getNote } as unknown as Froca;
}

function makeAttribute(froca: Froca, overrides: Partial<FAttributeRow>): FAttribute {
    const row: FAttributeRow = {
        attributeId: "attr1",
        noteId: "note1",
        type: "label",
        name: "name",
        value: "value",
        position: 0,
        isInheritable: false,
        ...overrides
    };

    return new FAttribute(froca, row);
}
