import { describe, expect, it } from "vitest";

import {
    buildNoteTypeId, buildTemplateId, isNoteTypeId, isTemplateId, parseNoteTypeId, resolveNoteType
} from "./note_type_ids.js";

describe("note type ids", () => {
    /** The mime is part of a type's id: a Markdown note and a code note are both `code`. */
    it("names a note type by its type and mime, and a template by its note", () => {
        expect(buildNoteTypeId("code", "text/x-markdown")).toBe("type:code:text/x-markdown");
        expect(buildNoteTypeId("canvas")).toBe("type:canvas:");
        expect(buildTemplateId("abc123")).toBe("template:abc123");

        expect(isNoteTypeId("type:text:text/html")).toBe(true);
        expect(isNoteTypeId("template:abc123")).toBe(false);
        expect(isTemplateId("template:abc123")).toBe(true);
    });

    it("reads an id back to what it names", () => {
        expect(parseNoteTypeId("type:code:text/x-markdown"))
            .toEqual({ kind: "type", type: "code", mime: "text/x-markdown" });
        // A mime is written even when there is none, so the id round-trips.
        expect(parseNoteTypeId(buildNoteTypeId("canvas")))
            .toEqual({ kind: "type", type: "canvas", mime: undefined });
        expect(parseNoteTypeId("template:abc123"))
            .toEqual({ kind: "template", templateNoteId: "abc123" });
    });

    /**
     * A stored id outlives what it names: a note type can be dropped from the app, and an id can
     * come from a document written by a newer build. Neither is a reason to fail.
     */
    it("answers with nothing for an id it cannot make sense of", () => {
        expect(parseNoteTypeId("type:notAType:text/html")).toBeUndefined();
        expect(parseNoteTypeId("template:")).toBeUndefined();
        expect(parseNoteTypeId("text")).toBeUndefined();
        expect(parseNoteTypeId("")).toBeUndefined();
        expect(resolveNoteType("type:notAType:")).toBeUndefined();
    });

    /** What creating a note from an id asks for, which is what `createNote` takes. */
    it("resolves an id to what a note is created with", () => {
        expect(resolveNoteType("type:canvas:application/json"))
            .toEqual({ type: "canvas", mime: "application/json" });
        expect(resolveNoteType(buildNoteTypeId("text", "text/html")))
            .toEqual({ type: "text", mime: "text/html" });
        expect(resolveNoteType("template:abc123")).toEqual({ templateNoteId: "abc123" });
    });

    /**
     * An id with no mime at all, which a hand-written one or one from an older build can be. There
     * is nothing after the type to read a mime from, and the type alone still names a note type.
     */
    it("reads an id that carries no mime", () => {
        expect(parseNoteTypeId("type:text")).toEqual({ kind: "type", type: "text", mime: undefined });
        expect(parseNoteTypeId("type:notAType")).toBeUndefined();
        expect(resolveNoteType("type:canvas")).toEqual({ type: "canvas", mime: undefined });
    });

    /** A mime holds colons of its own in some builds, and the id keeps all of it. */
    it("keeps everything after the type as the mime", () => {
        const id = buildNoteTypeId("code", "text/plain;charset=utf-8");
        expect(parseNoteTypeId(id)).toEqual({
            kind: "type", type: "code", mime: "text/plain;charset=utf-8"
        });
    });
});
