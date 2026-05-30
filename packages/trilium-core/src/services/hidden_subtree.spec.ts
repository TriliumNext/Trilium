import { beforeAll, describe, expect, it } from "vitest";

import becca from "../becca/becca.js";
import type BNote from "../becca/entities/bnote.js";
import { getContext } from "./context.js";
import hiddenSubtreeService, {
    LBTPL_BASE,
    LBTPL_COMMAND,
    LBTPL_CUSTOM_WIDGET,
    LBTPL_NOTE_LAUNCHER,
    LBTPL_ROOT,
    LBTPL_SCRIPT,
    LBTPL_SPACER,
    LBTPL_WIDGET
} from "./hidden_subtree.js";
import noteService from "./notes.js";

/**
 * Re-create a deprecated hidden-subtree note under its declared parent so the
 * enforceDeleted branch in checkHiddenSubtree has something to delete. Both
 * deprecated entries live directly under "_options" in the definition.
 */
function materialiseDeprecatedNote(noteId: string) {
    withContext(() =>
        noteService.createNewNote({
            noteId,
            title: `deprecated-${noteId}`,
            type: "contentWidget",
            parentNoteId: "_options",
            content: "",
            ignoreForbiddenParents: true
        })
    );
}

/**
 * Entity mutations performed by checkHiddenSubtree (createNewNote, save,
 * markAsDeleted) require an initialised CLS context.
 */
function withContext<T>(fn: () => T): T {
    return getContext().init(fn);
}

function checkHiddenSubtree(force = false) {
    return withContext(() => hiddenSubtreeService.checkHiddenSubtree(force));
}

describe("hidden_subtree (real DB)", () => {
    beforeAll(() => {
        // Materialise the full hidden subtree in the shared in-memory fixture DB.
        checkHiddenSubtree();
    });

    describe("checkHiddenSubtree structure", () => {
        it("creates the hidden root and its top-level containers under the expected parents", () => {
            const hidden = becca.notes["_hidden"];
            expect(hidden).toBeDefined();
            expect(hidden.type).toBe("doc");
            // The hidden root must be parented directly under the tree root.
            expect(hidden.getParentBranches().some((b) => b.parentNoteId === "root")).toBe(true);

            // A representative set of the declared children must exist and sit
            // directly under _hidden.
            for (const childId of ["_search", "_options", "_help", "_taskStates", "_lbRoot"]) {
                const child = becca.notes[childId];
                expect(child, `${childId} should exist`).toBeDefined();
                expect(
                    child.getParentBranches().some((b) => b.parentNoteId === "_hidden"),
                    `${childId} should be parented under _hidden`
                ).toBe(true);
            }

            // Nested children are placed under their declared parent, not the root.
            const taskStateNone = becca.notes["_taskStateNone"];
            expect(taskStateNone).toBeDefined();
            expect(taskStateNone.getParentBranches().some((b) => b.parentNoteId === "_taskStates")).toBe(true);
        });

        it("derives an iconClass label from the item icon", () => {
            // _sqlConsole declares icon "bx-data"; the recursion turns the icon
            // into an iconClass label prefixed with "bx ".
            const sqlConsole = becca.notes["_sqlConsole"];
            expect(sqlConsole).toBeDefined();
            const iconClass = sqlConsole.getOwnedLabelValue("iconClass");
            expect(iconClass).toBeTruthy();
            expect(iconClass!.startsWith("bx ")).toBe(true);
            expect(iconClass).toContain("bx-data");
        });

        it("applies declared labels and relations, materialising launcher templates", () => {
            // The note launcher template carries a declared launcherType label.
            const noteLauncher = becca.notes[LBTPL_NOTE_LAUNCHER];
            expect(noteLauncher).toBeDefined();
            expect(noteLauncher.getOwnedLabelValue("launcherType")).toBe("note");

            // The command launcher template likewise advertises its launcherType.
            const commandLauncher = becca.notes[LBTPL_COMMAND];
            expect(commandLauncher).toBeDefined();
            expect(commandLauncher.getOwnedLabelValue("launcherType")).toBe("command");

            // Every declared launchbar template note exists under the template root.
            const templateRoot = becca.notes[LBTPL_ROOT];
            expect(templateRoot).toBeDefined();
            for (const tplId of [
                LBTPL_BASE,
                LBTPL_COMMAND,
                LBTPL_NOTE_LAUNCHER,
                LBTPL_SCRIPT,
                LBTPL_WIDGET,
                LBTPL_SPACER,
                LBTPL_CUSTOM_WIDGET
            ]) {
                const tpl = becca.notes[tplId];
                expect(tpl, `${tplId} should exist`).toBeDefined();
                expect(tpl.getParentBranches().some((b) => b.parentNoteId === LBTPL_ROOT)).toBe(true);
            }
        });
    });

    describe("enforceAttributes", () => {
        it("removes attributes that are not part of the definition on an enforced note", () => {
            const hidden = becca.notes["_hidden"];
            expect(hidden).toBeDefined();

            // Sanity: the declared docName label survives enforcement.
            expect(hidden.getOwnedLabelValue("docName")).toBe("hidden");

            // Inject a stray owned label, then re-run the integrity check.
            withContext(() => {
                hidden.addLabel("strayLabelXyz", "should-be-removed");
            });
            expect(hidden.hasOwnedLabel("strayLabelXyz")).toBe(true);

            checkHiddenSubtree();

            // _hidden has enforceAttributes: true, so the undefined label is purged
            // while the declared docName label is preserved.
            expect(hidden.hasOwnedLabel("strayLabelXyz")).toBe(false);
            expect(hidden.getOwnedLabelValue("docName")).toBe("hidden");
        });

        it("repairs a modified value on an enforced attribute", () => {
            const hidden = becca.notes["_hidden"];
            const docNameAttr = hidden.getOwnedAttributes("label", "docName")[0];
            expect(docNameAttr).toBeDefined();

            withContext(() => {
                docNameAttr.value = "tampered";
                docNameAttr.save();
            });
            expect(hidden.getOwnedLabelValue("docName")).toBe("tampered");

            checkHiddenSubtree();

            expect(hidden.getOwnedLabelValue("docName")).toBe("hidden");
        });
    });

    describe("enforceDeleted", () => {
        it("removes deprecated notes marked enforceDeleted", () => {
            // _optionsImages and _optionsAi are declared with enforceDeleted: true.
            // Materialise them first so checkHiddenSubtree actually has a note to
            // delete — otherwise the assertion would pass vacuously even if the
            // enforceDeleted branch were removed.
            for (const deprecatedId of ["_optionsImages", "_optionsAi"]) {
                materialiseDeprecatedNote(deprecatedId);
                const note = becca.notes[deprecatedId] as BNote | undefined;
                expect(note, `${deprecatedId} should have been created`).toBeDefined();
            }

            checkHiddenSubtree();

            // The enforceDeleted branch must purge each materialised note.
            for (const deprecatedId of ["_optionsImages", "_optionsAi"]) {
                const note = becca.notes[deprecatedId] as BNote | undefined;
                expect(note, `${deprecatedId} should have been deleted`).toBeUndefined();
            }
        });

        it("re-deletes a deprecated note if it reappears", () => {
            const deprecatedId = "_optionsImages";

            // First reappearance: recreate the note and confirm a check deletes it.
            materialiseDeprecatedNote(deprecatedId);
            expect(becca.notes[deprecatedId]).toBeDefined();

            checkHiddenSubtree();
            expect(becca.notes[deprecatedId]).toBeUndefined();

            // Second reappearance: the deletion path must run again, not just rely
            // on the note already being absent.
            materialiseDeprecatedNote(deprecatedId);
            expect(becca.notes[deprecatedId]).toBeDefined();

            checkHiddenSubtree();
            expect(becca.notes[deprecatedId]).toBeUndefined();
        });
    });

    describe("type and idempotency", () => {
        it("restores a note type that was changed away from the definition", () => {
            const options = becca.notes["_options"];
            expect(options).toBeDefined();
            // Declared as a book.
            expect(options.type).toBe("book");

            withContext(() => {
                options.type = "text";
                options.save();
            });
            expect(becca.notes["_options"].type).toBe("text");

            checkHiddenSubtree();

            expect(becca.notes["_options"].type).toBe("book");
        });

        it("is idempotent: a repeated forced check does not duplicate branches", () => {
            const searchNote = becca.notes["_search"];
            expect(searchNote).toBeDefined();

            const beforeParents = searchNote
                .getParentBranches()
                .filter((b) => !b.isDeleted)
                .map((b) => b.parentNoteId)
                .sort();

            checkHiddenSubtree(true);
            checkHiddenSubtree(true);

            const afterParents = becca.notes["_search"]
                .getParentBranches()
                .filter((b) => !b.isDeleted)
                .map((b) => b.parentNoteId)
                .sort();

            expect(afterParents).toEqual(beforeParents);
            expect(afterParents).toContain("_hidden");
        });
    });

    describe("exported launchbar template constants", () => {
        it("all exported ids follow the hidden-note underscore convention and are unique", () => {
            const ids = [
                LBTPL_ROOT,
                LBTPL_BASE,
                LBTPL_NOTE_LAUNCHER,
                LBTPL_WIDGET,
                LBTPL_COMMAND,
                LBTPL_SCRIPT,
                LBTPL_SPACER,
                LBTPL_CUSTOM_WIDGET
            ];

            for (const id of ids) {
                expect(id.startsWith("_")).toBe(true);
            }
            expect(new Set(ids).size).toBe(ids.length);
        });
    });
});
