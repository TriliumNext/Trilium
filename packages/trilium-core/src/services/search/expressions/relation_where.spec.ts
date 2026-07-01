import { beforeEach, describe, expect, it } from "vitest";

import { getBecca } from "../../../becca/becca.js";
import BAttribute from "../../../becca/entities/battribute.js";
import BBranch from "../../../becca/entities/bbranch.js";
import BNote from "../../../becca/entities/bnote.js";
import { id, note, NoteBuilder } from "../../../test/becca_mocking.js";
import Expression from "./expression.js";
import NoteSet from "../note_set.js";
import RelationWhereExp from "./relation_where.js";

// SearchContext-like argument is unused by execute(), so we pass an empty object.
const dummySearchContext = {} as any;

/** Build a NoteSet that contains every note currently registered in getBecca(). */
function allNotesSet() {
    return new NoteSet(Object.values(getBecca().notes));
}

function execute(exp: RelationWhereExp, inputNoteSet = allNotesSet()) {
    return exp.execute(inputNoteSet, {}, dummySearchContext);
}

function noteIds(noteSet: NoteSet) {
    return noteSet.notes.map((n) => n.noteId).sort();
}

/**
 * A sub-expression stub that returns its input note set unchanged when `matches`
 * is true, and an empty set otherwise. RelationWhereExp keeps a relation's source
 * note when the sub-result still contains the relation's target note, so returning
 * the input verbatim simulates a "matching" sub-condition.
 */
class StubExp extends Expression {
    constructor(
        private matches: boolean,
        public received: NoteSet[] = []
    ) {
        super();
    }

    execute(inputNoteSet: NoteSet) {
        this.received.push(inputNoteSet);
        return this.matches ? inputNoteSet : new NoteSet();
    }
}

const matchAll = () => new StubExp(true);
const matchNone = () => new StubExp(false);

let rootNote: NoteBuilder;

describe("RelationWhereExp", () => {
    beforeEach(() => {
        getBecca().reset();

        rootNote = new NoteBuilder(new BNote({ noteId: "root", title: "root", type: "text" }));
        new BBranch({
            branchId: "none_root",
            noteId: "root",
            parentNoteId: "none",
            notePosition: 10
        });
    });

    it("keeps the source note when the sub-expression matches the relation target", () => {
        const target = note("Target");
        const source = note("Source").relation("author", target.note);
        rootNote.child(target).child(source);

        const exp = new RelationWhereExp("author", matchAll());
        expect(noteIds(execute(exp))).toEqual([source.note.noteId]);
    });

    it("drops the source note when the sub-expression rejects the relation target", () => {
        const target = note("Target");
        const source = note("Source").relation("author", target.note);
        rootNote.child(target).child(source);

        const exp = new RelationWhereExp("author", matchNone());
        expect(execute(exp).notes).toHaveLength(0);
    });

    it("runs the sub-expression against a note set containing only the relation target", () => {
        const target = note("Target");
        const source = note("Source").relation("author", target.note);
        rootNote.child(target).child(source);

        const stub = matchAll();
        new RelationWhereExp("author", stub).execute(allNotesSet(), {}, dummySearchContext);

        expect(stub.received).toHaveLength(1);
        expect(noteIds(stub.received[0])).toEqual([target.note.noteId]);
    });

    it("considers only relations with the requested name", () => {
        const target = note("Target");
        const author = note("Author").relation("author", target.note);
        const editor = note("Editor").relation("editor", target.note);
        rootNote.child(target).child(author).child(editor);

        const exp = new RelationWhereExp("author", matchAll());
        expect(noteIds(execute(exp))).toEqual([author.note.noteId]);
    });

    it("ignores labels that share the relation's name", () => {
        const target = note("Target");
        const withRelation = note("WithRelation").relation("ref", target.note);
        const withLabel = note("WithLabel").label("ref", target.note.noteId);
        rootNote.child(target).child(withRelation).child(withLabel);

        const exp = new RelationWhereExp("ref", matchAll());
        expect(noteIds(execute(exp))).toEqual([withRelation.note.noteId]);
    });

    it("only keeps source notes that are present in the input note set", () => {
        const target = note("Target");
        const inSet = note("InSet").relation("author", target.note);
        const outOfSet = note("OutOfSet").relation("author", target.note);
        rootNote.child(target).child(inSet).child(outOfSet);

        const exp = new RelationWhereExp("author", matchAll());

        // Restrict the input to the target plus only one of the two source notes;
        // the source that is absent from the input must be excluded.
        const restricted = new NoteSet([target.note, inSet.note]);
        expect(noteIds(execute(exp, restricted))).toEqual([inSet.note.noteId]);
    });

    it("skips relations whose target note no longer exists", () => {
        const source = note("Source").relation("author", note("Ghost").note);
        // Build the relation against a note that is never attached to the tree and
        // then remove it from becca so attr.targetNote resolves to undefined.
        const ghostId = source.note.getRelationValue("author")!;
        delete getBecca().notes[ghostId];
        rootNote.child(source);

        const exp = new RelationWhereExp("author", matchAll());
        expect(execute(exp).notes).toHaveLength(0);
    });

    it("returns an empty set when no relation with that name exists", () => {
        const lonely = note("Lonely");
        rootNote.child(lonely);

        const exp = new RelationWhereExp("author", matchAll());
        expect(execute(exp).notes).toHaveLength(0);
    });

    it("expands an inheritable relation to the whole subtree of the source", () => {
        const target = note("Target");
        const parent = note("Parent");
        // The mocking `relation()` helper always creates a non-inheritable attribute,
        // so build the inheritable relation directly (the BAttribute constructor
        // registers in becca without a persisting save() that needs CLS).
        new BAttribute({
            attributeId: id(),
            noteId: parent.note.noteId,
            type: "relation",
            name: "author",
            value: target.note.noteId,
            isInheritable: true
        });
        const child = note("Child");
        const grandchild = note("Grandchild");
        parent.child(child.child(grandchild));
        rootNote.child(target).child(parent);

        const exp = new RelationWhereExp("author", matchAll());
        expect(noteIds(execute(exp))).toEqual(
            [parent.note.noteId, child.note.noteId, grandchild.note.noteId].sort()
        );
    });

    it("expands to inheriting notes when the source is used as a template", () => {
        const target = note("Target");
        // The source carries the matched relation and is also a template target,
        // so isInherited() is true and getInheritingNotes() is used.
        const source = note("Source").relation("author", target.note);
        const consumer = note("Consumer").relation("template", source.note);
        rootNote.child(target).child(source).child(consumer);

        const exp = new RelationWhereExp("author", matchAll());
        expect(noteIds(execute(exp))).toEqual(
            [source.note.noteId, consumer.note.noteId].sort()
        );
    });

    it("adds only the source note when the relation is neither inheritable nor inherited", () => {
        const target = note("Target");
        const source = note("Source").relation("author", target.note);
        rootNote.child(target).child(source);

        const exp = new RelationWhereExp("author", matchAll());
        expect(noteIds(execute(exp))).toEqual([source.note.noteId]);
    });
});
