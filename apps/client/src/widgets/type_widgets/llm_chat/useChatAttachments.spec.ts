import { describe, expect, it } from "vitest";

import { getAttachmentLightbox } from "./useChatAttachments";

describe("getAttachmentLightbox", () => {
    it("previews images and PDFs, and nothing else", () => {
        expect(getAttachmentLightbox({
            type: "image", attachmentId: "img1", mime: "image/png", title: "cat.png", url: "api/attachments/img1/image/cat.png"
        })).toEqual({ src: "api/attachments/img1/image/cat.png", title: "cat.png" });

        expect(getAttachmentLightbox({
            type: "file", attachmentId: "pdf1", mime: "application/pdf", title: "report.pdf", url: "#root/n1?attachmentId=pdf1"
        })).toEqual({ src: "/api/attachments/pdf1/open", kind: "pdf", title: "report.pdf" });

        expect(getAttachmentLightbox({
            type: "text_file", attachmentId: "txt1", mime: "text/plain", title: "notes.txt", url: "#root/n1?attachmentId=txt1"
        })).toBeUndefined();
    });
});
