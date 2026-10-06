import type { LlmModelInfo } from "@triliumnext/commons";
import { h } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ showError: vi.fn() }));
vi.mock("../../../services/i18n.js", () => ({
    t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key)
}));
vi.mock("../../../services/toast.js", () => ({ default: { showError: mocks.showError } }));

import { renderInto } from "../../../test/render";
import {
    acceptAttrFor, getAttachmentLightbox, getUnreadableReasons, uploadRefusal,
    type UseChatAttachmentsReturn, useChatAttachments
} from "./useChatAttachments";
import type { AttachmentBlock, UseLlmChatReturn } from "./useLlmChat";

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

    it("names why the model cannot read each pending attachment, and not the others", () => {
        const attachments: AttachmentBlock[] = [
            { type: "image", attachmentId: "img", mime: "image/png", title: "c.png", url: "u" },
            { type: "image", attachmentId: "svg", mime: "image/svg+xml", title: "d.svg", url: "u" },
            { type: "file", attachmentId: "pdf", mime: "application/pdf", title: "r.pdf", url: "u" },
            { type: "text_file", attachmentId: "txt", mime: "text/plain", title: "n.txt", url: "u" }
        ];
        expect([ ...getUnreadableReasons(imagesOnly, attachments) ]).toEqual([
            [ "pdf", `llm_chat.attachment_model_cannot_read_file {"model":"Codex"}` ]
        ]);
        expect([ ...getUnreadableReasons(textOnly, attachments).keys() ]).toEqual([ "img", "pdf" ]);
        expect(getUnreadableReasons(undefined, attachments).size).toBe(0);
    });

    it("keeps the picker and uploads to what the selected model reads", async () => {
        const chat = {
            chatNoteId: "chat1",
            availableModels: [ { ...textOnly, provider: "deepseek", providerId: "p1" } ],
            selectedModel: textOnly.id,
            selectedProvider: "deepseek",
            selectedProviderId: "p1",
            addPendingAttachment: vi.fn()
        } as unknown as UseLlmChatReturn;
        let result: UseChatAttachmentsReturn | undefined;
        function Harness() {
            result = useChatAttachments(chat);
            return null;
        }
        renderInto(h(Harness, {}));

        expect(result?.acceptAttr.split(",")).not.toContain("application/pdf");

        const input = document.createElement("input");
        Object.defineProperty(input, "files", { value: [ file("report.pdf", "application/pdf") ] });
        await act(async () => {
            await result?.handleFilePickerChange({ target: input } as unknown as Event);
        });
        expect(mocks.showError)
            .toHaveBeenCalledExactlyOnceWith(expect.stringContaining("attachment_refused"));
        expect(chat.addPendingAttachment).not.toHaveBeenCalled();
    });
});
