import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import becca from "../becca/becca.js";
import type BNote from "../becca/entities/bnote.js";
import attributeService from "./attributes.js";
import { getContext } from "./context.js";
import hoistedNoteService from "./hoisted_note.js";
import noteService from "./notes.js";
import SearchContext from "./search/search_context.js";
import searchService from "./search/services/search.js";
import specialNotes from "./special_notes.js";
import { unwrapStringOrBuffer } from "./utils/binary.js";

/**
 * The created note must end up (transitively) under the hidden subtree of the
 * given root, as the monthly parent for these special notes lives there.
 */
function expectUnderHidden(note: BNote, rootNoteId: string) {
    expect(note.hasAncestor(rootNoteId)).toBe(true);
    expect(note.hasAncestor("_hidden")).toBe(true);
}

describe("special_notes (core, real DB)", () => {
    afterEach(() => vi.restoreAllMocks());

    describe("createSqlConsole", () => {
        it("creates a code SQL console note under a monthly book parent in the hidden subtree", () => {
            const note = getContext().init(() => specialNotes.createSqlConsole());

            expect(note.type).toBe("code");
            expect(note.mime).toBe("text/x-sqlite;schema=trilium");
            expect(unwrapStringOrBuffer(note.getContent())).toContain("SELECT");
            expect(note.getLabelValue("iconClass")).toBe("bx bx-data");
            expect(note.hasLabel("keepCurrentHoisting")).toBe(true);
            expect(note.title).toContain("SQL Console");

            expectUnderHidden(note, "_sqlConsole");

            // The monthly parent must be a book note labelled sqlConsoleMonthNote.
            const parent = note.getParentNotes()[0];
            expect(parent.type).toBe("book");
            expect(parent.hasLabel("sqlConsoleMonthNote")).toBe(true);
        });

        it("reuses the same monthly parent for consoles created in the same month", () => {
            const a = getContext().init(() => specialNotes.createSqlConsole());
            const b = getContext().init(() => specialNotes.createSqlConsole());

            expect(a.getParentNotes()[0].noteId).toBe(b.getParentNotes()[0].noteId);
        });
    });

    describe("saveSqlConsole", () => {
        it("rejects when the SQL console note does not exist", async () => {
            await expect(getContext().init(() => specialNotes.saveSqlConsole("doesNotExist123")))
                .rejects.toThrow(/SQL console note/);
        });

        it("clones to the day note home and removes the hidden-subtree parent branch", async () => {
            const note = getContext().init(() => specialNotes.createSqlConsole());
            expect(note.hasAncestor("_hidden")).toBe(true);

            const result = await getContext().init(() => specialNotes.saveSqlConsole(note.noteId));

            expect(result.success).toBe(true);
            expect(result.branchId).toBeTruthy();
            expect(becca.getBranch(result.branchId!)).toBeTruthy();

            // After saving, the console must no longer hang off the hidden subtree.
            const liveParents = note.getParentBranches().filter((b) => !b.isDeleted);
            expect(liveParents.length).toBeGreaterThan(0);
            expect(liveParents.some((b) => b.parentNote?.hasAncestor("_hidden"))).toBe(false);
        });

        it("uses an explicit #sqlConsoleHome target note when present", async () => {
            // A real, root-anchored note used as the clone target.
            const home = becca.getNoteOrThrow("root").getChildNotes()[0];
            vi.spyOn(attributeService, "getNoteWithLabel").mockReturnValue(home);

            const note = getContext().init(() => specialNotes.createSqlConsole());
            const result = await getContext().init(() => specialNotes.saveSqlConsole(note.noteId));

            expect(result.success).toBe(true);
            // It was cloned under the supplied home (a descendant of root, not hidden).
            const liveParents = note.getParentBranches().filter((b) => !b.isDeleted);
            expect(liveParents.some((b) => b.parentNoteId === home.noteId)).toBe(true);
        });
    });

    describe("createSearchNote", () => {
        it("creates a search note carrying the search string and keepCurrentHoisting label", () => {
            const note = getContext().init(() => specialNotes.createSearchNote("hello world", ""));

            expect(note.type).toBe("search");
            expect(note.mime).toBe("application/json");
            expect(note.getLabelValue("searchString")).toBe("hello world");
            expect(note.hasLabel("keepCurrentHoisting")).toBe(true);
            expect(note.title).toContain("hello world");

            expectUnderHidden(note, "_search");

            const parent = note.getParentNotes()[0];
            expect(parent.type).toBe("book");
            expect(parent.hasLabel("searchMonthNote")).toBe(true);
        });

        it("sets the ancestor relation only when an ancestorNoteId is supplied", () => {
            const withAncestor = getContext().init(() => specialNotes.createSearchNote("q1", "root"));
            expect(withAncestor.getRelationValue("ancestor")).toBe("root");

            const withoutAncestor = getContext().init(() => specialNotes.createSearchNote("q2", ""));
            expect(withoutAncestor.hasRelation("ancestor")).toBe(false);
        });
    });

    describe("saveSearchNote", () => {
        it("throws when the search note does not exist", () => {
            expect(() => getContext().init(() => specialNotes.saveSearchNote("doesNotExist123")))
                .toThrow(/search note/);
        });

        it("throws when there is no workspace note", () => {
            vi.spyOn(hoistedNoteService, "getWorkspaceNote").mockReturnValue(null as any);
            const note = getContext().init(() => specialNotes.createSearchNote("q", ""));

            expect(() => getContext().init(() => specialNotes.saveSearchNote(note.noteId)))
                .toThrow(/workspace note/);
        });

        it("clones to the search home and removes the hidden-subtree parent branch", () => {
            const note = getContext().init(() => specialNotes.createSearchNote("q", ""));
            expect(note.hasAncestor("_hidden")).toBe(true);

            const result = getContext().init(() => specialNotes.saveSearchNote(note.noteId));

            expect(result.success).toBe(true);
            expect(result.branchId).toBeTruthy();
            expect(becca.getBranch(result.branchId!)).toBeTruthy();

            const liveParents = note.getParentBranches().filter((b) => !b.isDeleted);
            expect(liveParents.length).toBeGreaterThan(0);
            expect(liveParents.some((b) => b.parentNote?.hasAncestor("_hidden"))).toBe(false);
        });
    });

    describe("getInboxNote", () => {
        it("throws when there is no workspace note", () => {
            vi.spyOn(hoistedNoteService, "getWorkspaceNote").mockReturnValue(null as any);
            expect(() => specialNotes.getInboxNote("2026-05-29")).toThrow(/workspace note/);
        });

        it("returns the #inbox-labelled note when at the root workspace", () => {
            const inbox = becca.getNoteOrThrow("root").getChildNotes()[0];
            vi.spyOn(attributeService, "getNoteWithLabel").mockReturnValue(inbox);

            const result = specialNotes.getInboxNote("2026-05-29");
            expect(result.noteId).toBe(inbox.noteId);
        });

        it("falls back to the day note when no #inbox label exists at the root", () => {
            // A journal has to exist, or the capture stays at the top level instead.
            vi.spyOn(attributeService, "getNoteWithLabel").mockImplementation((name: string) =>
                name === "calendarRoot" ? becca.getNoteOrThrow("root").getChildNotes()[0] : null);

            // getDayNote may create the day note, so it needs a CLS context.
            const result = getContext().init(() => specialNotes.getInboxNote("2026-05-29"));
            // Day note for the date is created under the calendar; it is a real note.
            expect(result).toBeTruthy();
            expect(result.noteId).not.toBe("root");
        });

        it("prefers #workspaceInbox over #inbox within a non-root workspace", () => {
            const workspaceInbox = becca.getNoteOrThrow("root").getChildNotes()[0];
            const plainInbox = becca.getNoteOrThrow("root").getChildNotes()[1];
            const workspace = makeWorkspaceStub({
                "#workspaceInbox": workspaceInbox,
                "#inbox": plainInbox
            });
            vi.spyOn(hoistedNoteService, "getWorkspaceNote").mockReturnValue(workspace as any);

            expect(specialNotes.getInboxNote("2026-05-29").noteId).toBe(workspaceInbox.noteId);
        });

        it("falls back to the workspace note itself when no inbox label is found in the subtree", () => {
            const workspace = makeWorkspaceStub({});
            vi.spyOn(hoistedNoteService, "getWorkspaceNote").mockReturnValue(workspace as any);

            // The stub workspace reports its own noteId via the underlying real note.
            const result = specialNotes.getInboxNote("2026-05-29");
            expect(result).toBe(workspace);
        });
    });

    describe("getInboxTarget", () => {
        it("names the #inbox note at the root workspace", () => {
            const inbox = becca.getNoteOrThrow("root").getChildNotes()[0];
            vi.spyOn(attributeService, "getNoteWithLabel").mockReturnValue(inbox);

            expect(specialNotes.getInboxTarget()).toEqual({
                kind: "inbox",
                noteId: inbox.noteId,
                title: inbox.getTitleOrProtected()
            });
        });

        it("reports the day note without creating it", () => {
            vi.spyOn(attributeService, "getNoteWithLabel").mockImplementation((name: string) =>
                name === "calendarRoot" ? becca.getNoteOrThrow("root").getChildNotes()[0] : null);
            const noteCountBefore = Object.keys(becca.notes).length;

            // No CLS context: reaching getDayNote() would need one, so this also proves it is
            // never called.
            expect(specialNotes.getInboxTarget()).toEqual({ kind: "dayNote", noteId: undefined, title: undefined });
            expect(Object.keys(becca.notes).length).toBe(noteCountBefore);
        });

        it("keeps a capture at the top level when the journal has been deleted, rather than rebuilding it", () => {
            // Nulls both labels this path consults, #inbox and #calendarRoot.
            vi.spyOn(attributeService, "getNoteWithLabel").mockReturnValue(null);
            const noteCountBefore = Object.keys(becca.notes).length;

            expect(specialNotes.getInboxTarget()).toMatchObject({ kind: "root", noteId: "root" });
            expect(specialNotes.getInboxNote("2026-05-29").noteId).toBe("root");
            // No calendar was built on the way.
            expect(Object.keys(becca.notes).length).toBe(noteCountBefore);
        });

        it("distinguishes the workspace inbox, a plain inbox and the workspace root", () => {
            const workspaceInbox = becca.getNoteOrThrow("root").getChildNotes()[0];
            const plainInbox = becca.getNoteOrThrow("root").getChildNotes()[1];

            const withBoth = makeWorkspaceStub({ "#workspaceInbox": workspaceInbox, "#inbox": plainInbox });
            vi.spyOn(hoistedNoteService, "getWorkspaceNote").mockReturnValue(withBoth as any);
            expect(specialNotes.getInboxTarget()).toMatchObject({ kind: "workspaceInbox", noteId: workspaceInbox.noteId });

            const withPlainOnly = makeWorkspaceStub({ "#inbox": plainInbox });
            vi.spyOn(hoistedNoteService, "getWorkspaceNote").mockReturnValue(withPlainOnly as any);
            expect(specialNotes.getInboxTarget()).toMatchObject({ kind: "inbox", noteId: plainInbox.noteId });

            const withNeither = makeWorkspaceStub({});
            vi.spyOn(hoistedNoteService, "getWorkspaceNote").mockReturnValue(withNeither as any);
            expect(specialNotes.getInboxTarget()).toMatchObject({ kind: "workspaceRoot", noteId: withNeither.noteId });
        });
    });

    describe("createLauncher", () => {
        it("creates a note launcher with the note-launcher template", () => {
            const { success, note } = getContext().init(() =>
                specialNotes.createLauncher({ parentNoteId: "_lbVisibleLaunchers", launcherType: "note" })
            );

            expect(success).toBe(true);
            expect(note.type).toBe("launcher");
            expect(note.getRelationValue("template")).toBe("_lbTplLauncherNote");
        });

        it("creates a script launcher with the script template", () => {
            const { note } = getContext().init(() =>
                specialNotes.createLauncher({ parentNoteId: "_lbVisibleLaunchers", launcherType: "script" })
            );

            expect(note.type).toBe("launcher");
            expect(note.getRelationValue("template")).toBe("_lbTplLauncherScript");
        });

        it("creates a custom widget launcher with the custom widget template", () => {
            const { note } = getContext().init(() =>
                specialNotes.createLauncher({ parentNoteId: "_lbVisibleLaunchers", launcherType: "customWidget" })
            );

            expect(note.getRelationValue("template")).toBe("_lbTplCustomWidget");
        });

        it("creates a spacer launcher with the spacer template", () => {
            const { note } = getContext().init(() =>
                specialNotes.createLauncher({ parentNoteId: "_lbVisibleLaunchers", launcherType: "spacer" })
            );

            expect(note.getRelationValue("template")).toBe("_lbTplSpacer");
        });

        it("throws on an unrecognized launcher type", () => {
            expect(() =>
                getContext().init(() =>
                    specialNotes.createLauncher({
                        parentNoteId: "_lbVisibleLaunchers",
                        launcherType: "bogus" as any
                    })
                )
            ).toThrow(/Unrecognized launcher type/);
        });
    });

    describe("resetLauncher", () => {
        it("deletes a normal launcher note", () => {
            const { note } = getContext().init(() =>
                specialNotes.createLauncher({ parentNoteId: "_lbVisibleLaunchers", launcherType: "note" })
            );
            expect(note.isDeleted).toBe(false);

            getContext().init(() => specialNotes.resetLauncher(note.noteId));

            expect(becca.getNote(note.noteId)?.isDeleted ?? true).toBe(true);
        });

        it("only resets the children (not the root note itself) for the launchbar roots", () => {
            // Deleting the real _lbRoot children would corrupt the shared fixture
            // DB for the other tests, so drive the root-reset branch through a mock.
            const childA = { deleteNote: vi.fn() };
            const childB = { deleteNote: vi.fn() };
            const rootNote = {
                isLaunchBarConfig: () => true,
                deleteNote: vi.fn(),
                getChildNotes: () => [childA, childB]
            };
            vi.spyOn(becca, "getNote").mockReturnValue(rootNote as any);

            getContext().init(() => specialNotes.resetLauncher("_lbRoot"));

            // The root itself must NOT be deleted; only its children are reset.
            expect(rootNote.deleteNote).not.toHaveBeenCalled();
            expect(childA.deleteNote).toHaveBeenCalledTimes(1);
            expect(childB.deleteNote).toHaveBeenCalledTimes(1);
        });

        it("is a no-op for a note that is not a launchbar config note", () => {
            const plain = getContext().init(() => specialNotes.createSearchNote("not-a-launcher", ""));

            getContext().init(() => specialNotes.resetLauncher(plain.noteId));

            // Search notes are not launchbar config, so they are left intact.
            expect(becca.getNote(plain.noteId)?.isDeleted).toBe(false);
        });
    });

    describe("createOrUpdateScriptLauncherFromApi", () => {
        it("rejects non-alphanumeric ids and a missing title", () => {
            expect(() =>
                getContext().init(() =>
                    specialNotes.createOrUpdateScriptLauncherFromApi({
                        id: "bad id!",
                        title: "X",
                        action: "() => {}"
                    })
                )
            ).toThrow(/alphanumeric/);

            expect(() =>
                getContext().init(() =>
                    specialNotes.createOrUpdateScriptLauncherFromApi({
                        id: "okid",
                        title: "",
                        action: "() => {}"
                    })
                )
            ).toThrow(/Title is mandatory/);
        });

        it("creates a new script launcher with content, mime, shortcut and icon labels", () => {
            const launcher = getContext().init(() =>
                specialNotes.createOrUpdateScriptLauncherFromApi({
                    id: "myLauncher1",
                    title: "My Launcher",
                    action: "() => console.log(1)",
                    shortcut: "ctrl+m",
                    icon: "rocket"
                })
            );

            expect(launcher.noteId).toBe("myLauncher1");
            expect(launcher.title).toBe("My Launcher");
            expect(launcher.mime).toBe("application/javascript;env=frontend");
            expect(unwrapStringOrBuffer(launcher.getContent())).toBe("(() => console.log(1))()");
            expect(launcher.hasLabel("scriptInLauncherContent")).toBe(true);
            expect(launcher.getLabelValue("keyboardShortcut")).toBe("ctrl+m");
            expect(launcher.getLabelValue("iconClass")).toBe("bx bx-rocket");
            expect(launcher.getRelationValue("template")).toBe("_lbTplLauncherScript");
        });

        it("updates the existing launcher and removes shortcut/icon labels when omitted", () => {
            getContext().init(() =>
                specialNotes.createOrUpdateScriptLauncherFromApi({
                    id: "myLauncher2",
                    title: "First",
                    action: "() => 1",
                    shortcut: "ctrl+a",
                    icon: "cog"
                })
            );

            const updated = getContext().init(() =>
                specialNotes.createOrUpdateScriptLauncherFromApi({
                    id: "myLauncher2",
                    title: "Second",
                    action: "() => 2"
                })
            );

            expect(updated.noteId).toBe("myLauncher2");
            expect(updated.title).toBe("Second");
            expect(unwrapStringOrBuffer(updated.getContent())).toBe("(() => 2)()");
            expect(updated.hasLabel("keyboardShortcut")).toBe(false);
            expect(updated.hasLabel("iconClass")).toBe(false);
        });

        it("derives an alphanumeric id from the title when no id is provided", () => {
            const launcher = getContext().init(() =>
                specialNotes.createOrUpdateScriptLauncherFromApi({
                    id: "",
                    title: "Hello World!",
                    action: "() => {}"
                })
            );

            expect(launcher.noteId).toMatch(/^tb_/);
        });
    });
    describe("LLM chat", () => {
        describe("createLlmChat", () => {
            it("creates an llmChat note with the expected metadata under a monthly parent", () => {
                const note = getContext().init(() => specialNotes.createLlmChat());

                expect(note.type).toBe("llmChat");
                expect(note.mime).toBe("application/json");
                expect(JSON.parse(note.getContent() as string)).toEqual({ version: 1, messages: [] });
                expect(note.getLabelValue("iconClass")).toBe("bx bx-message-square-dots");
                expect(note.hasLabel("keepCurrentHoisting")).toBe(true);
                expectUnderHidden(note, "_llmChat");

                // The monthly parent must be a book note labelled llmChatMonthNote.
                const parent = note.getParentNotes()[0];
                expect(parent.type).toBe("book");
                expect(parent.hasLabel("llmChatMonthNote")).toBe(true);
            });

            it("reuses the same monthly parent for chats created in the same month", () => {
                const a = getContext().init(() => specialNotes.createLlmChat());
                const b = getContext().init(() => specialNotes.createLlmChat());

                expect(a.getParentNotes()[0].noteId).toBe(b.getParentNotes()[0].noteId);
            });
        });

        describe("getMostRecentLlmChat / getRecentLlmChats", () => {
            // Self-contained: don't rely on chats created by a sibling describe block
            // (the in-memory DB is shared per file, so test order must not matter).
            beforeAll(() => {
                getContext().init(() => specialNotes.createLlmChat());
            });

            it("returns the most recently modified chat and a mapped recent list", () => {
                const recent = specialNotes.getRecentLlmChats(5);
                expect(recent.length).toBeGreaterThan(0);
                for (const entry of recent) {
                    expect(entry).toHaveProperty("noteId");
                    expect(entry).toHaveProperty("title");
                    expect(entry).toHaveProperty("dateModified");
                }

                const mostRecent = specialNotes.getMostRecentLlmChat();
                // The newest chat in the recent list should match getMostRecentLlmChat.
                expect(mostRecent?.type).toBe("llmChat");
                expect(mostRecent?.noteId).toBe(recent[0].noteId);
            });

            it("respects the limit argument", () => {
                expect(specialNotes.getRecentLlmChats(1).length).toBeLessThanOrEqual(1);
            });
        });

        describe("getOrCreateLlmChat", () => {
            it("returns an existing chat when one exists", () => {
                getContext().init(() => specialNotes.createLlmChat());
                expect(specialNotes.getOrCreateLlmChat().type).toBe("llmChat");
            });

            it("creates a new chat when none exist", () => {
                getContext().init(() => {
                    for (const chat of searchService.searchNotes(
                        "note.type = llmChat",
                        new SearchContext({ ancestorNoteId: "_llmChat" })
                    )) {
                        chat.deleteNote();
                    }
                });
                expect(specialNotes.getMostRecentLlmChat()).toBeNull();

                const created = getContext().init(() => specialNotes.getOrCreateLlmChat());
                expect(created.type).toBe("llmChat");
                expect(specialNotes.getMostRecentLlmChat()).not.toBeNull();
            });
        });

        describe("saveLlmChat", () => {
            it("rejects a missing id and an id that resolves to nothing", () => {
                expect(() => specialNotes.saveLlmChat(null)).toThrow();
                expect(() => specialNotes.saveLlmChat("doesNotExist123")).toThrow();
            });

            it("clones the chat to the chat home and removes the hidden-subtree parent branch", () => {
                const chat = getContext().init(() => specialNotes.createLlmChat());
                expect(chat.hasAncestor("_hidden")).toBe(true);

                const result = getContext().init(() => specialNotes.saveLlmChat(chat.noteId));
                expect(result.success).toBe(true);
                expect(result.branchId).toBeTruthy();

                // After saving, the chat no longer hangs off the hidden subtree.
                const liveParents = chat.getParentBranches().filter(b => !b.isDeleted);
                expect(liveParents.length).toBeGreaterThan(0);
                expect(liveParents.some(b => b.parentNote?.hasAncestor("_hidden"))).toBe(false);
                expect(result.branchId && becca.getBranch(result.branchId)).toBeTruthy();
            });
        });

        // Each short-circuit operand of `#workspaceLlmChatHome || #llmChatHome ||
        // workspaceNote` must resolve to a DISTINCT note, so the chosen target can be
        // asserted unambiguously.
        describe("getLlmChatHome branches (via saveLlmChat)", () => {
            let workspaceHomeId: string;
            let genericHomeId: string;
            let fallbackId: string;

            beforeAll(() => {
                getContext().init(() => {
                    workspaceHomeId = noteService.createNewNote({
                        parentNoteId: "root", title: "Workspace LLM Home", content: "", type: "book"
                    }).note.noteId;
                    genericHomeId = noteService.createNewNote({
                        parentNoteId: "root", title: "Generic LLM Home", content: "", type: "book"
                    }).note.noteId;
                });
                // What makeWorkspaceStub proxies, and therefore the last operand.
                fallbackId = becca.getNoteOrThrow("root").getChildNotes()[0].noteId;
            });

            function expectClonedUnder(found: Record<string, unknown>, expectedParentId: string) {
                vi.spyOn(hoistedNoteService, "getWorkspaceNote")
                    .mockReturnValue(makeWorkspaceStub(found) as never);

                const chat = getContext().init(() => specialNotes.createLlmChat());
                const result = getContext().init(() => specialNotes.saveLlmChat(chat.noteId));

                expect(result.success).toBe(true);
                expect(result.branchId && becca.getBranch(result.branchId)?.parentNoteId).toBe(expectedParentId);
                const liveParents = chat.getParentBranches().filter(b => !b.isDeleted);
                expect(liveParents.some(b => b.parentNote?.hasAncestor("_hidden"))).toBe(false);
            }

            it("throws when there is no workspace note", () => {
                vi.spyOn(hoistedNoteService, "getWorkspaceNote").mockReturnValue(null as never);
                const chat = getContext().init(() => specialNotes.createLlmChat());

                expect(() => getContext().init(() => specialNotes.saveLlmChat(chat.noteId)))
                    .toThrow(/workspace note/);
            });

            it("prefers #workspaceLlmChatHome, then #llmChatHome, then the workspace note itself", () => {
                expectClonedUnder(
                    { "#workspaceLlmChatHome": becca.getNoteOrThrow(workspaceHomeId) },
                    workspaceHomeId
                );
                vi.restoreAllMocks();
                expectClonedUnder({ "#llmChatHome": becca.getNoteOrThrow(genericHomeId) }, genericHomeId);
                vi.restoreAllMocks();
                expectClonedUnder({}, fallbackId);
            });
        });
    });
});

/**
 * Returns a workspace stub backed by a real, non-root note but with a
 * controllable searchNoteInSubtree and isRoot() === false, so the inbox/search
 * short-circuit operands can each be reached deterministically (the real
 * searchNoteInSubtree is global, so genuine labels would collide between tests).
 */
function makeWorkspaceStub(found: Record<string, unknown>) {
    const real = becca.getNoteOrThrow("root").getChildNotes()[0];
    return new Proxy(real, {
        get(target, prop) {
            if (prop === "isRoot") {
                return () => false;
            }
            if (prop === "searchNoteInSubtree") {
                return (query: string) => found[query] ?? null;
            }
            return (target as any)[prop];
        }
    });
}
