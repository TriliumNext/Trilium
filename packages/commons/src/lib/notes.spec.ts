import { describe, expect, it } from "vitest";

import { getImageAttachmentTitle, getMimeIcon, getNoteIcon, NOTE_TYPE_ICONS, NOTE_TYPE_IMAGE_ATTACHMENTS, parseMindMapNoteLink } from "./notes.js";
import { NoteType } from "./rows.js";

function buildArgs(overrides: {
    noteId?: string;
    type?: NoteType;
    mime?: string;
    iconClass?: string | undefined;
    workspaceIconClass?: string | undefined;
    isFolder?: () => boolean;
}) {
    return {
        noteId: "abc123",
        type: "text" as NoteType,
        mime: "",
        iconClass: undefined,
        workspaceIconClass: undefined,
        isFolder: () => false,
        ...overrides
    };
}

describe("NOTE_TYPE_ICONS", () => {
    it("maps note types to their boxicon classes", () => {
        expect(NOTE_TYPE_ICONS.file).toBe("bx bx-file");
        expect(NOTE_TYPE_ICONS.image).toBe("bx bx-image");
        expect(NOTE_TYPE_ICONS.code).toBe("bx bx-code");
        expect(NOTE_TYPE_ICONS.book).toBe("bx bx-book");
        expect(NOTE_TYPE_ICONS.mermaid).toBe("bx bx-selection");
        expect(NOTE_TYPE_ICONS.mindMap).toBe("bx bx-sitemap");
        expect(NOTE_TYPE_ICONS.llmChat).toBe("bx bx-message-square-dots");
    });
});

describe("getImageAttachmentTitle", () => {
    // These titles are a wire contract: the type widgets write attachments under them, the
    // `api/images` routes look them up by title, and the ZIP export/import pair resolves embeds
    // through them. Spelled out literally rather than read back off the table, so a typo in
    // NOTE_TYPE_IMAGE_ATTACHMENTS fails here instead of silently breaking every one of them.
    it("resolves the note types whose image lives in a generated attachment", () => {
        expect(getImageAttachmentTitle("canvas")).toBe("canvas-export.svg");
        expect(getImageAttachmentTitle("mermaid")).toBe("mermaid-export.svg");
        expect(getImageAttachmentTitle("mindMap")).toBe("mindmap-export.svg");
        expect(getImageAttachmentTitle("spreadsheet")).toBe("spreadsheet-export.png");

        // Indexing the table directly narrows to the literal, for statically known types.
        expect(NOTE_TYPE_IMAGE_ATTACHMENTS.mermaid).toBe("mermaid-export.svg");
    });

    it("returns undefined for note types that carry their image as content, and for no type", () => {
        // An image note is served straight from its own content, so it has no such attachment.
        expect(getImageAttachmentTitle("image")).toBeUndefined();
        expect(getImageAttachmentTitle("text")).toBeUndefined();
        expect(getImageAttachmentTitle(null)).toBeUndefined();
        expect(getImageAttachmentTitle(undefined)).toBeUndefined();
    });
});

describe("getNoteIcon", () => {
    it("returns the explicit iconClass when provided", () => {
        const icon = getNoteIcon(buildArgs({ iconClass: "bx bx-custom", workspaceIconClass: "bx bx-ws" }));
        expect(icon).toBe("bx bx-custom");
    });

    it("returns the workspaceIconClass when no iconClass is provided", () => {
        const icon = getNoteIcon(buildArgs({ workspaceIconClass: "bx bx-workspace" }));
        expect(icon).toBe("bx bx-workspace");
    });

    it("returns the home icon for the root note", () => {
        const icon = getNoteIcon(buildArgs({ noteId: "root" }));
        expect(icon).toBe("bx bx-home-alt-2");
    });

    it("returns the share icon for the _share note", () => {
        const icon = getNoteIcon(buildArgs({ noteId: "_share", type: "doc" }));
        expect(icon).toBe("bx bx-share-alt");
    });

    it("returns the folder icon for a text note that is a folder", () => {
        const icon = getNoteIcon(buildArgs({ type: "text", isFolder: () => true }));
        expect(icon).toBe("bx bx-folder");
    });

    it("returns the note icon for a text note that is not a folder", () => {
        const icon = getNoteIcon(buildArgs({ type: "text", isFolder: () => false }));
        expect(icon).toBe("bx bx-note");
    });

    it("returns the mime-specific icon for a code note whose mime has an icon", () => {
        const icon = getNoteIcon(buildArgs({ type: "code", mime: "text/css" }));
        expect(icon).toBe("bx bxs-file-css");
    });

    it("falls back to the code icon for a code note whose mime is not in the dictionary", () => {
        const icon = getNoteIcon(buildArgs({ type: "code", mime: "text/x-unknownxyz" }));
        expect(icon).toBe("bx bx-code");
    });

    it("falls back to the code icon for a code note whose mime has no icon", () => {
        const icon = getNoteIcon(buildArgs({ type: "code", mime: "text/apl" }));
        expect(icon).toBe("bx bx-code");
    });

    it("returns the video icon for a file note with a video mime", () => {
        const icon = getNoteIcon(buildArgs({ type: "file", mime: "video/mp4" }));
        expect(icon).toBe("bx bx-video");
    });

    it("returns the music icon for a file note with an audio mime", () => {
        const icon = getNoteIcon(buildArgs({ type: "file", mime: "audio/mpeg" }));
        expect(icon).toBe("bx bx-music");
    });

    it("returns the mapped file icon for a file note with a known mime", () => {
        const icon = getNoteIcon(buildArgs({ type: "file", mime: "application/pdf" }));
        expect(icon).toBe("bx bxs-file-pdf");
    });

    it("falls back to the file icon for a file note with an unmapped mime", () => {
        const icon = getNoteIcon(buildArgs({ type: "file", mime: "text/plain" }));
        expect(icon).toBe("bx bx-file");
    });

    it("returns the mapped image icon for an image note with a known mime", () => {
        const icon = getNoteIcon(buildArgs({ type: "image", mime: "image/gif" }));
        expect(icon).toBe("bx bxs-file-gif");
    });

    it("falls back to the image icon for an image note with an unmapped mime", () => {
        const icon = getNoteIcon(buildArgs({ type: "image", mime: "image/png" }));
        expect(icon).toBe("bx bx-image");
    });

    it("returns the note-type icon for any other type", () => {
        const icon = getNoteIcon(buildArgs({ type: "book" }));
        expect(icon).toBe("bx bx-book");
    });
});

describe("parseMindMapNoteLink", () => {
    it("tells a link to a note from one pointing outside Trilium", () => {
        expect(parseMindMapNoteLink("#root/abc123")).toEqual({ notePath: "root/abc123", noteId: "abc123" });
        // The whole path is kept — it is what places the note — and the note is the end of it.
        expect(parseMindMapNoteLink("#root/parent/abc123")).toEqual({ notePath: "root/parent/abc123", noteId: "abc123" });
        expect(parseMindMapNoteLink("#root")).toEqual({ notePath: "root", noteId: "root" });

        for (const link of [
            null, undefined, "", 42,
            "https://example.com",
            // An address of its own that happens to carry a note path is still a page elsewhere.
            "https://example.com/#root/abc123",
            "#rootless/abc",
            // The address as Mind Elixir would hold it, or not at all.
            "root/abc123",
            "#root/abc123?bookmark=x"
        ]) {
            expect(parseMindMapNoteLink(link)).toBeNull();
        }
    });
});

describe("getMimeIcon", () => {
    it("reads a media type the way a note of that content is read", () => {
        // Same answers as the file/image branches above, which now go through here: a PDF is a PDF
        // whether it arrived as a note or as an attachment.
        expect(getMimeIcon("application/pdf")).toBe("bx bxs-file-pdf");
        expect(getMimeIcon("video/mp4")).toBe("bx bx-video");
        expect(getMimeIcon("audio/mpeg")).toBe("bx bx-music");
        expect(getMimeIcon("image/gif")).toBe("bx bxs-file-gif");
        expect(getMimeIcon("image/png")).toBe("bx bx-image");
        expect(getMimeIcon("text/plain")).toBe("bx bx-file");
    });

    it("falls back to the file icon when there is no media type to read", () => {
        expect(getMimeIcon(undefined)).toBe("bx bx-file");
        expect(getMimeIcon(null)).toBe("bx bx-file");
        expect(getMimeIcon("")).toBe("bx bx-file");
    });

    it("does not answer with something off the mapping tables' prototype", () => {
        // The media type is whatever was stored. Read off a table rather than checked against it,
        // these return a function, which survives the `??` and is handed on as an icon class.
        expect(getMimeIcon("constructor")).toBe("bx bx-file");
        expect(getMimeIcon("toString")).toBe("bx bx-file");
    });
});
