import type { HiddenSubtreeItem } from "@triliumnext/commons";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import becca from "../becca/becca.js";
import BBranch from "../becca/entities/bbranch.js";
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
import { getLog } from "./log.js";
import migrationService from "./migration.js";
import * as templatesModule from "./hidden_subtree_templates.js";
import noteService from "./notes.js";

/** Items appended to `_templates`, so a spec can drive definitions the built-in tree does not use. */
const extraTemplates = { items: [] as HiddenSubtreeItem[] };
const buildTemplates = templatesModule.default;
vi.spyOn(templatesModule, "default").mockImplementation(() => {
    const templates = buildTemplates();
    return { ...templates, children: [ ...templates.children, ...extraTemplates.items ] };
});

/**
 * Re-create a deprecated hidden-subtree note under its declared parent so the
 * enforceDeleted branch in checkHiddenSubtree has something to delete. Both
 * deprecated entries live directly under "_options" in the definition.
 */
function materialiseDeprecatedNote(noteId: string) {
    getContext().init(() =>
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

function checkHiddenSubtree(force = false) {
    return getContext().init(() => hiddenSubtreeService.checkHiddenSubtree(force));
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
            // directly under _hidden. (_help is deliberately absent: it is a virtual
            // subtree owned by the in-app help provider, not by checkHiddenSubtree —
            // see in_app_help.spec.ts.)
            for (const childId of ["_search", "_options", "_taskStates", "_lbRoot"]) {
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

        it("marks the settings pages that have nothing to set in the standalone build", () => {
            // The client's settings navigation reads these (isOptionPageVisibleOnPlatform); a rename
            // here would silently put the pages back rather than fail anywhere.
            for (const pageId of [ "_optionsPassword", "_optionsEtapi" ]) {
                expect(becca.notes[pageId]?.isLabelTruthy("notInStandalone"), pageId).toBe(true);
            }
            // Not a blanket mark: the pages that do apply everywhere carry nothing.
            expect(becca.notes._optionsAppearance?.isLabelTruthy("notInStandalone")).toBe(false);
        });
    });

    describe("enforceAttributes", () => {
        it("removes attributes that are not part of the definition on an enforced note", () => {
            const hidden = becca.notes["_hidden"];
            expect(hidden).toBeDefined();

            // Sanity: the declared docName label survives enforcement.
            expect(hidden.getOwnedLabelValue("docName")).toBe("hidden");

            // Inject a stray owned label, then re-run the integrity check.
            getContext().init(() => {
                hidden.addLabel("strayLabelXyz", "should-be-removed");
            });
            expect(hidden.hasOwnedLabel("strayLabelXyz")).toBe(true);

            checkHiddenSubtree();

            // _hidden has enforceAttributes: true, so the undefined label is purged
            // while the declared docName label is preserved.
            expect(hidden.hasOwnedLabel("strayLabelXyz")).toBe(false);
            expect(hidden.getOwnedLabelValue("docName")).toBe("hidden");
        });

        it("does not re-save a value-less enforced attribute on every run", () => {
            // `_template_text_snippet` declares `#textSnippet`/`#template` with no value, so they
            // are stored as "". The enforcement compare used the raw (undefined) definition value,
            // so `"" !== undefined` re-saved them on every run — and save() always emits a sync
            // entity change, which churned `entitiesReloaded` and tore down every open text editor.
            // The compare now normalizes undefined → "" to match what is actually written.
            const snippet = becca.notes["_template_text_snippet"];
            expect(snippet).toBeDefined();
            const textSnippetAttr = snippet.getOwnedAttributes("label", "textSnippet")[0];
            expect(textSnippetAttr).toBeDefined();
            expect(textSnippetAttr.value).toBe("");

            const saveSpy = vi.spyOn(textSnippetAttr, "save");
            checkHiddenSubtree();
            expect(saveSpy).not.toHaveBeenCalled();
            saveSpy.mockRestore();
        });

        it("repairs a modified value on an enforced attribute", () => {
            const hidden = becca.notes["_hidden"];
            const docNameAttr = hidden.getOwnedAttributes("label", "docName")[0];
            expect(docNameAttr).toBeDefined();

            getContext().init(() => {
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

    describe("the order the settings pages are held in", () => {
        /** The settings pages under `_options`, read in the order the tree holds them. */
        function pageOrder() {
            return becca.notes["_options"].getChildBranches()
                .filter((branch) => !branch.isDeleted)
                .sort((a, b) => a.notePosition - b.notePosition)
                .map((branch) => branch.noteId);
        }

        it("puts them back in the declared order after one is moved, not only on a new database", () => {
            const before = pageOrder();
            expect(before[0]).toBe("_optionsAppearance");
            expect(before.length).toBeGreaterThan(1);

            // A database that already holds them in some other order: send the first page last.
            const moved = becca.notes["_options"].getChildBranches()
                .find((branch) => branch.noteId === "_optionsAppearance");
            getContext().init(() => {
                if (moved) {
                    moved.notePosition = 999;
                    moved.save();
                }
            });
            expect(pageOrder()[0]).not.toBe("_optionsAppearance");

            checkHiddenSubtree();

            expect(pageOrder()).toEqual(before);
        });

        it("leaves a group the user arranges alone, the launcher bar declaring no order", () => {
            const launchers = becca.notes["_lbRoot"].getChildBranches().filter((b) => !b.isDeleted);
            const moved = launchers[0];
            const rearranged = moved.notePosition + 5;

            getContext().init(() => {
                moved.notePosition = rearranged;
                moved.save();
            });

            checkHiddenSubtree();

            expect(moved.notePosition).toBe(rearranged);
        });
    });

    describe("type and idempotency", () => {
        it("restores a note type that was changed away from the definition", () => {
            const options = becca.notes["_options"];
            expect(options).toBeDefined();
            // Declared as a book.
            expect(options.type).toBe("book");

            getContext().init(() => {
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
    describe("migration guard", () => {
        it("does not touch the tree while the database still awaits migrations", () => {
            const hidden = becca.notes["_hidden"];
            getContext().init(() => {
                hidden.addLabel("strayDuringMigration", "x");
            });
            vi.spyOn(migrationService, "isDbUpToDate").mockReturnValueOnce(false);

            checkHiddenSubtree();
            expect(hidden.hasOwnedLabel("strayDuringMigration")).toBe(true);

            checkHiddenSubtree();
            expect(hidden.hasOwnedLabel("strayDuringMigration")).toBe(false);
        });
    });

    describe("definitions the built-in tree does not exercise", () => {
        afterEach(() => {
            extraTemplates.items = [];
        });

        function createNote(noteId: string, parentNoteId: string, extra: { type?: "text" | "code"; mime?: string; content?: string } = {}) {
            return getContext().init(() => noteService.createNewNote({
                noteId,
                title: noteId,
                type: extra.type ?? "text",
                mime: extra.mime,
                parentNoteId,
                content: extra.content ?? "",
                ignoreForbiddenParents: true
            }).note);
        }

        function liveParents(noteId: string) {
            return becca.getNoteOrThrow(noteId).getParentBranches()
                .filter((branch) => !branch.isDeleted)
                .map((branch) => branch.parentNoteId)
                .sort();
        }

        function branchUnder(noteId: string, parentNoteId: string) {
            return becca.getNoteOrThrow(noteId).getParentBranches()
                .find((branch) => branch.parentNoteId === parentNoteId);
        }

        it("moves an enforceBranches note into place, keeping only clones outside the hidden tree", () => {
            createNote("_testEnforced", "root", { type: "code", mime: "text/x-python", content: "print()" });
            createNote("testUserParent", "root");
            createNote("_testEnforcedPos", "root");
            getContext().init(() => {
                new BBranch({ noteId: "_testEnforced", parentNoteId: "testUserParent" }).save();
                new BBranch({ noteId: "_testEnforced", parentNoteId: "_hidden" }).save();
            });
            extraTemplates.items = [
                { id: "_testEnforced", title: "Enforced", type: "code", mime: "text/plain", content: "print()", enforceBranches: true },
                { id: "_testEnforcedPos", title: "Positioned", type: "text", enforceBranches: true, notePosition: 5, isExpanded: true }
            ];

            checkHiddenSubtree(true);

            // The clones under `root` and `_hidden` go; the one under a user note stays.
            expect(liveParents("_testEnforced")).toEqual([ "_templates", "testUserParent" ]);
            expect(becca.getNoteOrThrow("_testEnforced").mime).toBe("text/plain");
            expect(branchUnder("_testEnforced", "_templates")?.isExpanded).toBe(false);
            expect(liveParents("_testEnforcedPos")).toEqual([ "_templates" ]);
            expect(branchUnder("_testEnforcedPos", "_templates")?.notePosition).toBe(5);
            expect(branchUnder("_testEnforcedPos", "_templates")?.isExpanded).toBe(true);

            // A later run finds the branch in place and only repairs its state.
            getContext().init(() => {
                const positioned = branchUnder("_testEnforcedPos", "_templates");
                if (positioned) {
                    positioned.isExpanded = false;
                    positioned.save();
                }
            });
            checkHiddenSubtree(true);
            expect(liveParents("_testEnforcedPos")).toEqual([ "_templates" ]);
            expect(branchUnder("_testEnforcedPos", "_templates")?.isExpanded).toBe(true);
        });

        it("restores a tampered docName label, reading a missing value as empty", () => {
            extraTemplates.items = [
                { id: "_testDocNamed", title: "Doc", type: "text", attributes: [ { type: "label", name: "docName", value: "doc_named" } ] },
                { id: "_testDocBlank", title: "Blank", type: "text", attributes: [ { type: "label", name: "docName" } ] }
            ];
            checkHiddenSubtree(true);

            const named = becca.getNoteOrThrow("_testDocNamed").getOwnedAttributes("label", "docName")[0];
            getContext().init(() => {
                named.value = "tampered";
                named.save();
            });
            const blank = becca.getNoteOrThrow("_testDocBlank").getOwnedAttributes("label", "docName")[0];
            expect(blank.value).toBe("");
            const blankSave = vi.spyOn(blank, "save");

            checkHiddenSubtree(true);

            expect(becca.getNoteOrThrow("_testDocNamed").getOwnedLabelValue("docName")).toBe("doc_named");
            expect(blankSave).not.toHaveBeenCalled();
        });

        it("logs content it cannot read instead of aborting the check", () => {
            extraTemplates.items = [ { id: "_testContent", title: "Content", type: "text", content: "<p>x</p>" } ];
            checkHiddenSubtree(true);

            const note = becca.getNoteOrThrow("_testContent");
            const errorSpy = vi.spyOn(getLog(), "error");
            const stackless = new Error("no stack");
            stackless.stack = undefined;
            for (const thrown of [ new Error("with stack"), stackless, "plain string" ]) {
                vi.spyOn(note, "getContent").mockImplementationOnce(() => {
                    throw thrown;
                });
                checkHiddenSubtree(true);
            }

            const messages = errorSpy.mock.calls.map(([ message ]) => String(message));
            expect(messages).toHaveLength(3);
            expect(messages[0]).toContain("with stack");
            expect(messages[1]).toContain("_testContent: no stack");
            expect(messages[2]).toContain("_testContent: plain string");
        });

        it("rejects a malformed definition", () => {
            const malformed: [HiddenSubtreeItem, RegExp][] = [
                [ { id: "_testUntitled", title: "", type: "text" }, /mandatory properties/ ],
                [ { id: "testNoUnderscore", title: "No underscore", type: "text" }, /has to start with underscore/ ],
                [ { id: "_testIdleLauncher", title: "Idle launcher", type: "launcher" }, /No action defined/ ]
            ];
            for (const [ item, error ] of malformed) {
                extraTemplates.items = [ item ];
                expect(() => checkHiddenSubtree(true)).toThrow(error);
            }
        });
    });
});
