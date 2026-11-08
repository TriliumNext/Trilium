import { describe, expect, it } from "vitest";

import {
    BOX_SIZES, type ContentEmbedContext, getAttachmentEmbedHref, getEmbedKey,
    getMediaEmbedClasses, getNestedEmbedOptions, getNoteEmbedHref, hasCompactContent,
    isEmbedShownAsLink, normalizeEmbedBox, readBoxSize, resolveContentEmbed
} from "./content_embeds.js";

const NO_PATH = { seenNoteIds: new Set<string>() };

/** Resolves an `.include-note` whose attributes are `values`. */
function resolve(values: Record<string, string>, context: ContentEmbedContext = NO_PATH) {
    return resolveContentEmbed((name) => values[name], context);
}

describe("resolveContentEmbed", () => {
    it("shows a note or a block of one, with its box size read as the editor reads it", () => {
        expect(resolve({ "data-note-id": "abc123" })).toEqual({
            kind: "note", noteId: "abc123", block: undefined, asLink: false, boxSize: null
        });
        expect(resolve({ "data-note-id": "abc123", "data-block": "b1" }))
            .toMatchObject({ kind: "note", noteId: "abc123", block: "b1", asLink: false });
        expect(resolve({ "data-note-id": "abc123", "data-box-size": "compact" }))
            .toMatchObject({ asLink: false, boxSize: "compact" });
        expect(resolve({ "data-note-id": "abc123", "data-box-size": "tiny" }))
            .toMatchObject({ asLink: false, boxSize: "compact" });
        expect(resolve({ "data-note-id": "abc123", "data-box-size": "small" }))
            .toMatchObject({ boxSize: "resizable" });
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
            .toEqual({ kind: "attachment", attachmentId: "att1", asLink: false, boxSize: null });
        const belowFirstLevel = { ...NO_PATH, embedsAsReferenceLinks: true };
        expect(resolve({ "data-attachment-id": "att1" }, belowFirstLevel))
            .toMatchObject({ kind: "attachment", attachmentId: "att1", asLink: true });
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

describe("getMediaEmbedClasses", () => {
    it("names the box of a video or of an audio file", () => {
        expect([ getMediaEmbedClasses(false), getMediaEmbedClasses(true) ]).toEqual([
            [ "media-embed", "video-embed" ], [ "media-embed", "audio-embed" ]
        ]);
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

describe("readBoxSize", () => {
    it("keeps a size of the embed, and reads the sizes of older notes as the sizes they became", () => {
        expect(readBoxSize("full", BOX_SIZES, "resizable")).toEqual({ boxSize: "full", height: null });
        expect(readBoxSize("tiny", BOX_SIZES, "resizable"))
            .toEqual({ boxSize: "compact", height: null });
        expect(readBoxSize("small", BOX_SIZES, "full"))
            .toEqual({ boxSize: "resizable", height: "10em" });
        expect(readBoxSize("medium", BOX_SIZES, "full"))
            .toEqual({ boxSize: "resizable", height: "20em" });
    });

    it("falls back for a missing size, an unknown one and one the embed cannot take", () => {
        expect(readBoxSize(null, BOX_SIZES, "resizable")).toEqual({ boxSize: "resizable", height: null });
        expect(readBoxSize("huge", BOX_SIZES, "full")).toEqual({ boxSize: "full", height: null });
        expect(readBoxSize("tiny", [ "resizable", "full" ], "full"))
            .toEqual({ boxSize: "full", height: null });
        expect(readBoxSize("small", [ "compact", "resizable" ], "compact"))
            .toEqual({ boxSize: "resizable", height: "10em" });
    });
});

describe("normalizeEmbedBox", () => {
    /** An element with `attributes`, which records what is set on it. */
    function element(attributes: Record<string, string>) {
        return {
            attributes,
            getAttribute: (name: string) => attributes[name] ?? null,
            setAttribute(name: string, value: string) {
                attributes[name] = value;
            }
        };
    }

    it("rewrites the size of an older note and gives it the height that size had", () => {
        const small = element({ "data-box-size": "small" });
        expect(normalizeEmbedBox(small)).toBe("resizable");
        expect(small.attributes)
            .toEqual({ "data-box-size": "resizable", style: "--include-note-height:10em" });

        const styled = element({ "data-box-size": "medium", style: "--include-note-width:30em;" });
        normalizeEmbedBox(styled);
        expect(styled.attributes.style).toBe("--include-note-width:30em;--include-note-height:20em");

        const tiny = element({ "data-box-size": "tiny" });
        expect(normalizeEmbedBox(tiny)).toBe("compact");
        expect(tiny.attributes).toEqual({ "data-box-size": "compact" });
    });

    it("keeps a saved height over the one the size had, and leaves other sizes alone", () => {
        const resized = element({ "data-box-size": "small", style: "--include-note-height:5em" });
        normalizeEmbedBox(resized);
        expect(resized.attributes)
            .toEqual({ "data-box-size": "resizable", style: "--include-note-height:5em" });

        const full = element({ "data-box-size": "full" });
        expect(normalizeEmbedBox(full)).toBe("full");
        expect(full.attributes).toEqual({ "data-box-size": "full" });
        expect(normalizeEmbedBox(element({}))).toBeNull();
        expect(normalizeEmbedBox(element({ "data-box-size": "huge" }))).toBe("huge");
    });
});

describe("compact embeds", () => {
    it("render audio in a row of controls and link to everything else", () => {
        expect(hasCompactContent("audio")).toBe(true);
        expect(hasCompactContent("text")).toBe(false);

        const compact = resolve({ "data-note-id": "abc123", "data-box-size": "compact" });
        const resizable = resolve({ "data-note-id": "abc123", "data-box-size": "resizable" });
        const nested = resolve({ "data-note-id": "abc123" }, { ...NO_PATH, embedsAsReferenceLinks: true });
        if (!compact || !resizable || !nested) throw new Error("expected embeds");

        expect(isEmbedShownAsLink(compact, "text")).toBe(true);
        expect(isEmbedShownAsLink(compact, "audio")).toBe(false);
        expect(isEmbedShownAsLink(resizable, "text")).toBe(false);
        expect(isEmbedShownAsLink(nested, "audio")).toBe(true);
    });
});
