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
});
