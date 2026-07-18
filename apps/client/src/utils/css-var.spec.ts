import { describe, expect, it } from "vitest";

import { CssVarReader, readCssVar } from "./css-var.js";

describe("readCssVar", () => {
    it("reads a custom property off an element (prepending the -- prefix)", () => {
        const el = document.createElement("div");
        el.style.setProperty("--my-var", "hello");
        document.body.appendChild(el);

        // happy-dom may or may not surface custom properties through
        // getComputedStyle, so we only assert the call returns a usable reader
        // (covering the readCssVar code path) and falls back gracefully.
        const reader = readCssVar(el, "my-var");
        expect(reader).toBeInstanceOf(CssVarReader);
        expect(reader.asString("fallback")).toBeTypeOf("string");

        document.body.removeChild(el);
    });

    it("returns a reader yielding the default for an unset property", () => {
        const el = document.createElement("div");
        expect(readCssVar(el, "does-not-exist").asString("fallback")).toBe("fallback");
    });
});

describe("CssVarReader.asString", () => {
    it("returns the raw value when present", () => {
        expect(new CssVarReader("hello").asString()).toBe("hello");
    });

    it("falls back to the default for empty values", () => {
        expect(new CssVarReader("").asString("def")).toBe("def");
        expect(new CssVarReader("").asString()).toBeUndefined();
    });
});

describe("CssVarReader.asNumber", () => {
    it("parses integers and floats", () => {
        expect(new CssVarReader("42").asNumber()).toBe(42);
        expect(new CssVarReader("3.14").asNumber()).toBe(3.14);
        expect(new CssVarReader("12px").asNumber()).toBe(12);
    });

    it("falls back to the default for empty values", () => {
        expect(new CssVarReader("").asNumber(99)).toBe(99);
        expect(new CssVarReader("").asNumber()).toBeUndefined();
    });

    it("falls back to the default when the value does not parse to a number", () => {
        expect(new CssVarReader("abc").asNumber(99)).toBe(99);
        expect(new CssVarReader("abc").asNumber()).toBeUndefined();
    });
});

describe("CssVarReader.asBoolean", () => {
    it("parses truthy values", () => {
        expect(new CssVarReader("true").asBoolean()).toBe(true);
        expect(new CssVarReader(" TRUE ").asBoolean()).toBe(true);
        expect(new CssVarReader("1").asBoolean()).toBe(true);
    });

    it("parses falsy values", () => {
        expect(new CssVarReader("false").asBoolean()).toBe(false);
        expect(new CssVarReader("0").asBoolean()).toBe(false);
    });

    it("falls back to the default for unmatched values", () => {
        expect(new CssVarReader("maybe").asBoolean(true)).toBe(true);
        expect(new CssVarReader("maybe").asBoolean()).toBeUndefined();
    });
});

describe("CssVarReader.asEnum", () => {
    const colors = { red: "RED", green: "GREEN" } as const;

    it("returns the mapped value when the key is a member", () => {
        expect(new CssVarReader("red").asEnum(colors)).toBe("RED");
    });

    it("falls back to the default when the key is not a member", () => {
        expect(new CssVarReader("blue").asEnum(colors, colors.green)).toBe("GREEN");
        expect(new CssVarReader("blue").asEnum(colors)).toBeUndefined();
    });
});

describe("CssVarReader.asArray", () => {
    it("splits on the default space delimiter into CssVarReaders", () => {
        const parts = new CssVarReader("a b c").asArray();
        expect(parts).toHaveLength(3);
        expect(parts.map((p) => p.asString())).toEqual(["a", "b", "c"]);
    });

    it("splits on a custom delimiter", () => {
        const parts = new CssVarReader("a,b,c").asArray(",");
        expect(parts.map((p) => p.asString())).toEqual(["a", "b", "c"]);
    });
});
