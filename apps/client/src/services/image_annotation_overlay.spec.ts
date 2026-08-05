import { describe, expect, it } from "vitest";

import FAttachment from "../entities/fattachment.js";
import type FNote from "../entities/fnote.js";
import { attachmentTitle, buildInitialData, ownerNoteId } from "./image_annotation_utils.js";

const mockFroca = { attachments: {} as Record<string, unknown> };

function makeAttachment(attachmentId: string, ownerId: string): FAttachment {
    return new FAttachment(mockFroca as any, {
        attachmentId,
        ownerId,
        role: "image",
        mime: "image/png",
        title: "test.png",
        dateModified: "",
        utcDateModified: "",
        utcDateScheduledForErasureSince: "",
        contentLength: 0,
    });
}

function makeNote(noteId: string): Pick<FNote, "noteId"> {
    return { noteId } as Pick<FNote, "noteId">;
}

describe("attachmentTitle", () => {
    it("returns attachment-specific filename for FAttachment", () => {
        const att = makeAttachment("abc123", "note001");
        expect(attachmentTitle(att)).toBe("excalidraw-annotations-abc123.json");
    });

    it("returns generic filename for FNote", () => {
        const note = makeNote("note001");
        expect(attachmentTitle(note as FNote)).toBe("excalidraw-annotations.json");
    });
});

describe("ownerNoteId", () => {
    it("returns ownerId for FAttachment", () => {
        const att = makeAttachment("attXyz", "ownerNote");
        expect(ownerNoteId(att)).toBe("ownerNote");
    });

    it("returns noteId for FNote", () => {
        const note = makeNote("directNote");
        expect(ownerNoteId(note as FNote)).toBe("directNote");
    });
});

describe("buildInitialData", () => {
    const DATA_URL = "data:image/png;base64,abc";

    it("places the background image element first in the elements array", () => {
        const result = buildInitialData(DATA_URL, 800, 600, []);
        expect(result.elements).toHaveLength(1);
        const bg = (result.elements as any[])[0];
        expect(bg.id).toBe("ann-bg-el");
        expect(bg.type).toBe("image");
        expect(bg.fileId).toBe("ann-bg-img");
    });

    it("sets background dimensions correctly", () => {
        const result = buildInitialData(DATA_URL, 1024, 768, []);
        const bg = (result.elements as any[])[0];
        expect(bg.width).toBe(1024);
        expect(bg.height).toBe(768);
        expect(bg.x).toBe(0);
        expect(bg.y).toBe(0);
    });

    it("appends annotation elements after the background", () => {
        const ann = { type: "rectangle", id: "el1" };
        const result = buildInitialData(DATA_URL, 100, 100, [ann]);
        expect((result.elements as any[])).toHaveLength(2);
        expect((result.elements as any[])[1]).toMatchObject({ id: "el1" });
    });

    it("registers the background image file with the source data URL", () => {
        const result = buildInitialData(DATA_URL, 100, 100, []);
        const files = result.files as Record<string, any>;
        expect(files["ann-bg-img"]).toBeDefined();
        expect(files["ann-bg-img"].dataURL).toBe(DATA_URL);
    });

    it("merges additional stored files alongside the background file", () => {
        const extra = { "extra-file-id": { id: "extra-file-id", dataURL: "data:image/png;base64,xyz" } };
        const result = buildInitialData(DATA_URL, 100, 100, [], extra);
        const files = result.files as Record<string, any>;
        expect(files["extra-file-id"]).toBeDefined();
        expect(files["ann-bg-img"]).toBeDefined();
    });

    it("sets dark background color in appState", () => {
        const result = buildInitialData(DATA_URL, 100, 100, []);
        expect((result.appState as any).viewBackgroundColor).toBe("#121212");
    });

    it("locks the background element so it cannot be moved", () => {
        const result = buildInitialData(DATA_URL, 100, 100, []);
        expect((result.elements as any[])[0].locked).toBe(true);
    });
});
