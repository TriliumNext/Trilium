import { describe, expect, it } from "vitest";

import { ATTACHMENT_API_RE, IMAGE_API_RE } from "./image_url_patterns.js";

describe("IMAGE_API_RE", () => {
    it("matches a root-relative image URL", () => {
        expect(IMAGE_API_RE.test("/api/images/abc123XYZ_/note.png")).toBe(true);
    });

    it("matches an image URL without a leading slash", () => {
        expect(IMAGE_API_RE.test("api/images/abc123/note.png")).toBe(true);
    });

    it("captures the note ID", () => {
        const m = "/api/images/myNote01/image.png".match(IMAGE_API_RE);
        expect(m?.[1]).toBe("myNote01");
    });

    it("does not match attachment URLs", () => {
        expect(IMAGE_API_RE.test("/api/attachments/abc123/image/file.png")).toBe(false);
    });

    it("does not match unrelated URLs", () => {
        expect(IMAGE_API_RE.test("https://example.com/images/photo.png")).toBe(false);
    });
});

describe("ATTACHMENT_API_RE", () => {
    it("matches a root-relative attachment image URL", () => {
        expect(ATTACHMENT_API_RE.test("/api/attachments/att001/image/file.png")).toBe(true);
    });

    it("matches an attachment URL without a leading slash", () => {
        expect(ATTACHMENT_API_RE.test("api/attachments/att001/image/file.png")).toBe(true);
    });

    it("captures the attachment ID", () => {
        const m = "/api/attachments/att_XYZ/image/file.png".match(ATTACHMENT_API_RE);
        expect(m?.[1]).toBe("att_XYZ");
    });

    it("does not match note image URLs", () => {
        expect(ATTACHMENT_API_RE.test("/api/images/abc123/note.png")).toBe(false);
    });

    it("does not match unrelated URLs", () => {
        expect(ATTACHMENT_API_RE.test("https://example.com/attachments/foo")).toBe(false);
    });
});
