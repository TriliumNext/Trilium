import { afterEach, describe, expect, it, vi } from "vitest";

import becca from "../becca/becca.js";
import type BNote from "../becca/entities/bnote.js";
import attributeService from "./attributes.js";
import { getContext } from "./context.js";
import hoistedNoteService from "./hoisted_note.js";
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
            vi.spyOn(attributeService, "getNoteWithLabel").mockReturnValue(null);

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
