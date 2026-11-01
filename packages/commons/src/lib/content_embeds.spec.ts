import { describe, expect, it } from "vitest";

import {
    type ContentEmbedContext, getAttachmentEmbedHref, getEmbedKey, getNestedEmbedOptions,
    getNoteEmbedHref, resolveContentEmbed
} from "./content_embeds.js";

const NO_PATH = { seenNoteIds: new Set<string>() };

/** Resolves an `.include-note` whose attributes are `values`. */
function resolve(values: Record<string, string>, context: ContentEmbedContext = NO_PATH) {
    return resolveContentEmbed((name) => values[name], context);
}

describe("resolveContentEmbed", () => {
    it("shows a note or a block of one, and links to it from a Tiny embed", () => {
        expect(resolve({ "data-note-id": "abc123" }))
            .toEqual({ kind: "note", noteId: "abc123", block: undefined, asLink: false });
        expect(resolve({ "data-note-id": "abc123", "data-block": "b1" }))
            .toEqual({ kind: "note", noteId: "abc123", block: "b1", asLink: false });
        expect(resolve({ "data-note-id": "abc123", "data-box-size": "tiny" }))
            .toEqual({ kind: "note", noteId: "abc123", block: undefined, asLink: true });
    });

    it("links to a note already rendered on the path, but not to another block of it", () => {
        const context = { seenNoteIds: new Set([ getEmbedKey("abc123", "b1") ]) };

        expect(resolve({ "data-note-id": "abc123", "data-block": "b1" }, context))
            .toMatchObject({ asLink: true });
        expect(resolve({ "data-note-id": "abc123", "data-block": "b2" }, context))
            .toMatchObject({ asLink: false });
    });

    it("shows an attachment, linking to it below the first level", () => {
        expect(resolve({ "data-attachment-id": "att1" }))
            .toEqual({ kind: "attachment", attachmentId: "att1", asLink: false });
        const belowFirstLevel = { ...NO_PATH, embedsAsReferenceLinks: true };
        expect(resolve({ "data-attachment-id": "att1" }, belowFirstLevel))
            .toEqual({ kind: "attachment", attachmentId: "att1", asLink: true });
    });

    it("ignores an embed that names nothing, or an ID Trilium would not generate", () => {
        expect(resolve({})).toBeNull();
        expect(resolve({ "data-note-id": "x\"><script>" })).toBeNull();
        expect(resolve({ "data-attachment-id": "../etc" })).toBeNull();
    });
});

describe("getNestedEmbedOptions", () => {
    it("copies the path, and expands below the first level only when asked to", () => {
        const seenNoteIds = new Set([ "abc123" ]);

        const shown = getNestedEmbedOptions({ seenNoteIds }, "b1");
        expect(shown).toEqual({ seenNoteIds, block: "b1", embedsAsReferenceLinks: true });
        expect(shown.seenNoteIds).not.toBe(seenNoteIds);

        expect(getNestedEmbedOptions({ seenNoteIds, expandNestedEmbeds: true }, undefined))
            .toEqual({ seenNoteIds, block: undefined, expandNestedEmbeds: true });
    });
});

describe("embed links", () => {
    it("point at the note, the block or the attachment", () => {
        expect(getNoteEmbedHref("abc123", undefined)).toBe("#root/abc123");
        expect(getNoteEmbedHref("abc123", "b 1")).toBe("#root/abc123?block=b%201");
        expect(getAttachmentEmbedHref("owner1", "att1"))
            .toBe("#root/owner1?viewMode=attachments&attachmentId=att1");
    });
});
