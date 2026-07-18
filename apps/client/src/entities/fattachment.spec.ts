import { describe, expect, it, vi } from "vitest";

import type FBlob from "./fblob.js";
import type FNote from "./fnote.js";
import type { Froca } from "../services/froca-interface.js";
import FAttachment, { type FAttachmentRow } from "./fattachment.js";

describe("FAttachment", () => {
    it("registers itself into froca.attachments and exposes row fields", () => {
        const { froca } = buildFroca();
        const attachment = new FAttachment(froca, buildRow());

        expect(froca.attachments["att1"]).toBe(attachment);
        expect(attachment.attachmentId).toBe("att1");
        expect(attachment.ownerId).toBe("owner1");
        expect(attachment.role).toBe("image");
        expect(attachment.mime).toBe("image/png");
        expect(attachment.title).toBe("My attachment");
        expect(attachment.utcDateModified).toBe("2026-01-01 00:00:00.000Z");
        expect(attachment.utcDateScheduledForErasureSince).toBe("2026-02-01 00:00:00.000Z");
        expect(attachment.contentLength).toBe(42);
    });

    it("update() re-applies the row and re-registers the attachment", () => {
        const { froca } = buildFroca();
        const attachment = new FAttachment(froca, buildRow());

        attachment.update(buildRow({ title: "Renamed", contentLength: 7 }));

        expect(attachment.title).toBe("Renamed");
        expect(attachment.contentLength).toBe(7);
        expect(froca.attachments["att1"]).toBe(attachment);
    });

    it("getNote() returns the owner note from froca.notes", () => {
        const ownerNote = { noteId: "owner1" } as unknown as FNote;
        const { froca } = buildFroca({ notes: { owner1: ownerNote } });
        const attachment = new FAttachment(froca, buildRow());

        expect(attachment.getNote()).toBe(ownerNote);
    });

    it("getBlob() awaits froca.getBlob with the attachments entity type and id", async () => {
        const blob = { blobId: "blob1" } as unknown as FBlob;
        const { froca, getBlob } = buildFroca({ blob });
        const attachment = new FAttachment(froca, buildRow());

        const result = await attachment.getBlob();

        expect(result).toBe(blob);
        expect(getBlob).toHaveBeenCalledWith("attachments", "att1");
    });
});

function buildRow(overrides: Partial<FAttachmentRow> = {}): FAttachmentRow {
    return {
        attachmentId: "att1",
        ownerId: "owner1",
        role: "image",
        mime: "image/png",
        title: "My attachment",
        dateModified: "2026-01-01 00:00:00.000",
        utcDateModified: "2026-01-01 00:00:00.000Z",
        utcDateScheduledForErasureSince: "2026-02-01 00:00:00.000Z",
        contentLength: 42,
        ...overrides
    };
}

function buildFroca(opts: { notes?: Record<string, FNote>; blob?: FBlob | null } = {}) {
    const blob = opts.blob ?? null;
    const getBlob = vi.fn(async () => blob);
    const froca = {
        attachments: {},
        notes: opts.notes ?? {},
        getBlob
    } as unknown as Froca;

    return { froca, getBlob };
}
