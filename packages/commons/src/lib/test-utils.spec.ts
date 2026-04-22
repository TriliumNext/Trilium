import { describe, it, expect } from "vitest";
import { findDuplicateJsonKeys, trimIndentation } from "./test-utils.js";

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
    });
});
