import type { LlmModelInfo } from "@triliumnext/commons";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../services/i18n.js", () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key)
}));

import { acceptAttrFor, getAttachmentLightbox, uploadRefusal } from "./useChatAttachments";

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

describe("attachments a model cannot read", () => {
    const textOnly: LlmModelInfo = { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", attachmentKinds: [] };
    const imagesOnly: LlmModelInfo = { id: "codex", name: "Codex", attachmentKinds: [ "image" ] };
    const file = (name: string, type: string) => new File([ "x" ], name, { type });

    it("offers in the file picker only what the model reads, plus SVGs and text files", () => {
        const accepted = (model?: LlmModelInfo) => acceptAttrFor(model).split(",");
        expect(accepted()).toEqual(expect.arrayContaining([ "image/png", "application/pdf", "image/svg+xml", ".md" ]));
        expect(accepted(imagesOnly)).toContain("image/png");
        expect(accepted(imagesOnly)).not.toContain("application/pdf");
        expect(accepted(textOnly)).toEqual(expect.arrayContaining([ "image/svg+xml", ".md" ]));
        expect(accepted(textOnly)).not.toContain("image/png");
        expect(accepted(textOnly)).not.toContain("application/pdf");
    });

    it("refuses an upload the model cannot read, naming the file and the reason", () => {
        expect(uploadRefusal(textOnly, file("report.pdf", "application/pdf"), "binary_file"))
            .toBe(`llm_chat.attachment_refused {"name":"report.pdf","reason":"llm_chat.attachment_model_cannot_read_file {\\"model\\":\\"DeepSeek V4 Pro\\"}"}`);
        expect(uploadRefusal(textOnly, file("cat.png", "image/png"), "image")).toContain("attachment_model_cannot_read_image");

        // Text files, SVGs, a model that reads the kind, and no model at all go through.
        expect(uploadRefusal(textOnly, file("notes.md", "text/markdown"), "text_file")).toBeUndefined();
        expect(uploadRefusal(textOnly, file("d.svg", "image/svg+xml"), "image")).toBeUndefined();
        expect(uploadRefusal(imagesOnly, file("cat.png", "image/png"), "image")).toBeUndefined();
        expect(uploadRefusal(undefined, file("report.pdf", "application/pdf"), "binary_file")).toBeUndefined();
    });
});
