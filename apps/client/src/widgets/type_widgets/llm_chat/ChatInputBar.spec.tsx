import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ triggerEvent: vi.fn() }));
vi.mock("../../../components/app_context.js", () => ({ default: { triggerEvent: mocks.triggerEvent } }));

import { renderInto } from "../../../test/render";
import { PendingAttachmentChip } from "./ChatInputBar";
import type { AttachmentBlock } from "./useLlmChat";

const image: AttachmentBlock = { type: "image", attachmentId: "img", mime: "image/png", title: "cat.png", url: "api/attachments/img/image/cat.png" };
const text: AttachmentBlock = { type: "text_file", attachmentId: "txt", mime: "text/plain", title: "notes.txt", url: "#root/n1?attachmentId=txt" };

describe("PendingAttachmentChip", () => {
    it("marks an attachment the model cannot read, and opens a previewable one in the lightbox", () => {
        const onRemove = vi.fn();
        const chip = renderInto(<PendingAttachmentChip att={image} reason="Codex cannot read images" onRemove={onRemove} disabled={false} />)
            .querySelector(".llm-chat-attachment-chip");

        expect(chip?.classList.contains("llm-chat-attachment-chip-unreadable")).toBe(true);
        expect(chip?.getAttribute("title")).toBe("cat.png\nCodex cannot read images");
        expect(chip?.querySelector(".llm-chat-attachment-unreadable-icon")).not.toBeNull();

        const preview = chip?.querySelector<HTMLAnchorElement>("a.llm-chat-attachment-preview-link");
        expect(preview?.querySelector("img")).not.toBeNull();
        act(() => preview?.click());
        expect(mocks.triggerEvent).toHaveBeenCalledExactlyOnceWith("showLightbox", { src: image.url, title: "cat.png" });

        act(() => chip?.querySelector<HTMLButtonElement>(".llm-chat-attachment-remove")?.click());
        expect(onRemove).toHaveBeenCalledOnce();
    });

    it("shows a readable file without a preview link or a warning", () => {
        const chip = renderInto(<PendingAttachmentChip att={text} onRemove={vi.fn()} disabled />)
            .querySelector(".llm-chat-attachment-chip");

        expect(chip?.classList.contains("llm-chat-attachment-chip-unreadable")).toBe(false);
        expect(chip?.getAttribute("title")).toBe("notes.txt");
        expect(chip?.querySelector(".llm-chat-attachment-unreadable-icon")).toBeNull();
        expect(chip?.querySelector("a")).toBeNull();
        expect(chip?.querySelector(".llm-chat-attachment-file-name")?.textContent).toBe("notes.txt");
        expect(chip?.querySelector<HTMLButtonElement>(".llm-chat-attachment-remove")?.disabled).toBe(true);
    });
});
