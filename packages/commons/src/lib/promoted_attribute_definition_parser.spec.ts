import { describe, expect, it, vi } from "vitest";

import parser, {
    extractAttributeDefinitionTypeAndName,
    LABEL_TYPES,
    MULTIPLICITIES
} from "./promoted_attribute_definition_parser.js";

const { parse, serialize } = parser;

/** Runs `fn` with `console.log` silenced, handing it the spy so logged tokens can be asserted. */
function withSilencedLog(fn: (logSpy: ReturnType<typeof vi.spyOn>) => void) {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
        fn(logSpy);
    } finally {
        logSpy.mockRestore();
    }
}

describe("promoted_attribute_definition_parser.parse", () => {
    it("parses the promoted flag, label type and multiplicity, trimming whitespace", () => {
        expect(parse("promoted")).toEqual({ isPromoted: true });
        expect(parse(" promoted , number , single ")).toEqual({
            isPromoted: true,
            labelType: "number",
            multiplicity: "single"
        });
    });

    it("accepts every declared label type and multiplicity", () => {
        // Driven off the exported constants so a newly declared type cannot be left unparsed.
        for (const labelType of LABEL_TYPES) {
            expect(parse(labelType)).toEqual({ labelType });
        }

        for (const multiplicity of MULTIPLICITIES) {
            expect(parse(multiplicity)).toEqual({ multiplicity });
        }
    });

    it("parses the precision, tolerating a malformed or missing one", () => {
        expect(parse("precision=2")).toEqual({ numberPrecision: 2 });
        expect(parse("precision=0")).toEqual({ numberPrecision: 0 });
        // parseInt tolerates trailing characters.
        expect(parse("precision=3px")).toEqual({ numberPrecision: 3 });
        // A missing value yields NaN rather than throwing.
        expect(parse("precision")).toEqual({ numberPrecision: NaN });
    });

    it("parses the select options, dropping blank entries and decoding the escapes", () => {
        expect(parse("options=Todo;In progress;Done")).toEqual({
            selectOptions: [ "Todo", "In progress", "Done" ]
        });
        // `%2C`/`%3B`/`%25` carry the characters the format claims for itself.
        expect(parse("options=1%2C5 kg;a%3Bb;100%25")).toEqual({
            selectOptions: [ "1,5 kg", "a;b", "100%" ]
        });
        // A blank entry offers nothing to pick; an empty or missing value means no options at all.
        expect(parse("options=a;;b;")).toEqual({ selectOptions: [ "a", "b" ] });
        expect(parse("options=")).toEqual({ selectOptions: [] });
        expect(parse("options")).toEqual({ selectOptions: [] });
    });

    it("parses the promoted alias verbatim, including spaces", () => {
        expect(parse("alias=My Label")).toEqual({ promotedAlias: "My Label" });
        expect(parse("alias=")).toEqual({ promotedAlias: "" });
        // A missing value yields undefined rather than throwing.
        expect(parse("alias")).toEqual({ promotedAlias: undefined });
    });

    it("keeps everything after the first '=' as the value", () => {
        // Splitting on every '=' would truncate these at the second separator.
        expect(parse("alias=a=b")).toEqual({ promotedAlias: "a=b" });
        expect(parse("alias====")).toEqual({ promotedAlias: "===" });
    });

    it("parses the inverse relation, stripping characters a relation name may not hold", () => {
        // Allowed: letters, numbers, underscore and colon.
        expect(parse("inverse=isParentOf")).toEqual({ inverseRelation: "isParentOf" });
        expect(parse("inverse=is:parent_of2")).toEqual({ inverseRelation: "is:parent_of2" });
        // Disallowed characters (spaces, punctuation, dashes) are removed.
        expect(parse("inverse=is parent-of!")).toEqual({ inverseRelation: "isparentof" });
        // A missing value yields an empty name rather than throwing.
        expect(parse("inverse")).toEqual({ inverseRelation: "" });
    });

    it("combines multiple tokens, letting a later token of the same kind win", () => {
        expect(parse("promoted,single,text,precision=4,alias=Foo")).toEqual({
            isPromoted: true,
            multiplicity: "single",
            labelType: "text",
            numberPrecision: 4,
            promotedAlias: "Foo"
        });

        expect(parse("text,number")).toEqual({ labelType: "number" });
        expect(parse("single,multi")).toEqual({ multiplicity: "multi" });
    });

    it("logs and skips an unrecognized token while still parsing the valid ones", () => {
        withSilencedLog((logSpy) => {
            expect(parse("bogus,promoted")).toEqual({ isPromoted: true });
            expect(logSpy).toHaveBeenCalledWith(
                "Unrecognized attribute definition token:", "bogus"
            );
        });
    });

    it("returns an empty definition for an empty value, and tolerates a trailing separator", () => {
        withSilencedLog(() => {
            // An empty string splits into a single empty token, which is unrecognized.
            expect(parse("")).toEqual({});
            expect(parse("promoted,")).toEqual({ isPromoted: true });
        });
    });
});

describe("promoted_attribute_definition_parser.serialize", () => {
    it("writes the promoted flag and the alias independently of each other", () => {
        expect(serialize({ isPromoted: true, promotedAlias: "Foo" }, "label"))
            .toBe("promoted,alias=Foo,single,text");

        // The alias is read by the table view and the attribute list as well, neither of which asks
        // whether the attribute is promoted, so it is written whether or not the flag is set.
        expect(serialize({ promotedAlias: "Foo" }, "label")).toBe("alias=Foo,single,text");
        expect(serialize({ isPromoted: true }, "label")).toBe("promoted,single,text");
    });

    it("falls back to the multiplicity and label type the consumers assume", () => {
        expect(serialize({}, "label")).toBe("single,text");
        expect(serialize({}, "relation")).toBe("single");
        expect(serialize({ multiplicity: "multi", labelType: "boolean" }, "label"))
            .toBe("multi,boolean");
    });

    it("writes the precision only for a number with one set", () => {
        expect(serialize({ labelType: "number", numberPrecision: 2 }, "label"))
            .toBe("single,number,precision=2");
        expect(serialize({ labelType: "number" }, "label")).toBe("single,number");
        expect(serialize({ labelType: "text", numberPrecision: 2 }, "label")).toBe("single,text");
        // Zero digits is a precision like any other.
        expect(serialize({ labelType: "number", numberPrecision: 0 }, "label"))
            .toBe("single,number,precision=0");
    });

    it("writes the options only for a select with some, escaping the separators", () => {
        expect(serialize({ labelType: "select", selectOptions: [ "Todo", "In progress" ] }, "label"))
            .toBe("single,select,options=Todo;In progress");
        // The characters the format claims for itself are escaped; everything else is verbatim.
        expect(serialize({ labelType: "select", selectOptions: [ "1,5 kg", "a;b", "100%" ] }, "label"))
            .toBe("single,select,options=1%2C5 kg;a%3Bb;100%25");
        // No options, an empty list, or a non-select type all write no token.
        expect(serialize({ labelType: "select" }, "label")).toBe("single,select");
        expect(serialize({ labelType: "select", selectOptions: [] }, "label")).toBe("single,select");
        expect(serialize({ labelType: "text", selectOptions: [ "a" ] }, "label")).toBe("single,text");
    });

    it("writes the inverse relation for relations only, filtering invalid characters", () => {
        expect(serialize({ inverseRelation: "isChildOf" }, "relation"))
            .toBe("single,inverse=isChildOf");
        expect(serialize({ inverseRelation: "is child#Of!" }, "relation"))
            .toBe("single,inverse=ischildOf");

        // A blank name is dropped, and a label definition has no inverse to write.
        expect(serialize({ inverseRelation: "   " }, "relation")).toBe("single");
        expect(serialize({ inverseRelation: "isChildOf" }, "label")).toBe("single,text");
    });
});

describe("promoted_attribute_definition_parser round-trip", () => {
    it("serializes a parsed definition back to the same value", () => {
        const labelDefinition = "promoted,alias=Foo,multi,number,precision=2";
        expect(serialize(parse(labelDefinition), "label")).toBe(labelDefinition);

        const relationDefinition = "promoted,single,inverse=isChildOf";
        expect(serialize(parse(relationDefinition), "relation")).toBe(relationDefinition);
    });

    it("round-trips select options through the escaping, edge cases included", () => {
        // Values that already look like escapes must survive a round trip unchanged.
        for (const options of [
            [ "Todo", "In progress", "Done" ],
            [ "1,5 kg", "a;b", "100%" ],
            [ "50%25", "%2C", "a%3Bb" ],
            [ "C:\\Users\\bin", "a=b" ]
        ]) {
            const definition = { labelType: "select", selectOptions: options } as const;
            expect(parse(serialize(definition, "label"))).toEqual({
                labelType: "select", multiplicity: "single", selectOptions: options
            });
        }
    });

    it("parses a serialized definition back to the same object, for every label type", () => {
        for (const labelType of LABEL_TYPES) {
            const definition = {
                isPromoted: true, promotedAlias: "Foo", multiplicity: "multi", labelType
            } as const;
            expect(parse(serialize(definition, "label"))).toEqual(definition);
        }
    });
});

describe("extractAttributeDefinitionTypeAndName", () => {
    it("extracts the label type and strips the prefix, keeping colons in the name", () => {
        expect(extractAttributeDefinitionTypeAndName("label:TEST:TEST1"))
            .toEqual([ "label", "TEST:TEST1" ]);
    });

    it("treats anything not starting with label: as a relation", () => {
        expect(extractAttributeDefinitionTypeAndName("relation:author"))
            .toEqual([ "relation", "author" ]);
    });
});
