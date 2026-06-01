import { describe, it, expect } from "vitest";
import { findDuplicateJsonKeys, sleepFor, trimIndentation } from "./test-utils.js";

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
});
