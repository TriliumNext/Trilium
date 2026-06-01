import { beforeEach, describe, expect, it } from "vitest";

import becca from "../../../becca/becca.js";
import BBranch from "../../../becca/entities/bbranch.js";
import BNote from "../../../becca/entities/bnote.js";
import { note, NoteBuilder } from "../../../test/becca_mocking.js";
import NoteSet from "../note_set.js";
import AttributeExistsExp from "./attribute_exists.js";

// SearchContext-like argument is unused by execute(), so we pass an empty object.
const dummySearchContext = {} as any;

/** Build a NoteSet that contains every note currently registered in becca. */
function allNotesSet() {
    return new NoteSet(Object.values(becca.notes));
}

function execute(exp: AttributeExistsExp, inputNoteSet = allNotesSet()) {
    return exp.execute(inputNoteSet, {}, dummySearchContext);
}

function noteIds(noteSet: NoteSet) {
    return noteSet.notes.map((n) => n.noteId).sort();
}

let rootNote: NoteBuilder;

describe("AttributeExistsExp", () => {
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

    it("flags template labels in the constructor, leaving plain labels unmarked", () => {
        const plain = new AttributeExistsExp("label", "tag", false);
        expect(plain.attributeType).toBe("label");
        expect(plain.attributeName).toBe("tag");

        // `template` / `workspacetemplate` labels are markers and must not be treated
        // as inheritable; that decision is observed through execute() below.
        const template = new AttributeExistsExp("label", "template", false);
        const workspaceTemplate = new AttributeExistsExp("label", "workspacetemplate", false);
        const relationNamedTemplate = new AttributeExistsExp("relation", "template", false);

        const tmpl = note("Template").label("template", "", /* isInheritable */ true);
        const child = note("Child");
        tmpl.child(child);
        rootNote.child(tmpl);

        // A real (inheritable) `template` label is found but only the note itself is added.
        expect(noteIds(execute(template))).toEqual([tmpl.note.noteId]);
        // The other expressions simply find nothing matching.
        expect(execute(workspaceTemplate).notes).toHaveLength(0);
        expect(execute(relationNamedTemplate).notes).toHaveLength(0);
    });

    it("matches notes that own the attribute, regardless of value", () => {
        const austria = note("Austria").label("capital", "Vienna");
        const germany = note("Germany").label("capital");
        const plain = note("Plain");
        rootNote.child(austria).child(germany).child(plain);

        const exp = new AttributeExistsExp("label", "capital", false);
        expect(noteIds(execute(exp))).toEqual([austria.note.noteId, germany.note.noteId].sort());
    });

    it("returns an empty set when no note owns the attribute", () => {
        rootNote.child(note("Plain"));

        const exp = new AttributeExistsExp("label", "missing", false);
        expect(execute(exp).notes).toHaveLength(0);
    });

    it("respects the attribute type, distinguishing labels from relations", () => {
        const target = note("Target");
        const withRelation = note("WithRelation").relation("ref", target.note);
        const withLabel = note("WithLabel").label("ref", "value");
        rootNote.child(target).child(withRelation).child(withLabel);

        const labelExp = new AttributeExistsExp("label", "ref", false);
        expect(noteIds(execute(labelExp))).toEqual([withLabel.note.noteId]);

        const relationExp = new AttributeExistsExp("relation", "ref", false);
        expect(noteIds(execute(relationExp))).toEqual([withRelation.note.noteId]);
    });

    it("matches the attribute name case-insensitively", () => {
        const tagged = note("Tagged").label("capital", "Vienna");
        rootNote.child(tagged);

        // becca lowercases/normalizes attribute names, so an upper-case query still matches.
        const exp = new AttributeExistsExp("label", "Capital", false);
        expect(noteIds(execute(exp))).toEqual([tagged.note.noteId]);
    });

    it("only returns notes that are present in the input note set", () => {
        const austria = note("Austria").label("capital", "Vienna");
        const germany = note("Germany").label("capital", "Berlin");
        rootNote.child(austria).child(germany);

        const exp = new AttributeExistsExp("label", "capital", false);

        const restricted = new NoteSet([austria.note]);
        expect(noteIds(execute(exp, restricted))).toEqual([austria.note.noteId]);
    });

    it("adds the whole subtree (including templated notes) for an inheritable attribute", () => {
        const parent = note("Parent").label("tag", "x", /* isInheritable */ true);
        const child = note("Child");
        const grandchild = note("Grandchild");
        parent.child(child.child(grandchild));
        rootNote.child(parent);

        const exp = new AttributeExistsExp("label", "tag", false);
        expect(noteIds(execute(exp))).toEqual(
            [parent.note.noteId, child.note.noteId, grandchild.note.noteId].sort()
        );
    });

    it("adds inheriting notes when the owning note is used as a template", () => {
        const template = note("Template").label("tag", "x");
        const consumer = note("Consumer").relation("template", template.note);
        rootNote.child(template).child(consumer);

        const exp = new AttributeExistsExp("label", "tag", false);
        // getInheritingNotes() returns the note itself plus notes inheriting from it.
        expect(noteIds(execute(exp))).toEqual([template.note.noteId, consumer.note.noteId].sort());
    });

    it("adds only the note itself when the attribute is neither inheritable nor inherited", () => {
        const plain = note("Plain").label("tag", "x");
        rootNote.child(plain);

        const exp = new AttributeExistsExp("label", "tag", false);
        expect(noteIds(execute(exp))).toEqual([plain.note.noteId]);
    });

    it("never expands template/workspacetemplate labels even when inheritable or inherited", () => {
        // An inheritable `template` label would normally pull in the whole subtree,
        // but the template-marker short-circuit limits it to the note itself.
        const inheritableTemplate = note("InheritableTemplate").label(
            "template",
            "",
            /* isInheritable */ true
        );
        const child = note("TemplateChild");
        inheritableTemplate.child(child);
        rootNote.child(inheritableTemplate);

        // A `workspacetemplate` label whose note is itself targeted by a template relation
        // would normally pull in inheriting notes, but is likewise limited to the note.
        const workspaceTemplate = note("WorkspaceTemplate").label("workspacetemplate");
        const consumer = note("WsConsumer").relation("template", workspaceTemplate.note);
        rootNote.child(workspaceTemplate).child(consumer);

        const templateExp = new AttributeExistsExp("label", "template", false);
        expect(noteIds(execute(templateExp))).toEqual([inheritableTemplate.note.noteId]);

        const workspaceExp = new AttributeExistsExp("label", "workspacetemplate", false);
        expect(noteIds(execute(workspaceExp))).toEqual([workspaceTemplate.note.noteId]);
    });

    it("matches attributes by name prefix when prefixMatch is enabled", () => {
        const archived = note("Archived").label("archived");
        const archivedDeep = note("ArchivedDeep").label("archiveDepth", "3");
        const unrelated = note("Unrelated").label("category", "misc");
        rootNote.child(archived).child(archivedDeep).child(unrelated);

        // Prefix "archiv" matches both `archived` and `archivedepth` (names are lowercased),
        // but not the unrelated `category` label.
        const prefixExp = new AttributeExistsExp("label", "archiv", true);
        expect(noteIds(execute(prefixExp))).toEqual(
            [archived.note.noteId, archivedDeep.note.noteId].sort()
        );

        // Without prefix matching the same partial name matches nothing exactly.
        const exactExp = new AttributeExistsExp("label", "archiv", false);
        expect(execute(exactExp).notes).toHaveLength(0);
    });
});
