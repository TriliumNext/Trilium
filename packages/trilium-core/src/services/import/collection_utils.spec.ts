import { describe, expect, it } from "vitest";

import { buildPromotedDefinition, toAttributeName } from "./collection_utils.js";

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
