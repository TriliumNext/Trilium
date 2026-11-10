import { becca, cls } from "@triliumnext/core";
import type { Request } from "express";
import { describe, expect, it } from "vitest";

import senderRoute from "./sender.js";

// A real 9x16 PNG so image-type / sharp accept it.
const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAkAAAAQCAYAAADESFVDAAAAF0lEQVQoU2P8DwQMBADjqKLRIGAgKggAzHs/0SoYCGwAAAAASUVORK5CYII=",
    "base64"
);

function imageReq(opts: { file?: unknown; headers?: Record<string, string> } = {}) {
    return { file: opts.file, headers: opts.headers ?? {} } as unknown as Request;
}

describe("Sender API", () => {
    describe("uploadImage validation", () => {
        it("reports missing image data", async () => {
            expect(await senderRoute.uploadImage(imageReq())).toEqual({ uploaded: false, message: "Missing image data." });
        });

        it("rejects an unsupported mime type", async () => {
            const result = await senderRoute.uploadImage(imageReq({ file: { mimetype: "application/pdf", buffer: PNG } }));
            expect(result).toEqual([400, "Unknown image type: application/pdf"]);
        });

        it("rejects a string buffer", async () => {
            const result = await senderRoute.uploadImage(imageReq({ file: { mimetype: "image/png", buffer: "notabuffer" } }));
            expect(result).toEqual([400, "Invalid image content type."]);
        });

        it("rejects bytes that aren't a real image", async () => {
            const result = await senderRoute.uploadImage(imageReq({ file: { mimetype: "image/png", buffer: Buffer.from("nope") } }));
            expect(result).toEqual([400, "Unable to determine image type."]);
        });

        it("requires the x-local-date header", async () => {
            const result = await senderRoute.uploadImage(imageReq({ file: { mimetype: "image/png", buffer: PNG } }));
            expect(result).toEqual([400, "Invalid local date"]);
        });
    });

    it("uploads an image into the inbox with labels", async () => {
        const result = await cls.init(() => senderRoute.uploadImage(imageReq({
            file: { mimetype: "image/png", buffer: PNG },
            headers: { "x-local-date": "2025-01-01", "x-labels": JSON.stringify([{ name: "src", value: "phone" }]) }
        })));
        const note = becca.getNoteOrThrow((result as { noteId: string }).noteId);
        expect(note.type).toBe("image");
        expect(note.getLabelValue("src")).toBe("phone");
        expect(note.hasLabel("sentFromSender")).toBe(true);
    });

    it("uploads an image without custom labels when none are sent", async () => {
        const headerSets: Record<string, string>[] = [
            { "x-local-date": "2025-01-01" },
            { "x-local-date": "2025-01-01", "x-labels": "  " }
        ];
        for (const headers of headerSets) {
            const result = await cls.init(() => senderRoute.uploadImage(imageReq({
                file: { mimetype: "image/png", buffer: PNG },
                headers
            })));
            const note = becca.getNoteOrThrow((result as { noteId: string }).noteId);
            const labelNames = note.getOwnedAttributes("label").map(l => l.name).sort();
            expect(labelNames).toEqual([ "originalFileName", "sentFromSender" ]);
        }
    });

    describe("saveNote", () => {
        it("requires a valid x-local-date header", async () => {
            const req = { headers: {}, body: {} } as unknown as Request;
            expect(await senderRoute.saveNote(req)).toEqual([400, "Invalid local date"]);
        });

        it("creates a note in the inbox with labels", async () => {
            const req = {
                headers: { "x-local-date": "2025-01-01" },
                body: { title: "From phone", content: "<p>hi</p>", labels: [{ name: "src", value: "phone" }] }
            } as unknown as Request;
            const result = await cls.init(() => senderRoute.saveNote(req)) as { noteId: string; branchId: string };
            const note = becca.getNoteOrThrow(result.noteId);
            expect(note.title).toBe("From phone");
            expect(note.getLabelValue("src")).toBe("phone");
            expect(becca.getBranchOrThrow(result.branchId).noteId).toBe(result.noteId);
        });

        it("creates a note without labels when none are sent", async () => {
            const req = {
                headers: { "x-local-date": "2025-01-01" },
                body: { title: "Plain", content: "<p>hi</p>" }
            } as unknown as Request;
            const result = await cls.init(() => senderRoute.saveNote(req)) as { noteId: string };
            const note = becca.getNoteOrThrow(result.noteId);
            expect(note.title).toBe("Plain");
            expect(note.getOwnedAttributes("label")).toEqual([]);
        });
    });
});
