import { describe, expect, it } from "vitest";

import noteTypeService from "./note_types.js";

const { getNoteTypeNames, getDefaultMimeForNoteType } = noteTypeService;

describe("getNoteTypeNames", () => {
    it("returns all known note type names without duplicates", () => {
        const names = getNoteTypeNames();

        expect(names).toContain("text");
        expect(names).toContain("code");
        expect(names).toContain("mermaid");
        expect(names).toContain("llmChat");
        expect(new Set(names).size).toBe(names.length);
    });

    it("returns a fresh array on each call so callers cannot mutate the source", () => {
        const first = getNoteTypeNames();
        const second = getNoteTypeNames();

        expect(first).not.toBe(second);
        expect(first).toEqual(second);

        first.push("mutated");
        expect(getNoteTypeNames()).not.toContain("mutated");
    });
});

describe("getDefaultMimeForNoteType", () => {
    it("returns the configured default MIME for known types", () => {
        expect(getDefaultMimeForNoteType("text")).toBe("text/html");
        expect(getDefaultMimeForNoteType("code")).toBe("text/plain");
        expect(getDefaultMimeForNoteType("file")).toBe("application/octet-stream");
        expect(getDefaultMimeForNoteType("relationMap")).toBe("application/json");
        expect(getDefaultMimeForNoteType("mermaid")).toBe("text/vnd.mermaid");
    });

    it("returns an empty string for types without a default MIME", () => {
        expect(getDefaultMimeForNoteType("render")).toBe("");
        expect(getDefaultMimeForNoteType("image")).toBe("");
        expect(getDefaultMimeForNoteType("book")).toBe("");
    });

    it("exposes a default MIME for every name reported by getNoteTypeNames", () => {
        for (const name of getNoteTypeNames()) {
            expect(typeof getDefaultMimeForNoteType(name)).toBe("string");
        }
    });

    it("throws for an unknown note type", () => {
        expect(() => getDefaultMimeForNoteType("nonExistentType")).toThrow(
            "Cannot find note type 'nonExistentType'"
        );
        expect(() => getDefaultMimeForNoteType("")).toThrow(/Cannot find note type/);
    });
});
