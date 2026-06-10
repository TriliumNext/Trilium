import { cls } from "@triliumnext/core";
import type { Request } from "express";
import { describe, expect, it } from "vitest";

import llmSpecialNotesRoute from "./llm_special_notes.js";

describe("LLM special notes API", () => {
    it("creates an LLM chat note", () => {
        const chat = cls.init(() => llmSpecialNotesRoute.createLlmChat());
        expect(chat.noteId).toBeTruthy();
    });

    it("gets or creates, then returns it as the most recent chat", () => {
        const created = cls.init(() => llmSpecialNotesRoute.getOrCreateLlmChat());
        expect(created).toBeTruthy();

        const recent = cls.init(() => llmSpecialNotesRoute.getMostRecentLlmChat());
        expect(recent).not.toBeNull();
    });

    it("lists recent chats honouring the limit query param", () => {
        const req = { query: { limit: "1" } } as unknown as Request;
        const chats = cls.init(() => llmSpecialNotesRoute.getRecentLlmChats(req));
        expect(Array.isArray(chats)).toBe(true);
        expect(chats.length).toBeLessThanOrEqual(1);
    });

    it("defaults the limit when not a number", () => {
        const req = { query: {} } as unknown as Request;
        const chats = cls.init(() => llmSpecialNotesRoute.getRecentLlmChats(req));
        expect(Array.isArray(chats)).toBe(true);
    });

    it("saves a chat by note id", () => {
        const created = cls.init(() => llmSpecialNotesRoute.createLlmChat());
        const noteId = created.noteId;
        const req = { body: { llmChatNoteId: noteId } } as unknown as Request<{ llmChatNoteId: string }>;
        const saved = cls.init(() => llmSpecialNotesRoute.saveLlmChat(req));
        expect(saved).toBeTruthy();
    });
});
