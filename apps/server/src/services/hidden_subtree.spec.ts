import { describe, it, expect } from "vitest";
import cls from "./cls.js";
import hiddenSubtreeService from "./hidden_subtree.js";
import sql_init from "./sql_init.js";
import branches from "./branches.js";
import becca from "../becca/becca.js";
import { LOCALES } from "@triliumnext/commons";
import { changeLanguage } from "./i18n.js";
import { deferred } from "./utils.js";

describe("Hidden Subtree", () => {
    beforeAll(async () => {
        sql_init.initializeDb();
        await sql_init.dbReady;
        cls.init(() => hiddenSubtreeService.checkHiddenSubtree());
    });

    describe("Launcher movement persistence", () => {
        it("should persist launcher movement between visible and available after integrity check", () => {
            // Move backend log to visible launchers.
            const backendLogBranch = becca.getBranchFromChildAndParent("_lbBackendLog", "_lbAvailableLaunchers");
            expect(backendLogBranch).toBeDefined();

            // Move launcher to visible launchers.
            cls.init(() => {
                branches.moveBranchToNote(backendLogBranch!, "_lbVisibleLaunchers");
                hiddenSubtreeService.checkHiddenSubtree();
            });

            // Ensure the launcher is still in visible launchers.
            const childBranches = backendLogBranch?.childNote.getParentBranches()
                .filter((b) => !b.isDeleted);
            expect(childBranches).toBeDefined();
            expect(childBranches![0].parentNoteId).toStrictEqual("_lbVisibleLaunchers");
        });

        it("should enforce the correct placement of help", () => {
            // First, verify the help note exists in its original correct location
            const originalBranch = becca.getBranchFromChildAndParent("_help_Vc8PjrjAGuOp", "_help_gh7bpGYxajRS");
            expect(originalBranch).toBeDefined();
            expect(originalBranch?.parentNoteId).toBe("_help_gh7bpGYxajRS");

            // Move the help note to an incorrect location (_help root instead of its proper parent)
            cls.init(() => {
                branches.moveBranchToNote(originalBranch!, "_help");
            });

            // Verify the note was moved to the wrong location
            const movedBranches = becca.notes["_help_Vc8PjrjAGuOp"]?.getParentBranches()
                .filter((b) => !b.isDeleted);
            expect(movedBranches).toBeDefined();
            expect(movedBranches![0].parentNoteId).toBe("_help");

            // Run the hidden subtree integrity check
            cls.init(() => {
                hiddenSubtreeService.checkHiddenSubtree(true);
            });

            // Verify that the integrity check moved the help note back to its correct location
            const correctedBranches = becca.notes["_help_Vc8PjrjAGuOp"]?.getParentBranches()
                .filter((b) => !b.isDeleted);
            expect(correctedBranches).toBeDefined();
            expect(correctedBranches![0].parentNoteId).toBe("_help_gh7bpGYxajRS");

            // Ensure the note is no longer under the incorrect parent
            const helpRootChildren = becca.notes["_help"]?.getChildNotes();
            const incorrectChild = helpRootChildren?.find(note => note.noteId === "_help_Vc8PjrjAGuOp");
            expect(incorrectChild).toBeUndefined();
        });

        it("enforces renames of launcher notes", () => {
            const jumpToNote = becca.getNote("_lbJumpTo");
            expect(jumpToNote).toBeDefined();
            jumpToNote!.title = "Renamed";

            cls.init(() => {
                jumpToNote!.save();
                hiddenSubtreeService.checkHiddenSubtree(true);
            });

            const updatedJumpToNote = becca.getNote("_lbJumpTo");
            expect(updatedJumpToNote).toBeDefined();
            expect(updatedJumpToNote?.title).not.toBe("Renamed");
        });

        it("maintains launchers hidden, if they were shown by default but moved by the user", () => {
            const launcher = becca.getNote("_lbLlmChat");
            const branch = launcher?.getParentBranches()[0];
            expect(branch).toBeDefined();
            expect(branch!.parentNoteId).toBe("_lbVisibleLaunchers");
            expect(launcher).toBeDefined();

            cls.init(() => {
                branches.moveBranchToNote(branch!, "_lbAvailableLaunchers");
                hiddenSubtreeService.checkHiddenSubtree();
            });

            const newBranches = launcher?.getParentBranches().filter(b => !b.isDeleted);
            expect(newBranches).toHaveLength(1);
            expect(newBranches![0].parentNoteId).toBe("_lbAvailableLaunchers");
        });

        it("can restore names in all languages", async () => {
            const done = deferred<void>();
            cls.wrap(async () => {
                for (const locale of LOCALES) {
                    if (locale.contentOnly) {
                        continue;
                    }

                    try {
                        await changeLanguage(locale.id);
                    } catch (error) {
                        done.reject(error);
                    }
                }
                done.resolve();
            })();
            await done;
        });
    });

    describe("Hidden subtree", () => {
        it("cleans up exclude from note map at the root", async () => {
            const hiddenSubtree = becca.getNoteOrThrow("_hidden");
            cls.init(() => hiddenSubtree.addLabel("excludeFromNoteMap"));
            expect(hiddenSubtree.hasLabel("excludeFromNoteMap")).toBeTruthy();
            cls.init(() => hiddenSubtreeService.checkHiddenSubtree());
            expect(hiddenSubtree.hasLabel("excludeFromNoteMap")).toBeFalsy();
        });
    });
});
