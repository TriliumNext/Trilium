import { describe, expect, it } from "vitest";

import { canRegenerate, conversationForRegenerate } from "./chat_regenerate.js";
import type { StoredMessage } from "./llm_chat_types.js";

function msg(id: string, role: StoredMessage["role"]): StoredMessage {
    return { id, role, content: "x", createdAt: "2026-01-01T00:00:00.000Z" };
}

describe("canRegenerate", () => {
    const convo = [msg("u1", "user"), msg("a1", "assistant")];

    it("offers the command on the last assistant reply", () => {
        expect(canRegenerate(false, convo[1], convo, false)).toBe(true);
    });

    it("hides it on a non-last message", () => {
        expect(canRegenerate(false, convo[0], convo, false)).toBe(false);
    });

    it("hides it when the last message is not an assistant reply", () => {
        const ending = [msg("a1", "assistant"), msg("u1", "user")];
        expect(canRegenerate(false, ending[1], ending, false)).toBe(false);
    });

    it("hides it with a selection or while streaming", () => {
        expect(canRegenerate(true, convo[1], convo, false)).toBe(false);
        expect(canRegenerate(false, convo[1], convo, true)).toBe(false);
    });

    it("hides it when there is no user turn to run from", () => {
        const noUser = [msg("a1", "assistant")];
        expect(canRegenerate(false, noUser[0], noUser, false)).toBe(false);
    });
});

describe("conversationForRegenerate", () => {
    it("keeps everything up to and including the last user message", () => {
        const messages = [msg("u1", "user"), msg("a1", "assistant"), msg("u2", "user"), msg("t2", "assistant"), msg("a2", "assistant")];
        expect(conversationForRegenerate(messages)?.map(m => m.id)).toEqual(["u1", "a1", "u2"]);
    });

    it("returns null when there is no user message", () => {
        expect(conversationForRegenerate([msg("a1", "assistant")])).toBeNull();
    });
});
