import type { BulkAction } from "@triliumnext/commons";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import becca from "../becca/becca.js";
import type BBranch from "../becca/entities/bbranch.js";
import type BNote from "../becca/entities/bnote.js";
import bulkActionService from "./bulk_actions.js";
import cloningService from "./cloning.js";
import config from "./config.js";
import { getContext } from "./context.js";
import noteService from "./notes.js";
import { getSql } from "./sql/index.js";

let counter = 0;

/**
 * Creates a fresh text note under the given parent in the real in-memory DB.
 * Each call uses a unique title since the same fixture DB is shared between
 * the `it()`s in this file.
 */
function createNote(parentNoteId: string): { note: BNote; branch: BBranch } {
    counter++;
    return getContext().init(() =>
        noteService.createNewNote({
            parentNoteId,
            title: `bulk-actions-spec-${counter}`,
            content: "<p>hello</p>",
            type: "text"
        })
    );
}

describe("bulk_actions service (real DB)", () => {
    // The executeScript action runs a backend script, gated by the backendScriptingEnabled toggle.
    const originalScriptingEnabled = config.Security.backendScriptingEnabled;

    beforeAll(() => {
        config.Security.backendScriptingEnabled = true;
    });

    afterAll(() => {
        config.Security.backendScriptingEnabled = originalScriptingEnabled;
    });

    describe("executeActions", () => {
        it("skips note IDs that don't resolve to a note", () => {
            // No note exists for this id, so nothing should throw and no handler runs.
            expect(() =>
                getContext().init(() =>
                    bulkActionService.executeActions(
                        [{ name: "addLabel", labelName: "foo", labelValue: "bar" }],
                        ["doesNotExist123"]
                    )
                )
            ).not.toThrow();
        });

        it("accepts both an array and a Set of note IDs", () => {
            const a = createNote("root");
            const b = createNote("root");

            getContext().init(() =>
                bulkActionService.executeActions(
                    [{ name: "addLabel", labelName: "fromSet" }],
                    new Set([a.note.noteId, b.note.noteId])
                )
            );

            expect(a.note.hasLabel("fromSet")).toBe(true);
            expect(b.note.hasLabel("fromSet")).toBe(true);
        });

        it("isolates per-note handler failures and keeps applying to remaining notes", () => {
            const note = createNote("root");

            // executeScript throws (ReferenceError), but the failure is caught per action,
            // so the subsequent addLabel action still runs against the same note.
            const actions: BulkAction[] = [
                { name: "executeScript", script: "thisIsNotDefined()" },
                { name: "addLabel", labelName: "appliedAfterFailure" }
            ];

            expect(() => getContext().init(() => bulkActionService.executeActions(actions, [note.note.noteId]))).not.toThrow();
            expect(note.note.hasLabel("appliedAfterFailure")).toBe(true);
        });
    });

    describe("label actions", () => {
        it("addLabel / updateLabelValue / renameLabel / deleteLabel", () => {
            const note = createNote("root");

            getContext().init(() =>
                bulkActionService.executeActions(
                    [{ name: "addLabel", labelName: "color", labelValue: "red" }],
                    [note.note.noteId]
                )
            );
            expect(note.note.getOwnedLabelValue("color")).toBe("red");

            getContext().init(() =>
                bulkActionService.executeActions(
                    [{ name: "updateLabelValue", labelName: "color", labelValue: "blue" }],
                    [note.note.noteId]
                )
            );
            expect(note.note.getOwnedLabelValue("color")).toBe("blue");

            getContext().init(() =>
                bulkActionService.executeActions(
                    [{ name: "renameLabel", oldLabelName: "color", newLabelName: "shade" }],
                    [note.note.noteId]
                )
            );
            expect(note.note.hasOwnedLabel("color")).toBe(false);
            expect(note.note.getOwnedLabelValue("shade")).toBe("blue");

            getContext().init(() =>
                bulkActionService.executeActions([{ name: "deleteLabel", labelName: "shade" }], [note.note.noteId])
            );
            expect(note.note.hasOwnedLabel("shade")).toBe(false);
        });
    });

    describe("relation actions", () => {
        it("addRelation / updateRelationTarget / renameRelation / deleteRelation", () => {
            const note = createNote("root");
            const targetA = createNote("root");
            const targetB = createNote("root");

            getContext().init(() =>
                bulkActionService.executeActions(
                    [{ name: "addRelation", relationName: "link", targetNoteId: targetA.note.noteId }],
                    [note.note.noteId]
                )
            );
            expect(note.note.getOwnedRelationValue("link")).toBe(targetA.note.noteId);

            getContext().init(() =>
                bulkActionService.executeActions(
                    [{ name: "updateRelationTarget", relationName: "link", targetNoteId: targetB.note.noteId }],
                    [note.note.noteId]
                )
            );
            expect(note.note.getOwnedRelationValue("link")).toBe(targetB.note.noteId);

            getContext().init(() =>
                bulkActionService.executeActions(
                    [{ name: "renameRelation", oldRelationName: "link", newRelationName: "ref" }],
                    [note.note.noteId]
                )
            );
            expect(note.note.getOwnedRelations("link").length).toBe(0);
            expect(note.note.getOwnedRelationValue("ref")).toBe(targetB.note.noteId);

            getContext().init(() =>
                bulkActionService.executeActions([{ name: "deleteRelation", relationName: "ref" }], [note.note.noteId])
            );
            expect(note.note.getOwnedRelations("ref").length).toBe(0);
        });
    });

    describe("renameNote", () => {
        it("evaluates the new title as a template with `note` in scope", () => {
            const note = createNote("root");

            getContext().init(() =>
                bulkActionService.executeActions(
                    [{ name: "renameNote", newTitle: "Prefix - ${note.noteId}" }],
                    [note.note.noteId]
                )
            );

            expect(note.note.title).toBe(`Prefix - ${note.note.noteId}`);
        });

        it("leaves the title untouched when the evaluated value is identical", () => {
            const note = createNote("root");
            const original = note.note.title;

            getContext().init(() =>
                bulkActionService.executeActions(
                    [{ name: "renameNote", newTitle: original }],
                    [note.note.noteId]
                )
            );

            expect(note.note.title).toBe(original);
        });
    });

    describe("executeScript", () => {
        it("runs the script against the note and persists changes", () => {
            const note = createNote("root");

            getContext().init(() =>
                bulkActionService.executeActions(
                    [{ name: "executeScript", script: "note.setLabel('scripted', 'yes')" }],
                    [note.note.noteId]
                )
            );

            expect(note.note.getOwnedLabelValue("scripted")).toBe("yes");
        });

        it("persists mutations even when the script returns early", () => {
            // A top-level `return` (used to exit early) must not skip the implicit
            // note.save(). A title change only reaches the DB via note.save(), so we
            // assert against the persisted row (the in-memory becca entity reflects the
            // mutation regardless of whether save() ran).
            const note = createNote("root");

            getContext().init(() =>
                bulkActionService.executeActions(
                    [{ name: "executeScript", script: "note.title = 'renamed by script';\nreturn;" }],
                    [note.note.noteId]
                )
            );

            const persistedTitle = getSql().getValue<string>("SELECT title FROM notes WHERE noteId = ?", [note.note.noteId]);
            expect(persistedTitle).toBe("renamed by script");
        });

        it("is a no-op for an empty / whitespace-only script", () => {
            const note = createNote("root");
            const labelsBefore = note.note.getOwnedAttributes().length;

            expect(() =>
                getContext().init(() =>
                    bulkActionService.executeActions([{ name: "executeScript", script: "   " }], [note.note.noteId])
                )
            ).not.toThrow();
            expect(note.note.getOwnedAttributes().length).toBe(labelsBefore);
        });
    });

    describe("deleteNote", () => {
        it("marks the targeted note as deleted", () => {
            const note = createNote("root");

            getContext().init(() =>
                bulkActionService.executeActions([{ name: "deleteNote" }], [note.note.noteId])
            );

            expect(note.note.isDeleted).toBe(true);
        });
    });

    describe("saveRevision", () => {
        it("saves a named revision capturing the note's current content", () => {
            const note = createNote("root");
            expect(note.note.getRevisions().length).toBe(0);

            getContext().init(() =>
                bulkActionService.executeActions([{ name: "saveRevision", revisionName: "milestone" }], [note.note.noteId])
            );

            const revisions = note.note.getRevisions();
            expect(revisions.length).toBe(1);
            // The revision "name" is stored in its description field.
            expect(revisions[0].description).toBe("milestone");
        });

        it("saves an unnamed revision when no name is provided", () => {
            const note = createNote("root");

            getContext().init(() =>
                bulkActionService.executeActions([{ name: "saveRevision" }], [note.note.noteId])
            );

            const revisions = note.note.getRevisions();
            expect(revisions.length).toBe(1);
            expect(revisions[0].description).toBe("");
        });
    });

    describe("deleteRevisions", () => {
        it("erases all revisions of the targeted note", () => {
            const note = createNote("root");

            getContext().init(() => note.note.saveRevision());
            expect(note.note.getRevisions().length).toBeGreaterThan(0);

            getContext().init(() =>
                bulkActionService.executeActions([{ name: "deleteRevisions" }], [note.note.noteId])
            );

            expect(note.note.getRevisions().length).toBe(0);
        });
    });

    describe("moveNote", () => {
        it("moves a single-parent note to the target parent", () => {
            const note = createNote("root");
            const target = createNote("root");

            getContext().init(() =>
                bulkActionService.executeActions(
                    [{ name: "moveNote", targetParentNoteId: target.note.noteId }],
                    [note.note.noteId]
                )
            );

            expect(target.note.getChildNotes().some((n) => n.noteId === note.note.noteId)).toBe(true);
            expect(becca.getBranchFromChildAndParent(note.note.noteId, "root")).toBeNull();
        });

        it("clones (rather than moves) a note that has multiple parents", () => {
            const note = createNote("root");
            const secondParent = createNote("root");
            const target = createNote("root");

            // Give the note a second branch so getParentBranches().length > 1.
            getContext().init(() =>
                cloningService.cloneNoteToParentNote(note.note.noteId, secondParent.note.noteId)
            );
            expect(note.note.getParentBranches().length).toBeGreaterThan(1);

            getContext().init(() =>
                bulkActionService.executeActions(
                    [{ name: "moveNote", targetParentNoteId: target.note.noteId }],
                    [note.note.noteId]
                )
            );

            // A clone is created under the target while the originals remain.
            expect(becca.getBranchFromChildAndParent(note.note.noteId, target.note.noteId)).not.toBeNull();
            expect(becca.getBranchFromChildAndParent(note.note.noteId, "root")).not.toBeNull();
        });

        it("is a no-op when the target parent does not exist", () => {
            const note = createNote("root");

            expect(() =>
                getContext().init(() =>
                    bulkActionService.executeActions(
                        [{ name: "moveNote", targetParentNoteId: "doesNotExist123" }],
                        [note.note.noteId]
                    )
                )
            ).not.toThrow();

            // The note stays where it was.
            expect(becca.getBranchFromChildAndParent(note.note.noteId, "root")).not.toBeNull();
        });
    });

    describe("executeActionsFromNote", () => {
        it("reads, parses and applies actions stored in the note's `action` labels", () => {
            const definitionNote = createNote("root");
            const target = createNote("root");

            getContext().init(() => {
                definitionNote.note.addLabel("action", JSON.stringify({ name: "addLabel", labelName: "fromDefinition", labelValue: "1" }));
                definitionNote.note.addLabel("action", JSON.stringify({ name: "addLabel", labelName: "second", labelValue: "2" }));
            });

            getContext().init(() =>
                bulkActionService.executeActionsFromNote(definitionNote.note, [target.note.noteId])
            );

            expect(target.note.getOwnedLabelValue("fromDefinition")).toBe("1");
            expect(target.note.getOwnedLabelValue("second")).toBe("2");
        });

        it("skips malformed JSON and unknown action handlers, applying only the valid ones", () => {
            const definitionNote = createNote("root");
            const target = createNote("root");

            getContext().init(() => {
                // Invalid JSON.
                definitionNote.note.addLabel("action", "{ not valid json");
                // Unknown handler name.
                definitionNote.note.addLabel("action", JSON.stringify({ name: "noSuchHandler", foo: "bar" }));
                // Valid action.
                definitionNote.note.addLabel("action", JSON.stringify({ name: "addLabel", labelName: "valid", labelValue: "ok" }));
            });

            expect(() =>
                getContext().init(() =>
                    bulkActionService.executeActionsFromNote(definitionNote.note, [target.note.noteId])
                )
            ).not.toThrow();

            expect(target.note.getOwnedLabelValue("valid")).toBe("ok");
        });
    });

    describe("convertNote", () => {
        function createMarkdownNote(): BNote {
            counter++;
            return getContext().init(() =>
                noteService.createNewNote({
                    parentNoteId: "root",
                    title: `bulk-convert-md-${counter}`,
                    content: "# Heading",
                    type: "code",
                    mime: "text/x-markdown"
                }).note
            );
        }

        it("converts only notes matching the conversion's source type, skipping the rest", () => {
            const textNote = createNote("root").note;
            const markdownNote = createMarkdownNote();

            getContext().init(() =>
                bulkActionService.executeActions(
                    [{ name: "convertNote", conversion: "htmlToMarkdown" }],
                    [textNote.noteId, markdownNote.noteId]
                )
            );

            // The text note is converted to a Markdown code note...
            expect(textNote.type).toBe("code");
            expect(textNote.mime).toBe("text/x-markdown");
            // ...while the already-Markdown note is left untouched.
            expect(markdownNote.type).toBe("code");
            expect(markdownNote.getContent()).toBe("# Heading");
        });

        it("converts a Markdown note back to a text note", () => {
            const markdownNote = createMarkdownNote();

            getContext().init(() =>
                bulkActionService.executeActions(
                    [{ name: "convertNote", conversion: "markdownToHtml" }],
                    [markdownNote.noteId]
                )
            );

            expect(markdownNote.type).toBe("text");
            expect(markdownNote.mime).toBe("text/html");
            expect(markdownNote.getContent()).toContain("<h2>Heading</h2>");
        });

        it("does nothing for an unknown or unset conversion", () => {
            const textNote = createNote("root").note;

            expect(() =>
                getContext().init(() =>
                    bulkActionService.executeActions(
                        [{ name: "convertNote", conversion: "" as never }],
                        [textNote.noteId]
                    )
                )
            ).not.toThrow();

            expect(textNote.type).toBe("text");
        });
    });
});
