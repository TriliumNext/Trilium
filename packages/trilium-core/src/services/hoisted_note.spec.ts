import { describe, expect, it } from "vitest";

import { getBecca } from "../becca/becca.js";
import type BNote from "../becca/entities/bnote.js";
import { getContext } from "./context.js";
import hoistedNoteService from "./hoisted_note.js";
import noteService from "./notes.js";

/**
 * The real `cls` `ExecutionContext` is installed by `initializeCore` (run once
 * in the server spec `setup.ts`). `getHoistedNoteId()` reads `hoistedNoteId`
 * from that context, defaulting to `"root"`. Each `init()` runs in a fresh
 * store, so the hoisted note id set inside one block is isolated from others.
 */
function withHoisted<T>(hoistedNoteId: string, fn: () => T): T {
    return getContext().init(() => {
        getContext().set("hoistedNoteId", hoistedNoteId);
        return fn();
    });
}

let counter = 0;

/** Creates a fresh text note under root in the real in-memory DB. */
function createNote(): BNote {
    counter++;
    return getContext().init(() =>
        noteService.createNewNote({
            parentNoteId: "root",
            title: `hoisted-note-spec-${counter}`,
            content: "<p>hello</p>",
            type: "text"
        }).note
    );
}

describe("hoisted_note service (real DB)", () => {
    describe("getHoistedNoteId", () => {
        it("defaults to 'root' and reflects an explicitly set value", () => {
            // No hoisted note set -> falls back to "root".
            getContext().init(() => {
                expect(hoistedNoteService.getHoistedNoteId()).toBe("root");
            });

            withHoisted("someNoteId", () => {
                expect(hoistedNoteService.getHoistedNoteId()).toBe("someNoteId");
            });
        });
    });

    describe("isHoistedInHiddenSubtree", () => {
        it("returns false when hoisted on root", () => {
            withHoisted("root", () => {
                expect(hoistedNoteService.isHoistedInHiddenSubtree()).toBe(false);
            });
        });

        it("returns true when hoisted directly on the _hidden subtree root", () => {
            withHoisted("_hidden", () => {
                expect(hoistedNoteService.isHoistedInHiddenSubtree()).toBe(true);
            });
        });

        it("reflects isHiddenCompletely() of a real hoisted note", () => {
            // A note cloned directly under root is NOT hidden completely.
            const visible = createNote();
            expect(visible.isHiddenCompletely()).toBe(false);

            withHoisted(visible.noteId, () => {
                expect(hoistedNoteService.isHoistedInHiddenSubtree()).toBe(false);
            });
        });

        it("throws when the hoisted note cannot be found in becca", () => {
            withHoisted("nonExistentNote123", () => {
                expect(() => hoistedNoteService.isHoistedInHiddenSubtree()).toThrow(
                    /Cannot find hoisted note 'nonExistentNote123'/
                );
            });
        });
    });

    describe("getWorkspaceNote", () => {
        it("returns the root note when hoisted on root", () => {
            withHoisted("root", () => {
                const workspace = hoistedNoteService.getWorkspaceNote();
                expect(workspace).toBe(getBecca().getRoot());
                expect(workspace?.noteId).toBe("root");
            });
        });

        it("returns the hoisted note itself when it carries the 'workspace' label", () => {
            const note = createNote();
            getContext().init(() => note.addLabel("workspace"));

            withHoisted(note.noteId, () => {
                expect(hoistedNoteService.getWorkspaceNote()).toBe(note);
            });
        });

        it("falls back to the root note when the hoisted note is not a workspace", () => {
            // A plain note (no 'workspace' label, not root) is not itself a workspace.
            const note = createNote();
            expect(note.hasLabel("workspace")).toBe(false);

            withHoisted(note.noteId, () => {
                const workspace = hoistedNoteService.getWorkspaceNote();
                expect(workspace).toBe(getBecca().getRoot());
                expect(workspace?.noteId).toBe("root");
            });
        });

        it("falls back to the root note when the hoisted note does not exist", () => {
            withHoisted("nonExistentNote123", () => {
                expect(hoistedNoteService.getWorkspaceNote()).toBe(getBecca().getRoot());
            });
        });
    });
});
