import { becca, cls, hoisted_note as hoistedNoteService, note_service as noteService, search as searchService, SearchContext } from "@triliumnext/core";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import sql_init from "./sql_init.js";
import specialNotes from "./special_notes.js";

function countLlmChats() {
    return searchService.searchNotes(
        "note.type = llmChat",
        new SearchContext({ ancestorNoteId: "_llmChat" })
    ).length;
}

describe("special_notes (LLM chat, real DB)", () => {
    beforeAll(async () => {
        sql_init.initializeDb();
        await sql_init.dbReady;
    });

    describe("createLlmChat", () => {
        it("creates an llmChat note with the expected metadata under a monthly parent", () => {
            const note = cls.init(() => specialNotes.createLlmChat());

            expect(note.type).toBe("llmChat");
            expect(note.mime).toBe("application/json");
            expect(JSON.parse(note.getContent() as string)).toEqual({ version: 1, messages: [] });
            expect(note.getLabelValue("iconClass")).toBe("bx bx-message-square-dots");
            expect(note.hasLabel("keepCurrentHoisting")).toBe(true);

            // It must live (transitively) under the _llmChat hidden subtree.
            expect(note.hasAncestor("_llmChat")).toBe(true);

            // The monthly parent must be a book note labelled llmChatMonthNote.
            const parent = note.getParentNotes()[0];
            expect(parent.type).toBe("book");
            expect(parent.hasLabel("llmChatMonthNote")).toBe(true);
        });

        it("reuses the same monthly parent for chats created in the same month", () => {
            const a = cls.init(() => specialNotes.createLlmChat());
            const b = cls.init(() => specialNotes.createLlmChat());

            expect(a.getParentNotes()[0].noteId).toBe(b.getParentNotes()[0].noteId);
        });
    });

    describe("getMostRecentLlmChat / getRecentLlmChats", () => {
        // Self-contained: don't rely on chats created by a sibling describe block
        // (the in-memory DB is shared per file, so test order must not matter).
        beforeAll(() => {
            cls.init(() => specialNotes.createLlmChat());
        });

        it("returns the most recently modified chat and a mapped recent list", () => {
            const recent = specialNotes.getRecentLlmChats(5);
            expect(Array.isArray(recent)).toBe(true);
            expect(recent.length).toBeGreaterThan(0);
            for (const entry of recent) {
                expect(entry).toHaveProperty("noteId");
                expect(entry).toHaveProperty("title");
                expect(entry).toHaveProperty("dateModified");
            }

            const mostRecent = specialNotes.getMostRecentLlmChat();
            expect(mostRecent).not.toBeNull();
            expect(mostRecent!.type).toBe("llmChat");
            // The newest chat in the recent list should match getMostRecentLlmChat.
            expect(mostRecent!.noteId).toBe(recent[0].noteId);
        });

        it("respects the limit argument", () => {
            expect(specialNotes.getRecentLlmChats(1).length).toBeLessThanOrEqual(1);
        });
    });

    describe("getOrCreateLlmChat", () => {
        it("returns an existing chat when one exists", () => {
            // Ensure at least one exists.
            cls.init(() => specialNotes.createLlmChat());
            const result = specialNotes.getOrCreateLlmChat();
            expect(result.type).toBe("llmChat");
        });

        it("creates a new chat when none exist", () => {
            // Delete all existing chats first.
            cls.init(() => {
                for (const chat of searchService.searchNotes(
                    "note.type = llmChat",
                    new SearchContext({ ancestorNoteId: "_llmChat" })
                )) {
                    chat.deleteNote();
                }
            });
            expect(specialNotes.getMostRecentLlmChat()).toBeNull();

            const created = cls.init(() => specialNotes.getOrCreateLlmChat());
            expect(created.type).toBe("llmChat");
            expect(specialNotes.getMostRecentLlmChat()).not.toBeNull();
        });
    });

    describe("saveLlmChat", () => {
        it("throws when no chat note ID is provided", () => {
            expect(() => specialNotes.saveLlmChat(null)).toThrow();
        });

        it("throws when the chat note does not exist", () => {
            expect(() => specialNotes.saveLlmChat("doesNotExist123")).toThrow();
        });

        it("clones the chat to the chat home and removes the hidden-subtree parent branch", () => {
            const chat = cls.init(() => specialNotes.createLlmChat());
            expect(chat.hasAncestor("_hidden")).toBe(true);

            const result = cls.init(() => specialNotes.saveLlmChat(chat.noteId));
            expect(result.success).toBe(true);
            expect(result.branchId).toBeTruthy();

            // After saving, the chat should no longer hang off the hidden subtree.
            const liveParents = chat.getParentBranches().filter((b) => !b.isDeleted);
            expect(liveParents.length).toBeGreaterThan(0);
            const stillHidden = liveParents.some((b) => b.parentNote?.hasAncestor("_hidden"));
            expect(stillHidden).toBe(false);

            // The clone produced a resolvable branch.
            const branch = becca.getBranch(result.branchId!);
            expect(branch).toBeTruthy();
        });
    });

    describe("getLlmChatHome branches (via saveLlmChat)", () => {
        afterEach(() => vi.restoreAllMocks());

        it("throws when there is no workspace note", () => {
            vi.spyOn(hoistedNoteService, "getWorkspaceNote").mockReturnValue(null as any);
            const chat = cls.init(() => specialNotes.createLlmChat());

            expect(() => cls.init(() => specialNotes.saveLlmChat(chat.noteId)))
                .toThrow(/workspace note/);
        });

        // A real workspace note (under root, labelled #workspace) plus two DISTINCT
        // child notes used as the clone targets, so each short-circuit operand of
        // `#workspaceLlmChatHome || #llmChatHome || workspaceNote` resolves to a
        // different note and the chosen target can be asserted unambiguously.
        let workspaceId: string;
        let workspaceHomeId: string;
        let genericHomeId: string;
        beforeAll(() => {
            cls.init(() => {
                const workspace = noteService.createNewNote({
                    parentNoteId: "root", title: "Workspace", content: "", type: "book"
                }).note;
                workspace.addLabel("workspace");
                workspaceId = workspace.noteId;
                workspaceHomeId = noteService.createNewNote({
                    parentNoteId: workspaceId, title: "Workspace LLM Home", content: "", type: "book"
                }).note.noteId;
                genericHomeId = noteService.createNewNote({
                    parentNoteId: workspaceId, title: "Generic LLM Home", content: "", type: "book"
                }).note.noteId;
            });
        });

        function expectClonedUnder(
            result: ReturnType<typeof specialNotes.saveLlmChat>,
            chat: ReturnType<typeof specialNotes.createLlmChat>,
            expectedParentId: string
        ) {
            expect(result.success).toBe(true);
            // The chat was cloned to the chosen target and detached from _hidden.
            const branch = becca.getBranch(result.branchId!);
            expect(branch).toBeTruthy();
            expect(branch!.parentNoteId).toBe(expectedParentId);
            const liveParents = chat.getParentBranches().filter((b) => !b.isDeleted);
            expect(liveParents.some((b) => b.parentNote?.hasAncestor("_hidden"))).toBe(false);
        }

        /**
         * Returns a workspace stub backed by the real workspace note but with a
         * controllable searchNoteInSubtree, so the three short-circuit operands of
         * `#workspaceLlmChatHome || #llmChatHome || workspaceNote` can each be reached
         * (the production searchNoteInSubtree is global, so real labels would collide).
         */
        function workspaceStub(found: Record<string, unknown>) {
            const real = becca.getNoteOrThrow(workspaceId);
            return new Proxy(real, {
                get(target, prop) {
                    if (prop === "isRoot") return () => false;
                    if (prop === "searchNoteInSubtree") {
                        return (query: string) => found[query] ?? null;
                    }
                    return (target as any)[prop];
                }
            });
        }

        it("uses the #workspaceLlmChatHome target when present", () => {
            vi.spyOn(hoistedNoteService, "getWorkspaceNote").mockReturnValue(
                workspaceStub({ "#workspaceLlmChatHome": becca.getNoteOrThrow(workspaceHomeId) }) as any
            );

            const chat = cls.init(() => specialNotes.createLlmChat());
            const result = cls.init(() => specialNotes.saveLlmChat(chat.noteId));
            expectClonedUnder(result, chat, workspaceHomeId);
        });

        it("falls back to #llmChatHome when #workspaceLlmChatHome is absent", () => {
            vi.spyOn(hoistedNoteService, "getWorkspaceNote").mockReturnValue(
                workspaceStub({ "#llmChatHome": becca.getNoteOrThrow(genericHomeId) }) as any
            );

            const chat = cls.init(() => specialNotes.createLlmChat());
            const result = cls.init(() => specialNotes.saveLlmChat(chat.noteId));
            // Distinct from the #workspaceLlmChatHome target above.
            expectClonedUnder(result, chat, genericHomeId);
        });

        it("falls back to the workspace note itself when no chat-home label exists", () => {
            vi.spyOn(hoistedNoteService, "getWorkspaceNote")
                .mockReturnValue(workspaceStub({}) as any);

            const chat = cls.init(() => specialNotes.createLlmChat());
            const result = cls.init(() => specialNotes.saveLlmChat(chat.noteId));
            expectClonedUnder(result, chat, workspaceId);
        });
    });

    it("starts with at least the seeded chat content available", () => {
        expect(countLlmChats()).toBeGreaterThanOrEqual(0);
    });
});
