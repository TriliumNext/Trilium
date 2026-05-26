import { deferred, formatLogMessage } from "./utils.js";
import { describe, expect, it } from "vitest";

describe("#deferred", () => {
    it("should return a promise", () => {
        const result = deferred();
        expect(result).toBeInstanceOf(Promise);
    });
    // TriliumNextTODO: Add further tests!
});

describe("#formatLogMessage", () => {
    it("formats a single string", () => {
        expect(formatLogMessage("hello")).toBe("hello");
    });

    it("formats a single number", () => {
        expect(formatLogMessage(42)).toBe("42");
    });

    it("joins multiple arguments with spaces", () => {
        expect(formatLogMessage("Hi", 1)).toBe("Hi 1");
        expect(formatLogMessage("a", "b", "c")).toBe("a b c");
    });

    it("stringifies objects as JSON", () => {
        expect(formatLogMessage({ key: "value" })).toBe(JSON.stringify({ key: "value" }, null, 4));
    });

    it("handles mixed types", () => {
        const result = formatLogMessage("count:", 3, { x: 1 });
        expect(result).toBe(`count: 3 ${JSON.stringify({ x: 1 }, null, 4)}`);
    });

    it("handles circular references in objects", () => {
        const obj: Record<string, unknown> = { a: 1 };
        obj.self = obj;
        const result = formatLogMessage(obj);
        expect(result).toContain('"a": 1');
        expect(result).toContain('"self": "[Circular]"');
    });

    it("handles null and undefined", () => {
        expect(formatLogMessage(null)).toBe("null");
        expect(formatLogMessage(undefined)).toBe("undefined");
        expect(formatLogMessage("val:", null, undefined)).toBe("val: null undefined");
    });

    it("handles zero arguments", () => {
        expect(formatLogMessage()).toBe("");
    });
});
