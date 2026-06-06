import { t } from "i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getNoteMock, getProviderMock, generateTitleMock } = vi.hoisted(() => ({
    getNoteMock: vi.fn(),
    getProviderMock: vi.fn(),
    generateTitleMock: vi.fn()
}));

vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    return {
        ...actual,
        becca: { ...actual.becca, getNote: getNoteMock },
        getLog: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() })
    };
});

vi.mock("./index.js", () => ({
    getProvider: getProviderMock
}));

import { generateChatTitle } from "./chat_title.js";

/** A note stub that records title assignment + save(). */
function noteStub(title: string) {
    return {
        title,
        save: vi.fn()
    };
}

describe("generateChatTitle", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getProviderMock.mockReturnValue({ generateTitle: generateTitleMock });
    });

    it("renames a note that still has a default 'Chat:' title", async () => {
        // Build a default title dynamically from the translation, not a hardcoded string.
        const note = noteStub(`${t("special_notes.llm_chat_prefix")} 2026-01-01`);
        getNoteMock.mockReturnValue(note);
        generateTitleMock.mockResolvedValue("Tolkien reading order");

        await generateChatTitle("chat1", "How should I read Tolkien?");

        expect(generateTitleMock).toHaveBeenCalledWith("How should I read Tolkien?");
        expect(note.title).toBe("Tolkien reading order");
        expect(note.save).toHaveBeenCalledOnce();
    });

    it("renames a note whose title is the default 'New note' title", async () => {
        const note = noteStub(t("notes.new-note"));
        getNoteMock.mockReturnValue(note);
        generateTitleMock.mockResolvedValue("Generated title");

        await generateChatTitle("chat2", "first message");
        expect(note.title).toBe("Generated title");
        expect(note.save).toHaveBeenCalledOnce();
    });

    it("does nothing when the note no longer exists", async () => {
        getNoteMock.mockReturnValue(null);
        await generateChatTitle("missing", "hello");
        expect(getProviderMock).not.toHaveBeenCalled();
    });

    it("leaves a manually renamed note untouched", async () => {
        const note = noteStub("My carefully chosen title");
        getNoteMock.mockReturnValue(note);

        await generateChatTitle("chat3", "hello");
        expect(getProviderMock).not.toHaveBeenCalled();
        expect(note.save).not.toHaveBeenCalled();
    });

    it("does not rename when the provider returns an empty title", async () => {
        const note = noteStub(t("notes.new-note"));
        getNoteMock.mockReturnValue(note);
        generateTitleMock.mockResolvedValue("");

        await generateChatTitle("chat4", "hello");
        expect(note.title).toBe(t("notes.new-note")); // unchanged
        expect(note.save).not.toHaveBeenCalled();
    });
});
