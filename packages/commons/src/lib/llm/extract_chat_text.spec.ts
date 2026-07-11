import { describe, expect, it } from "vitest";

import { extractLlmChatText } from "./extract_chat_text.js";

describe("extractLlmChatText", () => {
    it("returns an empty string for invalid or empty content", () => {
        expect(extractLlmChatText("")).toEqual("");
        expect(extractLlmChatText("{")).toEqual("");
        expect(extractLlmChatText("{}")).toEqual("");
        expect(extractLlmChatText(`{ "messages": null }`)).toEqual("");
    });

    it("extracts plain-string message content", () => {
        const content = JSON.stringify({
            version: 1,
            messages: [
                { id: "1", role: "user", content: "How do I search notes?" },
                { id: "2", role: "assistant", content: "Use the quick search bar." }
            ]
        });
        expect(extractLlmChatText(content)).toEqual("How do I search notes? Use the quick search bar.");
    });

    it("extracts text from content blocks and ignores tool calls and attachments", () => {
        const content = JSON.stringify({
            version: 1,
            messages: [
                {
                    id: "1",
                    role: "assistant",
                    content: [
                        { type: "text", content: "First part." },
                        { type: "tool_call", toolCall: { id: "t1", toolName: "search_notes", input: {} } },
                        { type: "image", attachmentId: "a1", mime: "image/png", title: "diagram", url: "..." },
                        { type: "text", content: "Second part." }
                    ]
                }
            ]
        });
        expect(extractLlmChatText(content)).toEqual("First part. Second part.");
    });

    it("skips thinking and error turns", () => {
        const content = JSON.stringify({
            version: 1,
            messages: [
                { id: "1", role: "assistant", type: "thinking", content: "Let me reason about this." },
                { id: "2", role: "assistant", type: "error", content: "Provider timed out." },
                { id: "3", role: "assistant", type: "message", content: "Here is the answer." }
            ]
        });
        expect(extractLlmChatText(content)).toEqual("Here is the answer.");
    });
});
