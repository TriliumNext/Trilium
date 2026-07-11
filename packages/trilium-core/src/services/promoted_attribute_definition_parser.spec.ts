import { describe, expect, it, vi } from "vitest";
import promotedAttributeDefinitionParser from "./promoted_attribute_definition_parser.js";

const { parse } = promotedAttributeDefinitionParser;

describe("promoted attribute definition parser", () => {
    it("parses the 'promoted' flag", () => {
        expect(parse("promoted")).toEqual({ isPromoted: true });
    });

    it("parses every recognized label type", () => {
        for (const labelType of ["text", "textarea", "number", "boolean", "date", "datetime", "time", "url", "color"]) {
            expect(parse(labelType)).toEqual({ labelType });
        }
    });

    it("parses both multiplicity values", () => {
        expect(parse("single")).toEqual({ multiplicity: "single" });
        expect(parse("multi")).toEqual({ multiplicity: "multi" });
    });

    it("parses numeric precision and yields NaN when it is missing or malformed", () => {
        expect(parse("precision=2")).toEqual({ numberPrecision: 2 });
        // parseInt tolerates trailing characters.
        expect(parse("precision=3px")).toEqual({ numberPrecision: 3 });
        // Missing value -> parseInt(undefined) -> NaN.
        expect(parse("precision")).toEqual({ numberPrecision: NaN });
    });

    it("parses the promoted alias verbatim", () => {
        expect(parse("alias=My Label")).toEqual({ promotedAlias: "My Label" });
        // Missing value yields undefined rather than throwing.
        expect(parse("alias")).toEqual({ promotedAlias: undefined });
    });

    it("parses the inverse relation and strips disallowed characters", () => {
        // Allowed: letters, numbers, underscore and colon.
        expect(parse("inverse=isParentOf")).toEqual({ inverseRelation: "isParentOf" });
        expect(parse("inverse=is:parent_of2")).toEqual({ inverseRelation: "is:parent_of2" });
        // Disallowed characters (spaces, punctuation, dashes) are removed.
        expect(parse("inverse=is parent-of!")).toEqual({ inverseRelation: "isparentof" });
    });

    it("combines multiple comma-separated tokens into one definition", () => {
        expect(parse("promoted,single,text,precision=4,alias=Foo")).toEqual({
            isPromoted: true,
            multiplicity: "single",
            labelType: "text",
            numberPrecision: 4,
            promotedAlias: "Foo"
        });
    });

    it("trims surrounding whitespace from each token", () => {
        expect(parse("  promoted ,  number ,  precision=1 ")).toEqual({
            isPromoted: true,
            labelType: "number",
            numberPrecision: 1
        });
    });

    it("lets later tokens of the same kind override earlier ones", () => {
        expect(parse("text,number")).toEqual({ labelType: "number" });
        expect(parse("single,multi")).toEqual({ multiplicity: "multi" });
    });

    it("ignores unrecognized tokens (and logs them) while still parsing valid ones", () => {
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        try {
            expect(parse("bogus,promoted")).toEqual({ isPromoted: true });
            expect(logSpy).toHaveBeenCalledWith("Unrecognized attribute definition token:", "bogus");
        } finally {
            logSpy.mockRestore();
        }
    });

    it("returns an empty definition for an empty string and ignores empty tokens", () => {
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        try {
            // An empty string splits into a single empty token, which is unrecognized.
            expect(parse("")).toEqual({});
            // Trailing comma produces an extra empty token that is ignored.
            expect(parse("promoted,")).toEqual({ isPromoted: true });
        } finally {
            logSpy.mockRestore();
        }
    });
});
