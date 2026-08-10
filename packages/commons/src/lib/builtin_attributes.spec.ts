import { describe, expect, it } from "vitest";

import BUILTIN_ATTRIBUTES, { type FilterLabelsByType, type LabelNames, type RelationNames } from "./builtin_attributes.js";
import { LABEL_TYPES } from "./promoted_attribute_definition_parser.js";

describe("BUILTIN_ATTRIBUTES", () => {
    it("declares each name once per type, with a value type on every label", () => {
        const seen = new Set<string>();

        for (const attr of BUILTIN_ATTRIBUTES) {
            const key = `${attr.type}:${attr.name}`;
            expect(seen.has(key), `${key} is declared more than once`).toBe(false);
            seen.add(key);

            if (attr.type === "label") {
                // Checked against the promoted-attribute vocabulary itself, so the two cannot diverge.
                expect(LABEL_TYPES).toContain(attr.valueType);
            }
        }
    });

    it("gives every closed set its choices, and nothing else choices to offer", () => {
        const selectNames: string[] = [];

        for (const attr of BUILTIN_ATTRIBUTES) {
            if (attr.type !== "label") continue;

            if (attr.valueType !== "select") {
                expect(attr.selectOptions, `${attr.name} offers choices but is not a select`).toBeUndefined();
                continue;
            }

            selectNames.push(attr.name);
            const options = attr.selectOptions ?? [];
            expect(options.length, `${attr.name} offers nothing to pick`).toBeGreaterThan(0);
            // A blank is what an empty field already says, and a duplicate is two identical rows.
            expect(new Set(options).size, `${attr.name} repeats an option`).toBe(options.length);
            expect(options.filter((option) => option.trim() === ""), `${attr.name} offers a blank`).toEqual([]);
        }

        // Guards against the whole set being dropped, which would leave the loop above vacuous.
        expect(selectNames).toContain("sortDirection");
    });

    it("marks a value as user-authored only where a value exists to author", () => {
        // Relations always point at a note ID, so `hasUserValue` would be meaningless on one.
        const flaggedRelations = BUILTIN_ATTRIBUTES
            .filter((attr) => attr.type === "relation" && "hasUserValue" in attr)
            .map((attr) => attr.name);

        expect(flaggedRelations).toEqual([]);
    });
});

/**
 * The point of deriving the name types from the list above is that a name cannot be known to one and
 * missing from the other. These assertions fail at build time rather than at run time, so they carry no
 * expectations — merely naming a label that is no longer declared is the failure.
 */
describe("derived name types", () => {
    it("covers plain names, their disabled forms and the per-value-type subsets", () => {
        const label: LabelNames = "calendar:view";
        const relation: RelationNames = "template";

        // Dangerous attributes get their `disabled:` form generated, rather than enumerated by hand.
        const disabledLabel: LabelNames = "disabled:webViewSrc";
        const disabledRelation: RelationNames = "disabled:renderNote";

        const flag: FilterLabelsByType<boolean> = "archived";
        const text: FilterLabelsByType<string> = "searchString";
        const count: FilterLabelsByType<number> = "pageSize";

        // @ts-expect-error a name nothing declares is not a builtin one
        const unknown: LabelNames = "notALabelTriliumKnows";

        // @ts-expect-error `archived` is a flag, so it is absent from the string-valued subset
        const wrongValueType: FilterLabelsByType<string> = "archived";

        expect([ label, relation, disabledLabel, disabledRelation, flag, text, count, unknown, wrongValueType ])
            .toHaveLength(9);
    });
});
