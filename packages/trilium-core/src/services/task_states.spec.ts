import {
    DEFAULT_TASK_STATES,
    DONE_STATE_ID,
    NONE_STATE_ID,
    TASK_STATES_CONTAINER_ID,
    type TaskStateDef
} from "@triliumnext/commons";
import { beforeAll, describe, expect, it } from "vitest";

import becca from "../becca/becca.js";
import BAttribute from "../becca/entities/battribute.js";
import type BNote from "../becca/entities/bnote.js";
import { getContext } from "./context.js";
import hiddenSubtreeService from "./hidden_subtree.js";
import { createTaskStateNote, generateTaskStateCss, getTaskStates } from "./task_states.js";

/**
 * Entity mutations (createNewNote, BAttribute.save, branch.save, markAsDeleted)
 * require an initialised CLS context.
 */
function withContext<T>(fn: () => T): T {
    return getContext().init(fn);
}

let counter = 0;

/** A self-contained, valid custom state with a unique name/symbol per call. */
function customState(overrides: Partial<TaskStateDef> = {}): TaskStateDef {
    counter++;
    return {
        name: `state${counter}`,
        title: `State ${counter}`,
        markdownSymbol: "",
        isCompleted: false,
        color: "#123456",
        icon: "bx bx-loader",
        ...overrides
    };
}

describe("task_states (real DB)", () => {
    beforeAll(() => {
        // Materialise the _taskStates container with its none/done anchors and the
        // seeded custom defaults into the shared in-memory fixture DB. Idempotent.
        withContext(() => hiddenSubtreeService.checkHiddenSubtree());
    });

    describe("getTaskStates", () => {
        it("returns the seeded default states with anchors mapped to their fixed definitions", () => {
            const states = getTaskStates();

            // The seeded container yields the full default ordered sequence.
            expect(states.map((s) => s.name)).toEqual(DEFAULT_TASK_STATES.map((s) => s.name));

            // The none/done anchors are returned as their fixed built-in definitions,
            // not reconstructed from the note's labels.
            const none = states.find((s) => s.id === NONE_STATE_ID);
            const done = states.find((s) => s.id === DONE_STATE_ID);
            expect(none).toMatchObject({ name: "none", markdownSymbol: " ", isCompleted: false });
            expect(done).toMatchObject({ name: "done", markdownSymbol: "x", isCompleted: true });

            // Custom states are read from their promoted labels.
            const doing = states.find((s) => s.name === "doing");
            expect(doing).toBeDefined();
            expect(doing!.markdownSymbol).toBe("/");
            expect(doing!.isCompleted).toBe(false);
        });

        it("ignores archived definition notes entirely", () => {
            const note = withContext(() =>
                createTaskStateNote(customState({ name: "archivedState", markdownSymbol: "@" }))
            );
            withContext(() => note.addLabel("archived"));
            expect(note.isArchived).toBe(true);

            const names = getTaskStates().map((s) => s.name);
            expect(names).not.toContain("archivedState");
        });

        it("drops invalid custom states while keeping the valid ones", () => {
            // A custom state with a name containing a space fails validation and is dropped.
            const invalid = withContext(() =>
                createTaskStateNote(customState({ name: "not valid", markdownSymbol: "!" }))
            );

            const states = getTaskStates();
            expect(states.some((s) => s.id === invalid.noteId)).toBe(false);
            // The seeded anchors and valid defaults survive the validation pass.
            expect(states.some((s) => s.id === NONE_STATE_ID)).toBe(true);
            expect(states.some((s) => s.id === DONE_STATE_ID)).toBe(true);
        });

        it("falls back to DEFAULT_TASK_STATES when the container note is missing", () => {
            const realContainer = becca.notes[TASK_STATES_CONTAINER_ID];
            try {
                // Temporarily hide the container so the early-return branch is hit.
                delete becca.notes[TASK_STATES_CONTAINER_ID];
                expect(getTaskStates()).toBe(DEFAULT_TASK_STATES);
            } finally {
                becca.notes[TASK_STATES_CONTAINER_ID] = realContainer;
            }
        });
    });

    describe("createTaskStateNote", () => {
        it("creates a doc note under the container with the promoted state labels", () => {
            const state = customState({
                name: "review",
                title: "Review",
                markdownSymbol: "r",
                isCompleted: true,
                color: "#ff8800",
                icon: "bx bx-search"
            });

            const note = withContext(() => createTaskStateNote(state));

            expect(note.type).toBe("doc");
            expect(note.title).toBe("Review");
            // Parented under the task states container.
            expect(
                note.getParentBranches().some((b) => b.parentNoteId === TASK_STATES_CONTAINER_ID)
            ).toBe(true);

            // The promoted attributes mirror the state definition (booleans stringified).
            expect(note.getLabelValue("stateId")).toBe("review");
            expect(note.getLabelValue("markdownSymbol")).toBe("r");
            expect(note.getLabelValue("isCompleted")).toBe("true");
            expect(note.getLabelValue("color")).toBe("#ff8800");
            expect(note.getLabelValue("iconClass")).toBe("bx bx-search");
            expect(note.getLabelValue("docName")).toBe("task_state");

            // Label attribute ids follow the deterministic `${noteId}_l${name}` scheme.
            const stateIdAttr = note.getOwnedAttributes("label", "stateId")[0];
            expect(stateIdAttr).toBeInstanceOf(BAttribute);
            expect(stateIdAttr.attributeId).toBe(`${note.noteId}_lstateId`);
        });

        it("honours the explicit noteId and title overrides", () => {
            counter++;
            const noteId = `customTaskStateSpec${counter}`;
            const note = withContext(() =>
                createTaskStateNote(customState({ name: `over${counter}`, markdownSymbol: "" }), {
                    noteId,
                    title: "Overridden title"
                })
            );

            expect(note.noteId).toBe(noteId);
            expect(note.title).toBe("Overridden title");
            expect(becca.notes[noteId]).toBe(note);
        });

        it("round-trips a created custom state through getTaskStates", () => {
            const state = customState({
                name: "roundtrip",
                title: "Round Trip",
                markdownSymbol: "~",
                isCompleted: false,
                color: "#00aa55",
                icon: "bx bx-time"
            });

            const note: BNote = withContext(() => createTaskStateNote(state));
            const read = getTaskStates().find((s) => s.id === note.noteId);

            expect(read).toBeDefined();
            expect(read).toMatchObject({
                name: "roundtrip",
                title: "Round Trip",
                markdownSymbol: "~",
                isCompleted: false,
                color: "#00aa55",
                icon: "bx bx-time",
                isHidden: false
            });
        });
    });

    describe("generateTaskStateCss", () => {
        it("emits a checkbox rule per non-anchor custom state with a resolvable icon", () => {
            const css = generateTaskStateCss();

            // Anchors (none/done) carry no custom checkbox glyph rule.
            expect(css).not.toContain(`[data-trilium-task-state="none"]`);
            expect(css).not.toContain(`[data-trilium-task-state="done"]`);

            // The seeded "doing" state uses `bx bx-loader`, which resolves against the
            // built-in boxicons manifest, so it produces a rule with the glyph/family vars.
            expect(css).toContain(`[data-trilium-task-state="doing"]`);
            expect(css).toContain("--task-state-glyph:");
            expect(css).toContain("--task-state-glyph-font-family:");
        });

        it("computes a hue var for chromatic colors and leaves grayscale colors as unset", () => {
            // "maybe" is seeded without a color → no hue, color falls back to inherit.
            const maybeNote = withContext(() =>
                createTaskStateNote(
                    customState({ name: "graystate", markdownSymbol: "g", color: "#808080" })
                )
            );
            const colorNote = withContext(() =>
                createTaskStateNote(
                    customState({ name: "colorstate", markdownSymbol: "c", color: "#ff0000" })
                )
            );

            const css = generateTaskStateCss();

            // Each state's selector appears twice in its rule, so take the tail after
            // the last occurrence — that segment holds the declaration block.
            const declBlock = (name: string) => {
                const parts = css.split(`[data-trilium-task-state="${name}"]`);
                return parts[parts.length - 1] ?? "";
            };

            // The grayscale state (zero saturation) yields `--task-state-hue: unset`.
            expect(declBlock("graystate")).toContain("--task-state-hue: unset");

            // The pure-red state has a defined hue (0) rather than unset.
            const colorBlock = declBlock("colorstate");
            expect(colorBlock).toContain("--task-state-hue: 0");
            expect(colorBlock).toContain("--task-state-color: #ff0000");

            expect(maybeNote.noteId).toBeTruthy();
            expect(colorNote.noteId).toBeTruthy();
        });

        it("skips states whose icon cannot be resolved to a glyph", () => {
            const note = withContext(() =>
                createTaskStateNote(
                    customState({ name: "noicon", markdownSymbol: "n", icon: "bx bx-this-icon-does-not-exist" })
                )
            );
            expect(note.noteId).toBeTruthy();

            const css = generateTaskStateCss();
            // The state exists and is valid, but its icon does not map to a manifest
            // glyph, so generateTaskStateCss produces no rule for it.
            expect(css).not.toContain(`[data-trilium-task-state="noicon"]`);
        });
    });
});
