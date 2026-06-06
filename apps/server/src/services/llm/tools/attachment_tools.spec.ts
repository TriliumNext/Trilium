import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAttachmentMock, getBlobMock } = vi.hoisted(() => ({
    getAttachmentMock: vi.fn(),
    getBlobMock: vi.fn()
}));

// Attachment + blob lookups go through SQL in the real becca; partial-mock core
// so these two return deterministic stubs while the rest of core is untouched.
vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    return {
        ...actual,
        becca: { ...actual.becca, getAttachment: getAttachmentMock, getBlob: getBlobMock }
    };
});

import { attachmentTools } from "./attachment_tools.js";
import type { ToolDefinition } from "./tool_registry.js";

function getTool(name: string): ToolDefinition {
    for (const [n, def] of attachmentTools) {
        if (n === name) return def;
    }
    throw new Error(`Tool ${name} not registered`);
}

function stubAttachment(overrides: Record<string, unknown>) {
    return {
        attachmentId: "att1",
        ownerId: "note1",
        role: "file",
        mime: "text/plain",
        title: "doc.txt",
        dateModified: "2026-01-01",
        contentLength: 12,
        blobId: "blob1",
        hasStringContent: () => true,
        getContent: () => "plain text",
        ...overrides
    };
}

describe("attachment_tools", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("get_attachment", () => {
        it("returns attachment metadata", () => {
            getAttachmentMock.mockReturnValue(stubAttachment({}));
            expect(getTool("get_attachment").execute({ attachmentId: "att1" })).toEqual({
                attachmentId: "att1",
                ownerId: "note1",
                role: "file",
                mime: "text/plain",
                title: "doc.txt",
                dateModified: "2026-01-01",
                contentLength: 12
            });
        });

        it("returns an error when the attachment is missing", () => {
            getAttachmentMock.mockReturnValue(null);
            expect(getTool("get_attachment").execute({ attachmentId: "missing" }))
                .toEqual({ error: "Attachment not found" });
        });
    });

    describe("get_attachment_content", () => {
        it("returns the text content for a string attachment", () => {
            getAttachmentMock.mockReturnValue(stubAttachment({ getContent: () => "hello world" }));
            expect(getTool("get_attachment_content").execute({ attachmentId: "att1" })).toEqual({
                attachmentId: "att1",
                source: "text",
                content: "hello world"
            });
        });

        it("falls back to OCR/extracted text from the blob for binary attachments", () => {
            getAttachmentMock.mockReturnValue(stubAttachment({
                hasStringContent: () => false,
                mime: "image/png",
                blobId: "blob1"
            }));
            getBlobMock.mockReturnValue({ textRepresentation: "OCR extracted" });

            expect(getTool("get_attachment_content").execute({ attachmentId: "att1" })).toEqual({
                attachmentId: "att1",
                source: "ocr",
                content: "OCR extracted"
            });
        });

        it("returns an error for binary attachments with no readable text (no blobId, or empty blob)", () => {
            // No blobId at all → getBlob is never consulted.
            getAttachmentMock.mockReturnValue(stubAttachment({
                hasStringContent: () => false,
                blobId: null
            }));
            expect(getTool("get_attachment_content").execute({ attachmentId: "att1" }))
                .toEqual({ error: "Attachment has no readable text content" });

            // Has a blob, but it carries no extracted text.
            getAttachmentMock.mockReturnValue(stubAttachment({
                hasStringContent: () => false,
                blobId: "blob1"
            }));
            getBlobMock.mockReturnValue({ textRepresentation: null });
            expect(getTool("get_attachment_content").execute({ attachmentId: "att1" }))
                .toEqual({ error: "Attachment has no readable text content" });
        });

        it("returns an error when the attachment is missing", () => {
            getAttachmentMock.mockReturnValue(null);
            expect(getTool("get_attachment_content").execute({ attachmentId: "missing" }))
                .toEqual({ error: "Attachment not found" });
        });
    });
});
