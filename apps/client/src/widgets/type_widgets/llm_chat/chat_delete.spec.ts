import { describe, expect, it } from "vitest";

import { canDeleteMessage, removeMessage } from "./chat_delete.js";
import type { StoredMessage } from "./llm_chat_types.js";

function message(id: string): StoredMessage {
    return { id, role: "assistant", content: "text", createdAt: "2026-01-01T00:00:00.000Z" };
}

describe("canDeleteMessage", () => {
    it("offers the command for a real message with no selection and no stream", () => {
        expect(canDeleteMessage(false, message("m1"), false)).toBe(true);
    });

    it("hides the command when text is selected", () => {
        expect(canDeleteMessage(true, message("m1"), false)).toBe(false);
    });

    it("hides the command when there is no message", () => {
        expect(canDeleteMessage(false, undefined, false)).toBe(false);
    });

    it("hides the command while a reply is streaming", () => {
        expect(canDeleteMessage(false, message("m1"), true)).toBe(false);
    });
});

describe("removeMessage", () => {
    it("removes only the matching message, preserving the rest in order", () => {
        const messages = [message("a"), message("b"), message("c")];
        expect(removeMessage(messages, "b").map(m => m.id)).toEqual(["a", "c"]);
    });

    it("returns the list unchanged when the id isn't present", () => {
        const messages = [message("a"), message("b")];
        expect(removeMessage(messages, "missing").map(m => m.id)).toEqual(["a", "b"]);
    });
});
