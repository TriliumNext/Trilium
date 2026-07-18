import { describe, expect, it, vi } from "vitest";

import parser, { extractAttributeDefinitionTypeAndName } from "./promoted_attribute_definition_parser.js";

describe("promoted_attribute_definition_parser.parse", () => {
    it("parses promoted, label type and multiplicity tokens (with surrounding whitespace)", () => {
        const def = parser.parse(" promoted , number , single ");

        expect(def).toEqual({
            isPromoted: true,
            labelType: "number",
            multiplicity: "single"
        });
    });

    it("accepts every supported label type and multi multiplicity", () => {
        const labelTypes = ["text", "textarea", "number", "boolean", "date", "datetime", "time", "url", "color"];
        for (const labelType of labelTypes) {
            expect(parser.parse(labelType)).toEqual({ labelType });
        }

        expect(parser.parse("multi")).toEqual({ multiplicity: "multi" });
    });

    it("parses precision, alias and inverse key=value tokens", () => {
        const def = parser.parse("precision=2,alias=foo,inverse=isChildOf");

        expect(def).toEqual({
            numberPrecision: 2,
            promotedAlias: "foo",
            inverseRelation: "isChildOf"
        });
    });

    it("logs and ignores unrecognized tokens", () => {
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        try {
            const def = parser.parse("bogus");
            expect(def).toEqual({});
            expect(logSpy).toHaveBeenCalledWith("Unrecognized attribute definition token:", "bogus");
        } finally {
            logSpy.mockRestore();
        }
    });
});

describe("extractAttributeDefinitionTypeAndName", () => {
    it("extracts the label type and strips the prefix", () => {
        expect(extractAttributeDefinitionTypeAndName("label:TEST:TEST1")).toEqual(["label", "TEST:TEST1"]);
    });

    it("treats anything not starting with label: as a relation", () => {
        expect(extractAttributeDefinitionTypeAndName("relation:author")).toEqual(["relation", "author"]);
    });
});
