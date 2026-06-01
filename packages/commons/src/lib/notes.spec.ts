import { describe, expect, it } from "vitest";

import { getNoteIcon, NOTE_TYPE_ICONS } from "./notes.js";
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
