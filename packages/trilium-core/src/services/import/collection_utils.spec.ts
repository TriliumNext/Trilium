import { describe, expect, it, vi } from "vitest";

import type BNote from "../../becca/entities/bnote.js";
import { buildPromotedDefinition, saveFileAttachment, stripUrlScheme, toAttributeName } from "./collection_utils.js";

describe("toAttributeName", () => {
    it("camelCases a multi-word name, lower-casing the first word", () => {
        expect(toAttributeName("Text column")).toBe("textColumn");
        expect(toAttributeName("Created by")).toBe("createdBy");
        expect(toAttributeName("Last edited by")).toBe("lastEditedBy");
    });

    it("treats hyphens, underscores, parentheses and other punctuation as word boundaries", () => {
        expect(toAttributeName("Multi-select")).toBe("multiSelect");
        expect(toAttributeName("snake_case")).toBe("snakeCase");
        expect(toAttributeName("Sub-title (v2)")).toBe("subTitleV2");
        expect(toAttributeName("Weight, kg")).toBe("weightKg");
    });

    it("lower-cases an all-caps acronym or single letter", () => {
        expect(toAttributeName("URL")).toBe("url");
        expect(toAttributeName("ID")).toBe("id");
        expect(toAttributeName("A")).toBe("a");
    });

    it("normalizes a single word to lower-case and leaves a plain name unchanged", () => {
        expect(toAttributeName("Status")).toBe("status");
        expect(toAttributeName("title")).toBe("title");
    });

    it("keeps digits attached to their word", () => {
        expect(toAttributeName("Q1 revenue")).toBe("q1Revenue");
        expect(toAttributeName("123")).toBe("123");
    });

    it("supports unicode letters", () => {
        expect(toAttributeName("Café date")).toBe("caféDate");
    });

    it("camelCases names with mixed separators and an ampersand", () => {
        expect(toAttributeName("Text property")).toBe("textProperty");
        expect(toAttributeName("Number prop")).toBe("numberProp");
        expect(toAttributeName("Date & Time")).toBe("dateTime");
    });

    it("falls back to 'unnamed' when there is no alphanumeric content", () => {
        expect(toAttributeName("")).toBe("unnamed");
        expect(toAttributeName("()")).toBe("unnamed");
        expect(toAttributeName("   ")).toBe("unnamed");
    });
});

describe("buildPromotedDefinition", () => {
    it("builds a single-valued promoted definition keeping the original name as the alias", () => {
        expect(buildPromotedDefinition({ alias: "URL", labelType: "url", multiplicity: "single" })).toBe("promoted,single,url,alias=URL");
        expect(buildPromotedDefinition({ alias: "Text property", labelType: "text", multiplicity: "single" })).toBe("promoted,single,text,alias=Text property");
    });

    it("neutralizes commas, equals and control chars in the alias so the definition can't be corrupted", () => {
        expect(buildPromotedDefinition({ alias: "a,b=c", labelType: "text", multiplicity: "single" })).toBe("promoted,single,text,alias=a b c");
    });

    it("emits the column's multiplicity (multi for a multi-select)", () => {
        expect(buildPromotedDefinition({ alias: "Multi-select", labelType: "text", multiplicity: "multi" })).toBe("promoted,multi,text,alias=Multi-select");
    });

    it("omits the value type for a relation column (no labelType)", () => {
        expect(buildPromotedDefinition({ alias: "Related", multiplicity: "multi" })).toBe("promoted,multi,alias=Related");
    });
});

describe("stripUrlScheme", () => {
    it("strips the given scheme and leaves a value without it untouched", () => {
        expect(stripUrlScheme("mailto:a@b.com", "mailto:")).toBe("a@b.com");
        expect(stripUrlScheme("tel:12345", "tel:")).toBe("12345");
        expect(stripUrlScheme("a@b.com", "mailto:")).toBe("a@b.com");
        // Only the scheme asked for is stripped — a mismatched one is somebody else's value.
        expect(stripUrlScheme("tel:12345", "mailto:")).toBe("tel:12345");
    });
});

describe("saveFileAttachment", () => {
    it("prefers the given MIME, else derives it from the title, else falls back to octet-stream", () => {
        // Only the attachment payload is under test here; persisting it is covered by the importer specs.
        const saveAttachment = vi.fn();
        const note = { saveAttachment } as unknown as BNote;
        const content = new Uint8Array([1, 2, 3]);

        saveFileAttachment(note, "notes.txt", content, "application/x-custom");
        saveFileAttachment(note, "script.py", content);
        saveFileAttachment(note, "blob.unknownext", content);

        expect(saveAttachment.mock.calls.map(([attachment]) => attachment.mime)).toEqual([
            "application/x-custom",
            "text/x-python",
            "application/octet-stream"
        ]);
        expect(saveAttachment.mock.calls[0][0]).toMatchObject({ role: "file", title: "notes.txt", content });
    });
});
