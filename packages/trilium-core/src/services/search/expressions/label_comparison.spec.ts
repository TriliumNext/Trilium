import { beforeEach, describe, expect, it } from "vitest";

import becca from "../../../becca/becca.js";
import BBranch from "../../../becca/entities/bbranch.js";
import BNote from "../../../becca/entities/bnote.js";
import { note, NoteBuilder } from "../../../test/becca_mocking.js";
import NoteSet from "../note_set.js";
import LabelComparisonExp from "./label_comparison.js";

// SearchContext-like argument is unused by execute(), so we pass an empty object.
const dummySearchContext = {} as any;

/** Build a NoteSet that contains every note currently registered in becca. */
function allNotesSet() {
    return new NoteSet(Object.values(becca.notes));
}

function execute(exp: LabelComparisonExp, inputNoteSet = allNotesSet()) {
    return exp.execute(inputNoteSet, {}, dummySearchContext);
}

function noteIds(noteSet: NoteSet) {
    return noteSet.notes.map((n) => n.noteId).sort();
}

let rootNote: NoteBuilder;

describe("LabelComparisonExp", () => {
    beforeEach(() => {
        becca.reset();

        rootNote = new NoteBuilder(new BNote({ noteId: "root", title: "root", type: "text" }));
        new BBranch({
            branchId: "none_root",
            noteId: "root",
            parentNoteId: "none",
            notePosition: 10
        });
    });

    it("lowercases the attribute name in the constructor", () => {
        const exp = new LabelComparisonExp("label", "Capital", () => true);
        expect(exp.attributeName).toBe("capital");
        expect(exp.attributeType).toBe("label");
    });

    it("matches notes whose label value satisfies the comparator", () => {
        const austria = note("Austria").label("capital", "Vienna");
        const germany = note("Germany").label("capital", "Berlin");
        rootNote.child(austria).child(germany);

        const exp = new LabelComparisonExp("label", "capital", (value) => value === "vienna");
        const result = execute(exp);

        expect(noteIds(result)).toEqual([austria.note.noteId]);
    });

    it("returns an empty set when the comparator rejects every value", () => {
        const austria = note("Austria").label("capital", "Vienna");
        rootNote.child(austria);

        const exp = new LabelComparisonExp("label", "capital", () => false);
        const result = execute(exp);

        expect(result.notes).toHaveLength(0);
    });

    it("compares against a lowercased value (case-insensitive matching)", () => {
        const austria = note("Austria").label("capital", "VIENNA");
        rootNote.child(austria);

        // The comparator receives the lowercased value, so an uppercase target never matches...
        const upper = new LabelComparisonExp("label", "capital", (value) => value === "VIENNA");
        expect(execute(upper).notes).toHaveLength(0);

        // ...while the lowercased equivalent does.
        const lower = new LabelComparisonExp("label", "capital", (value) => value === "vienna");
        expect(noteIds(execute(lower))).toEqual([austria.note.noteId]);
    });

    it("only considers notes present in the input note set", () => {
        const austria = note("Austria").label("capital", "Vienna");
        const germany = note("Germany").label("capital", "Berlin");
        rootNote.child(austria).child(germany);

        const exp = new LabelComparisonExp("label", "capital", () => true);

        // Restrict the input set to just Austria; Germany must be excluded even though
        // it also carries a matching label.
        const restricted = new NoteSet([austria.note]);
        expect(noteIds(execute(exp, restricted))).toEqual([austria.note.noteId]);
    });

    it("respects the attribute type, ignoring relations with the same name", () => {
        const target = note("Target");
        const withRelation = note("WithRelation").relation("ref", target.note);
        const withLabel = note("WithLabel").label("ref", "value");
        rootNote.child(target).child(withRelation).child(withLabel);

        const labelExp = new LabelComparisonExp("label", "ref", () => true);
        expect(noteIds(execute(labelExp))).toEqual([withLabel.note.noteId]);

        const relationExp = new LabelComparisonExp("relation", "ref", () => true);
        expect(noteIds(execute(relationExp))).toEqual([withRelation.note.noteId]);
    });

    it("handles labels with an empty value by passing an empty string to the comparator", () => {
        const empty = note("Empty").label("flag");
        rootNote.child(empty);

        const received: string[] = [];
        const exp = new LabelComparisonExp("label", "flag", (value) => {
            received.push(value);
            return value === "";
        });

        expect(noteIds(execute(exp))).toEqual([empty.note.noteId]);
        expect(received).toEqual([""]);
    });

    it("adds the whole subtree (including templated notes) for an inheritable label", () => {
        const parent = note("Parent").label("tag", "x", /* isInheritable */ true);
        const child = note("Child");
        const grandchild = note("Grandchild");
        parent.child(child.child(grandchild));
        rootNote.child(parent);

        const exp = new LabelComparisonExp("label", "tag", () => true);
        const result = execute(exp);

        expect(noteIds(result)).toEqual(
            [parent.note.noteId, child.note.noteId, grandchild.note.noteId].sort()
        );
    });

    it("adds inheriting notes when the labelled note is used as a template", () => {
        const template = note("Template").label("tag", "x");
        const consumer = note("Consumer").relation("template", template.note);
        rootNote.child(template).child(consumer);

        const exp = new LabelComparisonExp("label", "tag", () => true);
        const result = execute(exp);

        // getInheritingNotes() returns the note itself plus notes inheriting from it.
        expect(noteIds(result)).toEqual([template.note.noteId, consumer.note.noteId].sort());
    });

    it("adds only the note itself when the label is neither inheritable nor inherited", () => {
        const plain = note("Plain").label("tag", "x");
        rootNote.child(plain);

        const exp = new LabelComparisonExp("label", "tag", () => true);
        const result = execute(exp);

        expect(noteIds(result)).toEqual([plain.note.noteId]);
    });
});
