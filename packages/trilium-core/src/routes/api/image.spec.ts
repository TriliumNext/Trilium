import { beforeAll, describe, expect, it } from "vitest";

import becca from "../../becca/becca.js";
import * as cls from "../../services/context.js";
import { getSql } from "../../services/sql/index.js";
import { unwrapStringOrBuffer } from "../../services/utils/binary.js";
import { note as mockNote } from "../../test/becca_mocking.js";
import { createTextNote } from "../../test/api_fixtures.js";
import { CoreApiTester } from "../../test/api_tester.js";
import { renderSvgAttachment } from "./image.js";

/**
 * Drives the shared core image routes through {@link CoreApiTester} (no Express),
 * so this spec runs under both the node and standalone (WASM) suites. The image
 * handlers write directly to the tester's stream-backed mock response, so the
 * full route lifecycle runs end to end on both runtimes.
 *
 * Wherever feasible the routes are driven against REAL notes/attachments
 * (created through the core API and becca) and the REAL image service rather
 * than fake becca entities, so the production code paths are genuinely covered.
 */
let api: CoreApiTester;

/** A real minimal PNG: the 8-byte PNG signature followed by a few bytes. */
const PNG_BYTES = Buffer.from([ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03 ]);

/**
 * Creates a real note (via the core API) and then, inside a cls/SQL context,
 * mutates it into the requested image-like shape: sets its `type`/`mime`,
 * replaces its content, and saves any requested attachments. Returns the noteId.
 */
async function createImageNote({
    type = "image",
    mime = "image/png",
    content,
    attachments = []
}: {
    type?: string;
    mime?: string;
    content?: string | Buffer;
    attachments?: { title: string; content: string | Buffer; role?: string; mime?: string }[];
}): Promise<string> {
    const { noteId } = await createTextNote(api);

    cls.init(() =>
        getSql().transactional(() => {
            const note = becca.getNoteOrThrow(noteId);
            note.type = type as never;
            note.mime = mime;
            note.save();
            if (content !== undefined) {
                note.setContent(content, { forceSave: true });
            }
            for (const att of attachments) {
                note.saveAttachment(
                    {
                        role: att.role ?? "image",
                        mime: att.mime ?? "image/svg+xml",
                        title: att.title,
                        content: att.content as never
                    },
                    "title"
                );
            }
        })
    );

    return noteId;
}

describe("Image API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    describe("renderSvgAttachment (direct)", () => {
        it("renders an empty default SVG when there is no attachment or legacy content", () => {
            // A bare real note (no attachment, no JSON svg key) hits the empty default.
            const parentNote = mockNote("note").note;
            const response = new MockResponse();
            renderSvgAttachment(parentNote, response as never, "attachment");
            expect(response.headers["Content-Type"]).toBe("image/svg+xml");
            expect(response.body).toBe(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`);
        });
    });

    describe("returnImageFromNote (GET /api/images/:noteId/:filename)", () => {
        it("404s when the note does not exist", async () => {
            const res = await api.get("/api/images/missingNote123/file.png");
            expect(res.status).toBe(404);
        });

        it("400s when the note is not an image type", async () => {
            const { noteId } = await createTextNote(api);
            const res = await api.get(`/api/images/${noteId}/file.png`);
            expect(res.status).toBe(400);
        });

        it("serves a real raster image with the right bytes and headers", async () => {
            const noteId = await createImageNote({ mime: "image/png", content: PNG_BYTES });
            const res = await api.get(`/api/images/${noteId}/file.png`);
            expect(res.status).toBe(200);
            expect(res.headers["Content-Type"]).toBe("image/png");
            expect(res.headers["Cache-Control"]).toContain("no-cache");
            expect(Buffer.from(res.body as Buffer)).toEqual(PNG_BYTES);
        });

        it("sanitizes a real SVG image note", async () => {
            const noteId = await createImageNote({
                mime: "image/svg+xml",
                content: "<svg><script>alert(1)</script><rect/></svg>"
            });
            const res = await api.get<string>(`/api/images/${noteId}/file.svg`);
            expect(res.status).toBe(200);
            expect(res.headers["Content-Type"]).toBe("image/svg+xml");
            expect(res.headers["Content-Security-Policy"]).toContain("default-src 'none'");
            expect(res.body).not.toContain("alert(1)");
            expect(res.body).toContain("<svg");
        });

        it.each([
            [ "canvas", "canvas-export.svg" ],
            [ "mermaid", "mermaid-export.svg" ],
            [ "mindMap", "mindmap-export.svg" ]
        ])("renders a real %s note from its SVG attachment", async (type, attachmentTitle) => {
            const noteId = await createImageNote({
                type,
                mime: "application/json",
                attachments: [ { title: attachmentTitle, content: `<svg id='${type}'><script>alert(9)</script></svg>` } ]
            });
            const res = await api.get<string>(`/api/images/${noteId}/file.svg`);
            expect(res.status).toBe(200);
            expect(res.headers["Content-Type"]).toBe("image/svg+xml");
            expect(res.headers["Content-Security-Policy"]).toContain("default-src 'none'");
            expect(res.body).toContain(type);
            expect(res.body).toContain("<svg");
            expect(res.body).not.toContain("alert(9)");
        });

        it("falls back to the legacy svg key in the note content", async () => {
            // No attachment, but the note JSON content carries a legacy `svg` key.
            const noteId = await createImageNote({
                type: "canvas",
                mime: "application/json",
                content: JSON.stringify({ svg: "<svg id='legacy'></svg>" })
            });
            const res = await api.get<string>(`/api/images/${noteId}/file.svg`);
            expect(res.status).toBe(200);
            expect(res.headers["Content-Type"]).toBe("image/svg+xml");
            expect(res.body).toContain("legacy");
        });

        it("renders the empty default SVG when a canvas note has no attachment or legacy content", async () => {
            const noteId = await createImageNote({ type: "canvas", mime: "application/json", content: "" });
            const res = await api.get<string>(`/api/images/${noteId}/file.svg`);
            expect(res.status).toBe(200);
            expect(res.headers["Content-Type"]).toBe("image/svg+xml");
            expect(res.body).toBe(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`);
        });

        it("renders a real spreadsheet note from its PNG attachment", async () => {
            const noteId = await createImageNote({
                type: "spreadsheet",
                mime: "application/json",
                attachments: [ { title: "spreadsheet-export.png", role: "image", mime: "image/png", content: PNG_BYTES } ]
            });
            const res = await api.get(`/api/images/${noteId}/file.png`);
            expect(res.status).toBe(200);
            expect(res.headers["Content-Type"]).toBe("image/png");
            expect(Buffer.from(res.body as Buffer)).toEqual(PNG_BYTES);
        });

        it("404s rendering a spreadsheet note without the PNG attachment", async () => {
            const noteId = await createImageNote({ type: "spreadsheet", mime: "application/json" });
            const res = await api.get(`/api/images/${noteId}/file.png`);
            expect(res.status).toBe(404);
        });
    });

    describe("returnImageFromRevision (GET /api/revisions/:revisionId/image/:filename)", () => {
        it("serves a raster image from a real revision", async () => {
            const noteId = await createImageNote({ mime: "image/png", content: PNG_BYTES });
            const res = await api.post<{ revisionId: string }>(`/api/notes/${noteId}/revision`, {
                body: { description: "snapshot" }
            });
            expect(res.status).toBe(200);

            const imgRes = await api.get(`/api/revisions/${res.body.revisionId}/image/file.png`);
            expect(imgRes.status).toBe(200);
            expect(imgRes.headers["Content-Type"]).toBe("image/png");
            expect(Buffer.from(imgRes.body as Buffer)).toEqual(PNG_BYTES);
        });
    });

    describe("returnAttachedImage (GET /api/attachments/:attachmentId/image/:filename)", () => {
        /** Saves an attachment on a fresh note and returns its attachmentId. */
        async function createAttachment(
            { role = "image", mime = "image/png", content = PNG_BYTES as string | Buffer } = {}
        ): Promise<string> {
            const { noteId } = await createTextNote(api);
            return cls.init(() =>
                getSql().transactional(() => {
                    const note = becca.getNoteOrThrow(noteId);
                    const attachment = note.saveAttachment(
                        { role, mime, title: "att", content: content as never },
                        "title"
                    );
                    return attachment.attachmentId as string;
                })
            );
        }

        it("404s when the attachment does not exist", async () => {
            const res = await api.get("/api/attachments/missingAtt123/image/file.png");
            expect(res.status).toBe(404);
        });

        it("400s when the attachment role is not image", async () => {
            const attachmentId = await createAttachment({ role: "file", mime: "text/plain", content: "hi" });
            const res = await api.get<string>(`/api/attachments/${attachmentId}/image/file.png`);
            expect(res.status).toBe(400);
            expect(res.headers["Content-Type"]).toBe("text/plain");
        });

        it("serves a real raster attachment image", async () => {
            const attachmentId = await createAttachment({ mime: "image/png", content: PNG_BYTES });
            const res = await api.get(`/api/attachments/${attachmentId}/image/file.png`);
            expect(res.status).toBe(200);
            expect(res.headers["Content-Type"]).toBe("image/png");
            expect(Buffer.from(res.body as Buffer)).toEqual(PNG_BYTES);
        });

        it("sanitizes a real SVG attachment image", async () => {
            const attachmentId = await createAttachment({
                mime: "image/svg+xml",
                content: "<svg><script>alert(2)</script></svg>"
            });
            const res = await api.get<string>(`/api/attachments/${attachmentId}/image/file.svg`);
            expect(res.status).toBe(200);
            expect(res.headers["Content-Type"]).toBe("image/svg+xml");
            expect(res.headers["Content-Security-Policy"]).toContain("default-src 'none'");
            expect(unwrapStringOrBuffer(res.body as never)).not.toContain("alert(2)");
        });
    });

    describe("updateImage (PUT /api/images/:noteId) — real image service", () => {
        it("reports a missing file", async () => {
            const { noteId } = await createTextNote(api);
            const res = await api.put<{ uploaded: boolean; message: string }>(`/api/images/${noteId}`);
            expect(res.status).toBe(200);
            expect(res.body.uploaded).toBe(false);
            expect(res.body.message).toContain("Missing image data");
        });

        it("rejects an unknown mime type", async () => {
            const { noteId } = await createTextNote(api);
            const res = await api.put<{ uploaded: boolean }>(`/api/images/${noteId}`, {
                file: { originalname: "x.txt", mimetype: "text/plain", buffer: Buffer.from([ 1 ]), size: 1 }
            });
            expect(res.status).toBe(200);
            expect(res.body.uploaded).toBe(false);
        });

        it("rejects a file whose buffer is a string", async () => {
            const { noteId } = await createTextNote(api);
            const res = await api.put<{ uploaded: boolean }>(`/api/images/${noteId}`, {
                file: { originalname: "x.png", mimetype: "image/png", buffer: "not-a-buffer", size: 1 }
            });
            expect(res.status).toBe(200);
            expect(res.body.uploaded).toBe(false);
        });

        it("updates the image on success via the real image service", async () => {
            const { noteId } = await createTextNote(api);
            const res = await api.put<{ uploaded: boolean }>(`/api/images/${noteId}`, {
                file: { originalname: "x.png", mimetype: "image/png", buffer: PNG_BYTES, size: PNG_BYTES.length }
            });
            expect(res.status).toBe(200);
            expect(res.body.uploaded).toBe(true);
            // The real service synchronously snapshots a revision and sets the label.
            cls.init(() => {
                expect(becca.getNoteOrThrow(noteId).getOwnedLabelValue("originalFileName")).toBe("x.png");
            });
        });
    });

    it("sets Content-Security-Policy header on SVG responses", () => {
        const parentNote = mockNote("note").note;
        const response = new MockResponse();
        renderSvgAttachment(parentNote, response as any, "attachment");
        expect(response.headers["Content-Security-Policy"]).toBeDefined();
        expect(response.headers["Content-Security-Policy"]).toContain("default-src 'none'");
    });

    it("sets X-Content-Type-Options header on SVG responses", () => {
        const parentNote = mockNote("note").note;
        const response = new MockResponse();
        renderSvgAttachment(parentNote, response as any, "attachment");
        expect(response.headers["X-Content-Type-Options"]).toBe("nosniff");
    });
});

class MockResponse {

    body?: string;
    headers: Record<string, string> = {};

    set(name: string, value: string) {
        this.headers[name] = value;
    }

    send(body: string) {
        this.body = body;
    }

}
