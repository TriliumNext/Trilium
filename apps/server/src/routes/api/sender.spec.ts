import { cls } from "@triliumnext/core";
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
        expect((result as { noteId: string }).noteId).toBeTruthy();
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
            expect(result.noteId).toBeTruthy();
            expect(result.branchId).toBeTruthy();
        });
    });
});
