import { describe, expect, it } from "vitest";

import { trimToFirstUserMessage } from "./llm_chat_types.js";

describe("trimToFirstUserMessage", () => {
    const u = { role: "user", id: "u" };
    const a = { role: "assistant", id: "a" };

    it("leaves a conversation that already starts with a user message unchanged", () => {
        const messages = [u, a, { ...u, id: "u2" }];
        expect(trimToFirstUserMessage(messages)).toBe(messages);
    });

    it("drops leading assistant turns so the first message is a user turn", () => {
        expect(trimToFirstUserMessage([a, { ...a, id: "a2" }, u, a]).map(m => m.id)).toEqual(["u", "a"]);
    });

    it("leaves a conversation with no user message untouched", () => {
        const messages = [a, { ...a, id: "a2" }];
        expect(trimToFirstUserMessage(messages)).toBe(messages);
    });

    it("returns an empty list unchanged", () => {
        expect(trimToFirstUserMessage([])).toEqual([]);
    });
});
