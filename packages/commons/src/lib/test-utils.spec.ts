import { describe, it, expect } from "vitest";
import { findDuplicateJsonKeys, findPluralKeyConflicts, sleepFor, trimIndentation } from "./test-utils.js";

describe("Utils", () => {
    it("trims indentation", () => {
        expect(trimIndentation`\
            Hello
                world
            123`).toBe(`\
Hello
    world
123`);
    });

    it("trims indentation with an interpolated value", () => {
        const value = "hi";
        expect(trimIndentation`\
            <p>${value}</p>`).toBe("<p>hi</p>");
    });

    it("does not cut off text on lines with less indentation than the first line", () => {
        expect(trimIndentation`\
            Hello
        world`).toBe("Hello\nworld");
    });

    it("treats an undefined interpolated value as empty string", () => {
        const value = undefined;
        expect(trimIndentation`\
            before${value}after`).toBe("beforeafter");
    });

    describe("sleepFor", () => {
        it("returns a Promise that resolves after the given duration", async () => {
            const result = sleepFor(1);
            expect(result).toBeInstanceOf(Promise);
            await expect(result).resolves.toBeUndefined();
        });
    });

    describe("findDuplicateJsonKeys", () => {
        it("returns empty for valid JSON without duplicates", () => {
            expect(findDuplicateJsonKeys(`{"a": 1, "b": {"c": 2}}`)).toEqual([]);
        });

        it("detects duplicates at the top level and reports line numbers", () => {
            const text = `{\n  "a": 1,\n  "b": 2,\n  "a": 3\n}`;
            expect(findDuplicateJsonKeys(text)).toEqual([{ key: "a", line: 4 }]);
        });

        it("scopes keys per object — same name at different levels is not a duplicate", () => {
            expect(findDuplicateJsonKeys(`{"a": {"x": 1}, "b": {"x": 2}}`)).toEqual([]);
        });

        it("does not treat string values containing a colon as keys", () => {
            expect(findDuplicateJsonKeys(`{"a": "b:c", "d": "a:e"}`)).toEqual([]);
        });

        it("does not treat strings inside arrays as keys", () => {
            expect(findDuplicateJsonKeys(`{"items": ["a", "a", "b"]}`)).toEqual([]);
        });

        it("detects duplicates when a string value contains an escaped quote", () => {
            const text = `{ "a": "x\\"y", "a": 2 }`;
            expect(findDuplicateJsonKeys(text)).toEqual([{ key: "a", line: 1 }]);
        });

        it("detects duplicates when a string value contains an escaped backslash", () => {
            const text = `{ "a": "x\\\\y", "a": 2 }`;
            expect(findDuplicateJsonKeys(text)).toEqual([{ key: "a", line: 1 }]);
        });

        it("does not mistake an escaped quote inside a value for a key delimiter", () => {
            expect(findDuplicateJsonKeys(`{ "a": "b\\": c", "d": 1 }`)).toEqual([]);
        });

        it("counts newlines that occur inside a string value", () => {
            const text = `{\n  "a": "line1\nline2",\n  "a": 2\n}`;
            expect(findDuplicateJsonKeys(text)).toEqual([{ key: "a", line: 4 }]);
        });

        it("recognises a key even when whitespace separates it from the colon", () => {
            expect(findDuplicateJsonKeys(`{ "a" : 1, "a" : 2 }`)).toEqual([{ key: "a", line: 1 }]);
        });
    });

    describe("findPluralKeyConflicts", () => {
        it("accepts plural forms and keys that merely end in a similar word", () => {
            expect(findPluralKeyConflicts({
                item_one: "One item",
                item_other: "{{count}} items",
                settings_appearance: { ui: "User interface" },
                mother: { tongue: "Mother tongue" },
                brother_in_law: { title: "Brother in law" }
            })).toEqual([]);
        });

        it("reports a namespace named after a plural suffix, with its path and suffix", () => {
            expect(findPluralKeyConflicts({
                settings: { related_actions: "Related actions" },
                settings_other: { related_space_usage: "Space usage" }
            })).toEqual([{ path: "settings_other", suffix: "other" }]);
        });

        it("reports every plural category and finds them at any depth", () => {
            expect(findPluralKeyConflicts({
                a: { b_zero: {}, b_one: {}, b_two: {}, b_few: {}, b_many: {}, b_other: {} }
            })).toEqual([
                { path: "a.b_zero", suffix: "zero" },
                { path: "a.b_one", suffix: "one" },
                { path: "a.b_two", suffix: "two" },
                { path: "a.b_few", suffix: "few" },
                { path: "a.b_many", suffix: "many" },
                { path: "a.b_other", suffix: "other" }
            ]);
        });

        it("accepts a list of strings but not a list containing anything else", () => {
            expect(findPluralKeyConflicts({ item_other: [ "a", "b" ] })).toEqual([]);
            expect(findPluralKeyConflicts({ item_other: [ "a", 2 ] })).toEqual([{ path: "item_other", suffix: "other" }]);
        });

        it("descends into a conflicting namespace to report nested conflicts too", () => {
            expect(findPluralKeyConflicts({ outer_one: { inner_other: {} } })).toEqual([
                { path: "outer_one", suffix: "one" },
                { path: "outer_one.inner_other", suffix: "other" }
            ]);
        });

        it("returns nothing for values that are not objects", () => {
            expect(findPluralKeyConflicts("a string")).toEqual([]);
            expect(findPluralKeyConflicts(null)).toEqual([]);
            expect(findPluralKeyConflicts([ { a_other: {} } ])).toEqual([]);
        });
    });
});
