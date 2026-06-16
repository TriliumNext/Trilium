import { becca, cls, note_service as noteService, ValidationError } from "@triliumnext/core";
import type { Request } from "express";
import fs from "fs";
import { Readable } from "stream";
import { beforeAll, describe, expect, it } from "vitest";

import filesRoute from "./files.js";

let noteId: string;
let attachmentId: string;

function fileReq(params: Record<string, string>, file?: unknown, query: Record<string, string> = {}, body: Record<string, unknown> = {}) {
    return { params, file, query, body } as unknown as Request<{ noteId: string }>;
}

async function streamToString(stream: Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
}

describe("Files API", () => {
    beforeAll(() => {
        cls.init(() => {
            const { note } = noteService.createNewNote({
                parentNoteId: "root", title: "File note", type: "file", mime: "text/plain", content: "original"
            });
            noteId = note.noteId;
            const attachment = note.saveAttachment({ role: "file", mime: "text/plain", title: "att.txt", content: "att-data" });
            attachmentId = attachment.attachmentId;
        });
    });

    describe("updateFile", () => {
        it("reports a missing file", () => {
            expect(cls.init(() => filesRoute.updateFile(fileReq({ noteId })))).toEqual({ uploaded: false, message: "Missing file." });
        });

        it("replaces note content without a revision when replace=1", () => {
            const file = { buffer: Buffer.from("replaced"), mimetype: "TEXT/Plain", originalname: "new.txt" };
            const result = cls.init(() => filesRoute.updateFile(fileReq({ noteId }, file, { replace: "1" })));
            expect(result).toEqual({ uploaded: true });
            expect(becca.getNoteOrThrow(noteId).mime).toBe("text/plain");
        });

        it("saves a revision when not replacing", () => {
            const file = { buffer: Buffer.from("v2"), mimetype: "text/plain", originalname: "v2.txt" };
            expect(cls.init(() => filesRoute.updateFile(fileReq({ noteId }, file)))).toEqual({ uploaded: true });
        });
    });

    describe("updateAttachment", () => {
        it("reports a missing file", () => {
            const req = fileReq({ attachmentId } as Record<string, string>) as unknown as Request<{ attachmentId: string }>;
            expect(cls.init(() => filesRoute.updateAttachment(req))).toEqual({ uploaded: false, message: "Missing file." });
        });

        it("updates attachment content", () => {
            const file = { buffer: Buffer.from("new-att"), mimetype: "text/plain", originalname: "a.txt" };
            const req = fileReq({ attachmentId } as Record<string, string>, file) as unknown as Request<{ attachmentId: string }>;
            expect(cls.init(() => filesRoute.updateAttachment(req))).toEqual({ uploaded: true });
        });
    });

    describe("content providers", () => {
        it("streams full and ranged note content", async () => {
            const current = becca.getNoteOrThrow(noteId).getContent() as string;
            const provider = await filesRoute.fileContentProvider(fileReq({ noteId }));
            expect(provider.totalSize).toBe(Buffer.byteLength(current));
            expect(await streamToString(provider.getStream(undefined as never))).toBe(current);
            expect(await streamToString(provider.getStream({ start: 0, end: 0 }))).toBe(current.slice(0, 1));
        });

        it("streams attachment content", async () => {
            const req = fileReq({ attachmentId } as Record<string, string>) as unknown as Request<{ attachmentId: string }>;
            const provider = await filesRoute.attachmentContentProvider(req);
            expect(provider.mimeType).toBe("text/plain");
            expect(await streamToString(provider.getStream(undefined as never))).toBe("new-att");
        });
    });

    describe("temp-dir round trip", () => {
        it("saves a note to a temp file then uploads the modified content back", () => {
            const { tmpFilePath } = cls.init(() => filesRoute.saveNoteToTmpDir(fileReq({ noteId })));
            expect(fs.existsSync(tmpFilePath)).toBe(true);

            fs.writeFileSync(tmpFilePath, "edited-on-disk");
            cls.init(() => filesRoute.uploadModifiedFileToNote(fileReq({ noteId }, undefined, {}, { filePath: tmpFilePath })));
            expect(becca.getNoteOrThrow(noteId).getContent()).toBe("edited-on-disk");
        });

        it("saves an attachment to a temp file then uploads it back", () => {
            const req = fileReq({ attachmentId } as Record<string, string>) as unknown as Request<{ attachmentId: string }>;
            const { tmpFilePath } = cls.init(() => filesRoute.saveAttachmentToTmpDir(req));
            fs.writeFileSync(tmpFilePath, "edited-att");
            const uploadReq = fileReq({ attachmentId } as Record<string, string>, undefined, {}, { filePath: tmpFilePath }) as unknown as Request<{ attachmentId: string }>;
            cls.init(() => filesRoute.uploadModifiedFileToAttachment(uploadReq));
            expect(becca.getAttachmentOrThrow(attachmentId).getContent()).toBe("edited-att");
        });

        it("rejects uploading from an unknown temp path", () => {
            expect(() => cls.init(() => filesRoute.uploadModifiedFileToNote(
                fileReq({ noteId }, undefined, {}, { filePath: "/not/a/temp/file" })
            ))).toThrow(ValidationError);
            const req = fileReq({ attachmentId } as Record<string, string>, undefined, {}, { filePath: "/nope" }) as unknown as Request<{ attachmentId: string }>;
            expect(() => cls.init(() => filesRoute.uploadModifiedFileToAttachment(req))).toThrow(ValidationError);
        });
    });
});
