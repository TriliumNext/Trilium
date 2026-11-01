import { beforeEach, describe, expect, it } from "vitest";

import { getBecca } from "../../../becca/becca.js";
import BBranch from "../../../becca/entities/bbranch.js";
import BNote from "../../../becca/entities/bnote.js";
import { note, NoteBuilder } from "../../../test/becca_mocking.js";
import NoteSet from "../note_set.js";
import IsHiddenExp from "./is_hidden.js";

// SearchContext-like argument is unused by execute(), so we pass an empty object.
const dummySearchContext = {} as any;

/** Build a NoteSet that contains every note currently registered in getBecca(). */
function allNotesSet() {
    return new NoteSet(Object.values(getBecca().notes));
}

function execute(exp: IsHiddenExp, inputNoteSet = allNotesSet()) {
    return exp.execute(inputNoteSet, {}, dummySearchContext);
}

function noteIds(noteSet: NoteSet) {
    return noteSet.notes.map((n) => n.noteId).sort();
}

let rootNote: NoteBuilder;
let hiddenNote: NoteBuilder;

describe("IsHiddenExp", () => {
    beforeEach(() => {
        getBecca().reset();

        rootNote = new NoteBuilder(new BNote({ noteId: "root", title: "root", type: "text" }));
        new BBranch({
            branchId: "none_root",
            noteId: "root",
            parentNoteId: "none",
            notePosition: 10
        });

        // The hidden subtree root; notes living only under it are "hidden completely".
        hiddenNote = note("hidden", { noteId: "_hidden" });
        rootNote.child(hiddenNote);
    });

    it("keeps only notes that live entirely inside the hidden subtree", () => {
        const visible = note("Visible");
        const hidden = note("Hidden");
        rootNote.child(visible);
        hiddenNote.child(hidden);

        const result = execute(new IsHiddenExp());

        // The _hidden subtree root sits directly under root, so it is the visible
        // boundary and is not itself hidden; only its descendants are.
        expect(noteIds(result)).toEqual([hidden.note.noteId]);
        expect(result.hasNoteId(visible.note.noteId)).toBe(false);
        expect(result.hasNoteId("_hidden")).toBe(false);
    });

    it("never treats the root note as hidden", () => {
        const result = execute(new IsHiddenExp());

        expect(result.hasNoteId("root")).toBe(false);
    });

    it("treats descendants of the hidden subtree as hidden", () => {
        const child = note("HiddenChild");
        const grandchild = note("HiddenGrandchild");
        hiddenNote.child(child.child(grandchild));

        const result = execute(new IsHiddenExp());

        expect(result.hasNoteId(child.note.noteId)).toBe(true);
        expect(result.hasNoteId(grandchild.note.noteId)).toBe(true);
    });

    it("does not treat a note as hidden when it is also cloned into the visible tree", () => {
        // A note reachable from root through a non-hidden path is visible even if it
        // also has a parent in the hidden subtree.
        const cloned = note("Cloned");
        hiddenNote.child(cloned);
        rootNote.child(cloned);

        const result = execute(new IsHiddenExp());

        expect(result.hasNoteId(cloned.note.noteId)).toBe(false);
    });

    it("treats a note hidden only because its sole visible-looking parent is itself hidden", () => {
        // hiddenParent lives under _hidden, so it is hidden completely; its child has no
        // other path, so it inherits the hidden state recursively.
        const hiddenParent = note("HiddenParent");
        const child = note("Child");
        hiddenNote.child(hiddenParent.child(child));

        const result = execute(new IsHiddenExp());

        expect(result.hasNoteId(hiddenParent.note.noteId)).toBe(true);
        expect(result.hasNoteId(child.note.noteId)).toBe(true);
    });

    it("only considers notes present in the input note set", () => {
        const hiddenA = note("HiddenA");
        const hiddenB = note("HiddenB");
        hiddenNote.child(hiddenA).child(hiddenB);

        // Restrict the input set to just hiddenA; hiddenB must be excluded even though it
        // is also hidden.
        const restricted = new NoteSet([hiddenA.note]);
        const result = execute(new IsHiddenExp(), restricted);

        expect(noteIds(result)).toEqual([hiddenA.note.noteId]);
    });

    it("returns an empty set when no input note is hidden", () => {
        const a = note("A");
        const b = note("B");
        rootNote.child(a).child(b);

        const restricted = new NoteSet([a.note, b.note]);
        const result = execute(new IsHiddenExp(), restricted);

        expect(result.notes).toHaveLength(0);
    });
});
