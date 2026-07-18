import { beforeEach, describe, expect, it } from "vitest";

import becca from "../../../becca/becca.js";
import BBranch from "../../../becca/entities/bbranch.js";
import BNote from "../../../becca/entities/bnote.js";
import { note, NoteBuilder } from "../../../test/becca_mocking.js";
import NoteSet from "../note_set.js";
import PropertyComparisonExp from "./property_comparison.js";

/** Build a NoteSet that contains every note currently registered in becca. */
function allNotesSet() {
    return new NoteSet(Object.values(becca.notes));
}

function execute(exp: PropertyComparisonExp, searchContext: any = {}, inputNoteSet = allNotesSet()) {
    return exp.execute(inputNoteSet, {}, searchContext);
}

function noteIds(noteSet: NoteSet) {
    return noteSet.notes.map((n) => n.noteId).sort();
}

let rootNote: NoteBuilder;

describe("PropertyComparisonExp", () => {
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

    describe("isProperty", () => {
        it("recognises known (lower-cased) property names", () => {
            expect(PropertyComparisonExp.isProperty("title")).toBe(true);
            expect(PropertyComparisonExp.isProperty("noteid")).toBe(true);
            expect(PropertyComparisonExp.isProperty("childrencount")).toBe(true);
            expect(PropertyComparisonExp.isProperty("contentsize")).toBe(true);
        });

        it("rejects unknown or wrongly-cased names", () => {
            expect(PropertyComparisonExp.isProperty("noteId")).toBe(false);
            expect(PropertyComparisonExp.isProperty("bogus")).toBe(false);
            expect(PropertyComparisonExp.isProperty("")).toBe(false);
        });
    });

    describe("constructor", () => {
        it("maps the lower-cased property name to its case-sensitive form", () => {
            const exp = new PropertyComparisonExp({}, "datecreated", "=", "x");
            expect(exp.propertyName).toBe("dateCreated");
            expect(exp.operator).toBe("=");
            expect(exp.comparedValue).toBe("x");
        });

        it("does not flag dbLoadNeeded for non-DB-backed properties", () => {
            const searchContext: any = {};
            new PropertyComparisonExp(searchContext, "title", "=", "hello");
            expect(searchContext.dbLoadNeeded).toBeUndefined();
        });

        it("leaves dbLoadNeeded unset for DB-backed properties (mapped name never matches the lower-cased guard)", () => {
            // The guard compares the already case-mapped propertyName ("contentSize") against
            // a list of lower-cased names ("contentsize"), so it can never match - dbLoadNeeded
            // is therefore never set here. This locks in the current observed behaviour.
            for (const prop of [
                "contentsize",
                "contentandattachmentssize",
                "contentandattachmentsandrevisionssize",
                "revisioncount"
            ]) {
                const searchContext: any = {};
                new PropertyComparisonExp(searchContext, prop, ">", "0");
                expect(searchContext.dbLoadNeeded).toBeUndefined();
            }
        });
    });

    describe("execute", () => {
        it("matches notes by an exact string property (case-insensitive)", () => {
            const code = note("Code", { type: "code" });
            const text = note("Text", { type: "text" });
            rootNote.child(code).child(text);

            const exp = new PropertyComparisonExp({}, "type", "=", "code");
            expect(noteIds(execute(exp))).toEqual([code.note.noteId]);
        });

        it("compares the title case-insensitively via the lower-cased value", () => {
            const austria = note("Austria");
            rootNote.child(austria);

            // The note's title "Austria" is lower-cased before comparison, and the comparator
            // also lower-cases its target, so a mixed-case search term still matches.
            const exp = new PropertyComparisonExp({}, "title", "=", "Austria");
            expect(noteIds(execute(exp))).toEqual([austria.note.noteId]);
        });

        it("supports substring operators on string properties", () => {
            const aaa = note("Apple");
            const bbb = note("Grape");
            rootNote.child(aaa).child(bbb);

            const startsWith = new PropertyComparisonExp({}, "title", "=*", "app");
            expect(noteIds(execute(startsWith))).toEqual([aaa.note.noteId]);

            const contains = new PropertyComparisonExp({}, "title", "*=*", "rap");
            expect(noteIds(execute(contains))).toEqual([bbb.note.noteId]);
        });

        it("stringifies and lower-cases non-string property values before comparing", () => {
            // childrenCount is a number; parent has two children, leaves have zero.
            const childA = note("ChildA");
            const childB = note("ChildB");
            const parent = note("Parent");
            parent.child(childA).child(childB);
            rootNote.child(parent);

            const hasTwoChildren = new PropertyComparisonExp({}, "childrencount", "=", "2");
            expect(noteIds(execute(hasTwoChildren))).toEqual([parent.note.noteId]);
        });

        it("supports numeric comparison operators on numeric properties", () => {
            const childA = note("ChildA");
            const childB = note("ChildB");
            const parent = note("Parent");
            parent.child(childA).child(childB);
            rootNote.child(parent);

            // childrenCount > 0 should match the parent (2) and root (1), excluding the leaves.
            const exp = new PropertyComparisonExp({}, "childrencount", ">", "0");
            expect(noteIds(execute(exp))).toEqual(
                [rootNote.note.noteId, parent.note.noteId].sort()
            );
        });

        it("treats a falsy (zero) numeric value as an empty value for the comparator", () => {
            // A leaf note has childrenCount === 0. Because execute() only lower-cases truthy
            // values, the stringified "0" stays "0" and the numeric comparator parses it.
            const leaf = note("Leaf");
            rootNote.child(leaf);

            const exp = new PropertyComparisonExp({}, "childrencount", "<", "1");
            expect(noteIds(execute(exp))).toContain(leaf.note.noteId);
            expect(execute(exp).notes.map((n) => n.noteId)).not.toContain(rootNote.note.noteId);
        });

        it("returns an empty set when nothing satisfies the comparator", () => {
            const austria = note("Austria");
            rootNote.child(austria);

            const exp = new PropertyComparisonExp({}, "type", "=", "image");
            expect(execute(exp).notes).toHaveLength(0);
        });

        it("only considers notes present in the input note set", () => {
            const codeA = note("CodeA", { type: "code" });
            const codeB = note("CodeB", { type: "code" });
            rootNote.child(codeA).child(codeB);

            const exp = new PropertyComparisonExp({}, "type", "=", "code");
            const restricted = new NoteSet([codeA.note]);
            expect(noteIds(execute(exp, {}, restricted))).toEqual([codeA.note.noteId]);
        });

        it("returns an empty set when the operator is unknown (no comparator built)", () => {
            const austria = note("Austria");
            rootNote.child(austria);

            // buildComparator returns undefined for an unsupported operator, so execute() never
            // adds any note.
            const exp = new PropertyComparisonExp({}, "title", "??", "Austria");
            expect(execute(exp).notes).toHaveLength(0);
        });

        it("matches on noteId, mapping the lower-cased 'noteid' to the real property", () => {
            const target = note("Target");
            rootNote.child(target);

            const exp = new PropertyComparisonExp({}, "noteid", "=", target.note.noteId);
            expect(noteIds(execute(exp))).toEqual([target.note.noteId]);
        });
    });
});
