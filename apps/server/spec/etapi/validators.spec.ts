import { describe, expect, it } from "vitest";

import v from "../../src/etapi/validators.js";

// The in-memory fixture booted by spec/setup.ts initialises becca and the note-type
// service, so the becca-/service-backed validators (isNoteId, isNoteType) work directly.
describe("etapi/validators", () => {
    it("mandatory rejects undefined, accepts anything else", () => {
        expect(v.mandatory(undefined)).toBeTruthy();
        expect(v.mandatory(null)).toBeUndefined();
        expect(v.mandatory("x")).toBeUndefined();
    });

    it("notNull rejects null only", () => {
        expect(v.notNull(null)).toBeTruthy();
        expect(v.notNull(undefined)).toBeUndefined();
        expect(v.notNull("x")).toBeUndefined();
    });

    it("isString skips nullish, rejects non-strings", () => {
        expect(v.isString(undefined)).toBeUndefined();
        expect(v.isString(null)).toBeUndefined();
        expect(v.isString("x")).toBeUndefined();
        expect(v.isString(5)).toBeTruthy();
    });

    it("isLocalDateTime / isUtcDateTime skip non-strings", () => {
        expect(v.isLocalDateTime(5)).toBeUndefined();
        expect(v.isUtcDateTime(5)).toBeUndefined();
        expect(v.isLocalDateTime("2023-08-21 23:38:51.123+0200")).toBeUndefined();
        expect(v.isUtcDateTime("2023-08-21 23:38:51.123Z")).toBeUndefined();
    });

    it("isBoolean skips nullish, rejects non-booleans", () => {
        expect(v.isBoolean(undefined)).toBeUndefined();
        expect(v.isBoolean(true)).toBeUndefined();
        expect(v.isBoolean("nope")).toBeTruthy();
    });

    it("isInteger skips nullish, rejects non-integers", () => {
        expect(v.isInteger(undefined)).toBeUndefined();
        expect(v.isInteger(5)).toBeUndefined();
        expect(v.isInteger(1.5)).toBeTruthy();
    });

    it("isNoteId skips nullish, rejects non-strings and unknown ids", () => {
        expect(v.isNoteId(undefined)).toBeUndefined();
        expect(v.isNoteId("root")).toBeUndefined();
        expect(v.isNoteId(5)).toBeTruthy();
        expect(v.isNoteId("doesNotExist123")).toBeTruthy();
    });

    it("isNoteType skips nullish, rejects unknown types", () => {
        expect(v.isNoteType(undefined)).toBeUndefined();
        expect(v.isNoteType("text")).toBeUndefined();
        expect(v.isNoteType("notARealType")).toBeTruthy();
    });

    it("isAttributeType skips nullish, accepts label/relation, rejects others", () => {
        expect(v.isAttributeType(undefined)).toBeUndefined();
        expect(v.isAttributeType("label")).toBeUndefined();
        expect(v.isAttributeType("relation")).toBeUndefined();
        expect(v.isAttributeType("banana")).toBeTruthy();
    });

    it("isValidEntityId skips nullish, rejects malformed ids", () => {
        expect(v.isValidEntityId(undefined)).toBeUndefined();
        expect(v.isValidEntityId("abcd")).toBeUndefined();
        expect(v.isValidEntityId("!!")).toBeTruthy();
    });
});
