import { beforeAll, describe, expect, it } from "vitest";

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
    });
});
