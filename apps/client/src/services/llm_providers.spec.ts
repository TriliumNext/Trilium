import type { LlmModelInfo } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import { readsAttachmentKind, unreadableAttachments } from "./llm_providers.js";

const textOnly: LlmModelInfo = { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", attachmentKinds: [] };
const imagesOnly: LlmModelInfo = { id: "codex", name: "Codex", attachmentKinds: [ "image" ] };
const everything: LlmModelInfo = { id: "claude", name: "Claude" };

const png = { type: "image", mime: "image/png" };
const svg = { type: "image", mime: "image/svg+xml" };
const pdf = { type: "file", mime: "application/pdf" };
const markdown = { type: "text_file", mime: "text/markdown" };

describe("attachment support", () => {
    it("finds the attachments a model cannot read, never text files or SVGs", () => {
        const all = [ png, svg, pdf, markdown ];
        expect(unreadableAttachments(textOnly, all)).toEqual([ png, pdf ]);
        expect(unreadableAttachments(imagesOnly, all)).toEqual([ pdf ]);
        // No `attachmentKinds`, or no model at all, restricts nothing.
        expect(unreadableAttachments(everything, all)).toEqual([]);
        expect(unreadableAttachments(undefined, all)).toEqual([]);
    });

    it("says whether a model reads a kind", () => {
        expect(readsAttachmentKind(textOnly, "image")).toBe(false);
        expect(readsAttachmentKind(imagesOnly, "image")).toBe(true);
        expect(readsAttachmentKind(imagesOnly, "file")).toBe(false);
        expect(readsAttachmentKind(everything, "file")).toBe(true);
    });
});
