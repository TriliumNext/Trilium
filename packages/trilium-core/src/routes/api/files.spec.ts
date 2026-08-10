import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";

import becca from "../../becca/becca.js";
import * as cls from "../../services/context.js";
import protectedSessionService from "../../services/protected_session";
import { getSql } from "../../services/sql/index.js";
import { encodeUtf8 } from "../../services/utils/binary";
import { createTextNote } from "../../test/api_fixtures";
import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared core file/attachment download routes through
 * {@link CoreApiTester} (no Express). These handlers write directly to the
 * response via `res.send(...)`, so the driver captures their status, headers
 * and (JSON round-tripped) body. The spec runs under both the node and
 * standalone (WASM) suites.
 */
let api: CoreApiTester;

interface AttachmentPojo {
    attachmentId: string;
    title: string;
    mime: string;
}

describe("Files API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    describe("note download/open", () => {
        it("downloads the content of a note with the content-type header", async () => {
            const { noteId } = await createTextNote(api, { content: "<p>downloadable</p>" });

            const res = await api.get<string>(`/api/notes/${noteId}/download`);
            expect(res.status).toBe(200);
            expect(res.body).toContain("downloadable");
            expect(res.headers["Content-Type"]).toBeTruthy();
            expect(res.headers["Content-Disposition"]).toBeTruthy();
        });

        it("opens a note inline without a content-disposition header", async () => {
            const { noteId } = await createTextNote(api, { content: "<p>inline view</p>" });

            const res = await api.get<string>(`/api/notes/${noteId}/open`);
            expect(res.status).toBe(200);
            expect(res.body).toContain("inline view");
            expect(res.headers["Content-Disposition"]).toBeUndefined();
        });

        it("supports the legacy /api/notes/download/:noteId path", async () => {
            const { noteId } = await createTextNote(api, { content: "<p>legacy</p>" });

            const res = await api.get<string>(`/api/notes/download/${noteId}`);
            expect(res.status).toBe(200);
            expect(res.body).toContain("legacy");
        });

        it("404s when downloading a missing note", async () => {
            const res = await api.get("/api/notes/missingNote123/download");
            expect(res.status).toBe(404);
        });

        it("401s when downloading a protected note without an active protected session", async () => {
            const { noteId } = await createTextNote(api, { content: "<p>secret</p>" });

            // Protecting a note needs the data key; dropping it afterwards leaves exactly the
            // state the download guard rejects (protected note + no protected session).
            protectedSessionService.setDataKey(encodeUtf8("0123456789abcdef")); // exactly 16 bytes
            try {
                expect((await api.put(`/api/notes/${noteId}/protect/1`)).status).toBe(204);
            } finally {
                protectedSessionService.resetDataKey();
            }

            const res = await api.get(`/api/notes/${noteId}/download`);
            expect(res.status).toBe(401);
        });
    });

    describe("attachment download/open", () => {
        async function createAttachment(): Promise<{ noteId: string; attachmentId: string }> {
            const { noteId } = await createTextNote(api, { title: "Has attachment" });

            const save = await api.post(`/api/notes/${noteId}/attachments`, {
                body: {
                    role: "file",
                    mime: "text/plain",
                    title: "attachment.txt",
                    content: "attachment payload"
                }
            });
            expect(save.status).toBe(204);

            const list = await api.get<AttachmentPojo[]>(`/api/notes/${noteId}/attachments`);
            expect(list.status).toBe(200);
            expect(list.body.length).toBeGreaterThan(0);

            return { noteId, attachmentId: list.body[0].attachmentId };
        }

        it("downloads an attachment created via the API", async () => {
            const { attachmentId } = await createAttachment();

            const res = await api.get<string>(`/api/attachments/${attachmentId}/download`);
            expect(res.status).toBe(200);
            expect(res.body).toContain("attachment payload");
            expect(res.headers["Content-Disposition"]).toBeTruthy();
        });

        it("opens an attachment inline without a content-disposition header", async () => {
            const { attachmentId } = await createAttachment();

            const res = await api.get<string>(`/api/attachments/${attachmentId}/open`);
            expect(res.status).toBe(200);
            expect(res.body).toContain("attachment payload");
            expect(res.headers["Content-Disposition"]).toBeUndefined();
        });

        it("404s when downloading a missing attachment", async () => {
            const res = await api.get("/api/attachments/missingAttachment123/download");
            expect(res.status).toBe(404);
        });
    });

    /**
     * Writing a file back over a note or an attachment: "upload new revision" on a file note, the
     * PDF viewer saving its annotations, and replacing an attachment's file. The upload arrives as
     * `req.file` — multipart parsed by multer on the server, by the router itself in standalone.
     */
    describe("file uploads", () => {
        async function createFileNote(content = "original"): Promise<string> {
            const res = await api.post<{ note: { noteId: string } }>("/api/notes/root/children?target=into", {
                body: { title: "notes.txt", type: "file", mime: "text/plain", content }
            });
            expect(res.status).toBe(200);
            return res.body.note.noteId;
        }

        function upload(content: string, mimetype = "text/plain", originalname = "new.txt") {
            return { buffer: encodeUtf8(content), mimetype, originalname };
        }

        async function revisionCount(noteId: string): Promise<number> {
            const res = await api.get<unknown[]>(`/api/notes/${noteId}/revisions`);
            return res.body.length;
        }

        it("writes an uploaded file over a note, normalising the mime and recording the file name", async () => {
            const noteId = await createFileNote();

            const res = await api.put(`/api/notes/${noteId}/file`, { file: upload("replaced", "TEXT/Plain") });
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ uploaded: true });

            const note = becca.getNoteOrThrow(noteId);
            expect(note.getContent().toString()).toBe("replaced");
            expect(note.mime).toBe("text/plain");
            expect(note.getOwnedLabelValue("originalFileName")).toBe("new.txt");
        });

        it("keeps a revision of what it replaced, unless the caller asks to replace outright", async () => {
            const kept = await createFileNote();
            expect(await revisionCount(kept)).toBe(0);
            await api.put(`/api/notes/${kept}/file`, { file: upload("v2") });
            expect(await revisionCount(kept)).toBe(1);

            // `replace=1` is for an editor saving its own work, which would otherwise bury the note
            // in revisions — one per save.
            const replaced = await createFileNote();
            await api.put(`/api/notes/${replaced}/file?replace=1`, { file: upload("v2") });
            expect(await revisionCount(replaced)).toBe(0);
            expect(becca.getNoteOrThrow(replaced).getContent().toString()).toBe("v2");
        });

        it("replaces an attachment's file, keeping a revision of the note holding it", async () => {
            const noteId = await createFileNote();
            expect((await api.post(`/api/notes/${noteId}/attachments`, {
                body: { role: "file", mime: "text/plain", title: "att.txt", content: "att-data" }
            })).status).toBe(204);
            const list = await api.get<AttachmentPojo[]>(`/api/notes/${noteId}/attachments`);
            const { attachmentId } = list.body[0];

            const res = await api.put(`/api/attachments/${attachmentId}/file`, { file: upload("new-att") });
            expect(res.body).toEqual({ uploaded: true });
            expect(becca.getAttachmentOrThrow(attachmentId).getContent().toString()).toBe("new-att");
            expect(await revisionCount(noteId)).toBe(1);
        });

        it("reports a request that carries no file instead of writing an empty one", async () => {
            const noteId = await createFileNote();

            const res = await api.put(`/api/notes/${noteId}/file`);
            expect(res.body).toEqual({ uploaded: false, message: "Missing file." });
            expect(becca.getNoteOrThrow(noteId).getContent().toString()).toBe("original");
        });
    });

    /**
     * What the audio/video players stream from. A media element seeks by re-requesting a byte range,
     * so these have to answer 206 with exactly the slice asked for — a full body every time would
     * make seeking pull the whole file down again.
     */
    describe("byte-range streaming (open-partial)", () => {
        const PAYLOAD = "0123456789";

        async function createMediaNote(): Promise<string> {
            const res = await api.post<{ note: { noteId: string } }>("/api/notes/root/children?target=into", {
                body: { title: "clip.mp3", type: "file", mime: "audio/mpeg", content: PAYLOAD }
            });
            expect(res.status).toBe(200);
            return res.body.note.noteId;
        }

        function bodyOf(body: unknown): string {
            return Buffer.isBuffer(body) ? body.toString("utf8") : String(body);
        }

        it("serves a note's full content, advertising range support", async () => {
            const noteId = await createMediaNote();

            const res = await api.get(`/api/notes/${noteId}/open-partial`);
            expect(res.status).toBe(200);
            expect(bodyOf(res.body)).toBe(PAYLOAD);
            expect(res.headers["Accept-Ranges"]).toBe("bytes");
            expect(res.headers["Content-Type"]).toBe("audio/mpeg");
            // The ETag is the blobId, so it moves only when the content does.
            expect(res.headers.ETag).toMatch(/^".+"$/);
        });

        it("serves a requested range of a note as 206", async () => {
            const noteId = await createMediaNote();

            const res = await api.get(`/api/notes/${noteId}/open-partial`, { headers: { range: "bytes=3-6" } });
            expect(res.status).toBe(206);
            expect(bodyOf(res.body)).toBe("3456");
            expect(res.headers["Content-Range"]).toBe("bytes 3-6/10");
            expect(res.headers["Content-Length"]).toBe("4");
        });

        it("serves a requested range of an attachment as 206", async () => {
            const { noteId } = await createTextNote(api, { title: "Has media attachment" });
            expect((await api.post(`/api/notes/${noteId}/attachments`, {
                body: { role: "file", mime: "audio/mpeg", title: "clip.mp3", content: PAYLOAD }
            })).status).toBe(204);
            const list = await api.get<AttachmentPojo[]>(`/api/notes/${noteId}/attachments`);
            const { attachmentId } = list.body[0];

            const res = await api.get(`/api/attachments/${attachmentId}/open-partial`, { headers: { range: "bytes=-2" } });
            expect(res.status).toBe(206);
            expect(bodyOf(res.body)).toBe("89");
            expect(res.headers["Content-Range"]).toBe("bytes 8-9/10");
        });

        it("416s on a range past the end of the content", async () => {
            const noteId = await createMediaNote();

            const res = await api.get(`/api/notes/${noteId}/open-partial`, { headers: { range: "bytes=99-120" } });
            expect(res.status).toBe(416);
            expect(res.headers["Content-Range"]).toBe("bytes */10");
        });

        it("404s for a missing note or attachment", async () => {
            expect((await api.get("/api/notes/missingNote123/open-partial")).status).toBe(404);
            expect((await api.get("/api/attachments/missingAttachment123/open-partial")).status).toBe(404);
        });
    });

    describe("office preview", () => {
        // RTF is the only office format that can be created inline as plain text, which makes
        // it ideal to exercise the real officeparser conversion in both runtimes. It also
        // covers the explicit fileType hint path (RTF auto-detection is unreliable).
        const RTF_CONTENT = String.raw`{\rtf1\ansi Hello {\b World}}`;

        async function createRtfNote(): Promise<string> {
            const res = await api.post<{ note: { noteId: string } }>("/api/notes/root/children?target=into", {
                body: { title: "document.rtf", type: "file", mime: "application/rtf", content: RTF_CONTENT }
            });
            expect(res.status).toBe(200);
            return res.body.note.noteId;
        }

        it("converts an RTF file note to an embeddable HTML fragment", async () => {
            const noteId = await createRtfNote();

            const res = await api.get<{ html: string }>(`/api/notes/${noteId}/office-preview`);
            expect(res.status).toBe(200);
            expect(res.body.html).toContain("Hello");
            expect(res.body.html).toContain("World");
            // fragment mode — no full standalone document wrapper
            expect(res.body.html).not.toContain("<html");
        });

        it("converts an RTF attachment to an embeddable HTML fragment", async () => {
            const { noteId } = await createTextNote(api, { title: "Has office attachment" });
            const save = await api.post(`/api/notes/${noteId}/attachments`, {
                body: { role: "file", mime: "application/rtf", title: "attachment.rtf", content: RTF_CONTENT }
            });
            expect(save.status).toBe(204);
            const list = await api.get<AttachmentPojo[]>(`/api/notes/${noteId}/attachments`);

            const res = await api.get<{ html: string }>(`/api/attachments/${list.body[0].attachmentId}/office-preview`);
            expect(res.status).toBe(200);
            expect(res.body.html).toContain("Hello");
        });

        it("rejects an unsupported MIME type with 400", async () => {
            const { noteId } = await createTextNote(api, { content: "<p>not office</p>" });

            const res = await api.get(`/api/notes/${noteId}/office-preview`);
            expect(res.status).toBe(400);
        });

        it("404s for a missing note", async () => {
            const res = await api.get("/api/notes/missingNote123/office-preview");
            expect(res.status).toBe(404);
        });

        it("renders an XLSX note through the native spreadsheet pipeline", async () => {
            const wb = new ExcelJS.Workbook();
            const sheet = wb.addWorksheet("Data");
            sheet.getCell("A1").value = "Merged header";
            sheet.mergeCells("A1:B1");
            const amount = sheet.getCell("A2");
            amount.value = 1234.5;
            amount.numFmt = "#,##0.00";
            amount.border = { top: { style: "thin" }, bottom: { style: "thin" } };
            const xlsxBuffer = Buffer.from(await wb.xlsx.writeBuffer());

            const noteId = await createXlsxNote(xlsxBuffer);

            const res = await api.get<{ html: string }>(`/api/notes/${noteId}/office-preview`);
            expect(res.status).toBe(200);
            expect(res.body.html).toContain("Merged header");
            // Native-renderer features officeparser's grid lacks: merged cells,
            // number formatting (numfmt) and inline borders...
            expect(res.body.html).toContain('colspan="2"');
            expect(res.body.html).toContain("1,234.50");
            expect(res.body.html).toContain("border");
            // ...and none of officeparser's class-styled A/B/C header chrome.
            expect(res.body.html).not.toContain("excel-col-header");
        });
    });
});

/**
 * Creates a file note holding a binary `.xlsx` workbook. The JSON note-creation API cannot
 * carry binary content, so the note is created empty through the API and the buffer is
 * written through becca (same pattern as the image route spec).
 */
async function createXlsxNote(xlsxBuffer: Buffer): Promise<string> {
    const res = await api.post<{ note: { noteId: string } }>("/api/notes/root/children?target=into", {
        body: {
            title: "workbook.xlsx",
            type: "file",
            mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            content: ""
        }
    });
    expect(res.status).toBe(200);
    const noteId = res.body.note.noteId;

    cls.init(() =>
        getSql().transactional(() => {
            becca.getNoteOrThrow(noteId).setContent(xlsxBuffer, { forceSave: true });
        })
    );

    return noteId;
}
