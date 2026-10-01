import { beforeAll, describe, expect, it } from "vitest";

import becca from "../becca/becca.js";
import { ValidationError } from "../errors.js";
import attributeService from "./attributes.js";
import { init as clsInit } from "./context.js";
import noteService from "./notes.js";
import {
    connectPredicateConcept,
    createPredicateConcept,
    deleteReification,
    findReificationNote,
    listPredicateOptions,
    listReificationsIncluding,
    defineReification,
    expandReification,
    refreshReificationInstance,
    reifyAttribute,
    specifyReificationPlace,
    retarget,
    selfReifyNote,
    specifyObject,
    unspecifyObject
} from "./reification.js";

function makeNote(title: string): string {
    return clsInit(() =>
        noteService.createNewNote({
            parentNoteId: "root",
            title,
            content: "",
            type: "text"
        }).note.noteId
    );
}

describe("reification", () => {
    beforeAll(() => {
        // The in-memory fixture and initializeCore are booted by the host suite.
    });

    it("creates one note per attribute row, under the reification root, and repeats the call in place", () => {
        const sourceId = makeNote("Note A");
        const targetId = makeNote("Note B");

        const relation = clsInit(() => attributeService.createRelation(sourceId, "supports", targetId));
        const first = clsInit(() => reifyAttribute(relation.attributeId));

        expect(first.created).toBe(true);
        expect(first.note.title).toBe("supports(Note A, Note B)");
        expect(first.note.getParentBranches().some((branch) => branch.parentNoteId === "_reifications")).toBe(true);
        expect(first.note.getOwnedLabelValue("reificationOf")).toBe(relation.attributeId);
        expect(first.note.getOwnedLabelValue("reificationKind")).toBe("relation");
        expect(first.note.getOwnedLabelValue("reificationPredicate")).toBe("supports");
        expect(first.note.getOwnedRelation("reificationSubject")?.value).toBe(sourceId);
        expect(first.note.getOwnedRelation("reificationObject")?.value).toBe(targetId);
        expect(first.note.getOwnedLabelValue("iconClass")).toBe("bx bx-git-commit");

        const second = clsInit(() => reifyAttribute(relation.attributeId));
        expect(second.created).toBe(false);
        expect(second.note.noteId).toBe(first.note.noteId);
    });

    it("titles a label from its value, and keeps a title the user has edited", () => {
        const sourceId = makeNote("Climate paper");
        const label = clsInit(() => attributeService.createLabel(sourceId, "confidence", "0.2"));
        const { note } = clsInit(() => reifyAttribute(label.attributeId));

        expect(note.title).toBe("confidence(Climate paper, 0.2)");
        expect(note.getOwnedLabelValue("reificationLiteral")).toBe("0.2");
        expect(note.getOwnedRelation("reificationObject")).toBeNull();

        clsInit(() => {
            note.title = "The key inference";
            note.save();
            label.value = "0.9";
            label.save();
        });

        const token = becca.getNote(note.noteId);
        expect(token?.title).toBe("The key inference");
        expect(token?.getOwnedLabelValue("reificationLiteral")).toBe("0.9");
        expect(token?.getOwnedLabelValue("reificationGeneratedTitle")).toBe("confidence(Climate paper, 0.9)");
    });

    it("follows a renamed attribute and is removed when the attribute is deleted", () => {
        const sourceId = makeNote("Claim");
        const label = clsInit(() => attributeService.createLabel(sourceId, "status", "open"));
        const { note } = clsInit(() => reifyAttribute(label.attributeId));
        const tokenId = note.noteId;

        clsInit(() => {
            const renamed = label.createClone("label", "state", "open");
            renamed.save();
            retarget(label, renamed);
            label.markAsDeleted();

            expect(becca.getNote(tokenId)?.getOwnedLabelValue("reificationOf")).toBe(renamed.attributeId);
            expect(becca.getNote(tokenId)?.getOwnedLabelValue("reificationPredicate")).toBe("state");
            expect(findReificationNote(label.attributeId)).toBeNull();

            renamed.markAsDeleted();
        });

        expect(becca.getNote(tokenId)).toBeNull();
    });

    it("refuses a structural attribute and removes a reification on request", () => {
        const sourceId = makeNote("Claim");
        const label = clsInit(() => attributeService.createLabel(sourceId, "status", "open"));
        const { note } = clsInit(() => reifyAttribute(label.attributeId));
        const structural = note.getOwnedLabel("reificationOf");

        expect(structural).not.toBeNull();
        if (!structural) {
            return;
        }
        expect(() => clsInit(() => reifyAttribute(structural.attributeId))).toThrow(ValidationError);

        clsInit(() => deleteReification(label.attributeId));
        expect(findReificationNote(label.attributeId)).toBeNull();
        expect(becca.getAttribute(label.attributeId)?.value).toBe("open");
    });

    it("rewrites a generated title when an endpoint note is renamed", () => {
        const sourceId = makeNote("Note A");
        const targetId = makeNote("Note B");
        const relation = clsInit(() => attributeService.createRelation(sourceId, "isChildOf", targetId));
        const { note } = clsInit(() => reifyAttribute(relation.attributeId));

        expect(note.title).toBe("isChildOf(Note A, Note B)");

        clsInit(() => {
            const source = becca.getNoteOrThrow(sourceId);
            source.title = "Prince Charles";
            source.save();
            noteService.triggerNoteTitleChanged(source);
        });

        expect(becca.getNote(note.noteId)?.title).toBe("isChildOf(Prince Charles, Note B)");
    });

    it("lists the reification of a relation and the reifications that take it as an argument", () => {
        const john = makeNote("John");
        const mary = makeNote("Mary");
        const mark = makeNote("Mark");
        const loves = clsInit(() => attributeService.createRelation(john, "loves", mary));
        const lovesNote = clsInit(() => reifyAttribute(loves.attributeId)).note;
        const cause = clsInit(() => attributeService.createRelation(lovesNote.noteId, "cause", mark));
        const causeNote = clsInit(() => reifyAttribute(cause.attributeId)).note;

        const listed = listReificationsIncluding(loves.attributeId);
        expect(listed.map((item) => item.title)).toEqual([
            "loves(John, Mary)",
            "cause(loves(John, Mary), Mark)"
        ]);
        expect(listed[0]).toMatchObject({ noteId: lovesNote.noteId, direct: true });
        expect(listed[1]).toMatchObject({ noteId: causeNote.noteId, direct: false });
    });

    it("makes the relation name its own concept, apart from one instance of it", () => {
        const created = clsInit(() => createPredicateConcept("loves"));
        expect(created.created).toBe(true);
        expect(created.note.title).toBe("loves");
        expect(created.note.getOwnedLabelValue("reificationOfPredicate")).toBe("loves");
        expect(created.note.getOwnedLabelValue("iconClass")).toBe("bx bx-cube");
        expect(created.note.getParentBranches().some((branch) => branch.parentNoteId === "_reifications")).toBe(false);

        const again = clsInit(() => createPredicateConcept("loves"));
        expect(again.created).toBe(false);
        expect(again.note.noteId).toBe(created.note.noteId);

        const kindness = makeNote("Kindness");
        const connected = clsInit(() => connectPredicateConcept("hates", kindness));
        expect(connected.created).toBe(true);
        expect(connected.note.noteId).toBe(kindness);
        expect(connected.note.getOwnedLabelValue("reificationOfPredicate")).toBe("hates");

        const other = makeNote("Other");
        const kept = clsInit(() => connectPredicateConcept("hates", other));
        expect(kept.note.noteId).toBe(kindness);
        expect(() => clsInit(() => connectPredicateConcept("adores", kindness))).toThrow(ValidationError);
    });

    it("turns a label into a relation by specifying its object, and back into a label", () => {
        const source = makeNote("Climate paper");
        const label = clsInit(() => attributeService.createLabel(source, "certainty", "0.8"));
        const token = clsInit(() => reifyAttribute(label.attributeId)).note;

        expect(listPredicateOptions("certainty")).toEqual([]);

        const specified = clsInit(() => specifyObject(label.attributeId));
        expect(specified.created).toBe(true);
        expect(specified.note.title).toBe("0.8");
        expect(specified.note.getParentBranches().some((branch) => branch.parentNoteId === "_reifications")).toBe(false);
        expect(becca.getNote(source)?.getOwnedRelations("certainty").map((relation) => relation.value)).toEqual([ specified.note.noteId ]);
        expect(findReificationNote(specified.attributeId)?.noteId).toBe(token.noteId);
        expect(token.getOwnedLabelValue("reificationKind")).toBe("relation");

        clsInit(() => createPredicateConcept("certainty"));
        expect(listPredicateOptions("certainty")).toEqual([ { noteId: specified.note.noteId, title: "0.8" } ]);

        const high = makeNote("High");
        const again = clsInit(() => attributeService.createLabel(source, "certainty", "high"));
        const connected = clsInit(() => specifyObject(again.attributeId, high));
        expect(connected.created).toBe(false);
        expect(connected.note.noteId).toBe(high);
        expect(listPredicateOptions("certainty").map((option) => option.title)).toEqual([ "0.8", "High" ]);

        const unspecified = clsInit(() => unspecifyObject(specified.attributeId));
        expect(unspecified.value).toBe("0.8");
        expect(findReificationNote(unspecified.attributeId)?.noteId).toBe(token.noteId);
        expect(token.getOwnedLabelValue("reificationKind")).toBe("label");
        expect(listPredicateOptions("certainty").map((option) => option.noteId)).toEqual([ high ]);
        expect(becca.getNote(specified.note.noteId)?.isDeleted).toBe(false);
    });

    it("names the note that talks about a note, one level at a time", () => {
        const mary = makeNote("Mary");
        const first = clsInit(() => selfReifyNote(mary));
        expect(first.created).toBe(true);
        expect(first.note.title).toBe("Mary'");
        expect(first.note.getOwnedLabelValue("selfReificationOf")).toBe(mary);
        expect(first.note.getParentBranches().some((branch) => branch.parentNoteId === "_reifications")).toBe(false);

        const again = clsInit(() => selfReifyNote(mary));
        expect(again.created).toBe(false);
        expect(again.note.noteId).toBe(first.note.noteId);

        const second = clsInit(() => selfReifyNote(first.note.noteId));
        const third = clsInit(() => selfReifyNote(second.note.noteId));
        const fourth = clsInit(() => selfReifyNote(third.note.noteId));
        const fifth = clsInit(() => selfReifyNote(fourth.note.noteId));
        expect(second.note.title).toBe("Mary''");
        expect(third.note.title).toBe("Mary'''");
        expect(fourth.note.title).toBe("Mary(4)");
        expect(fifth.note.title).toBe("Mary(5)");

        clsInit(() => {
            const source = becca.getNoteOrThrow(mary);
            source.title = "Maria";
            source.save();
            noteService.triggerNoteTitleChanged(source);
        });
        expect(becca.getNote(first.note.noteId)?.title).toBe("Maria'");
        expect(becca.getNote(second.note.noteId)?.title).toBe("Maria''");

        clsInit(() => {
            first.note.title = "kept";
            first.note.save();
            const source = becca.getNoteOrThrow(mary);
            source.title = "Marie";
            source.save();
            noteService.triggerNoteTitleChanged(source);
        });
        expect(becca.getNote(first.note.noteId)?.title).toBe("kept");
        expect(becca.getNote(second.note.noteId)?.title).toBe("Maria''");
    });

    it("fills a formula from the places that were given and leaves the rest empty", () => {
        const pattern = clsInit(() => defineReification("helloFormula(A, B) = R(A, B), B'"));
        expect(pattern.pattern).toBe("helloFormula(A, B) = R(A, B); B'");

        const ann = makeNote("Ann");
        const bob = makeNote("Bob");
        const instance = clsInit(() => expandReification("helloFormula", { A: ann })).note;
        expect(instance.title).toBe("helloFormula(Ann, B)");
        expect(instance.getChildNotes().map((note) => note.title)).toEqual([ "Ann" ]);

        const again = clsInit(() => expandReification("helloFormula", { A: ann }));
        expect(again.note.noteId).toBe(instance.noteId);

        const blank = clsInit(() => expandReification("helloFormula")).note;
        expect(blank.title).toBe("helloFormula(A, B)");
        expect(blank.noteId).not.toBe(instance.noteId);
        expect(blank.getChildNotes()).toHaveLength(0);

        clsInit(() => specifyReificationPlace(instance.noteId, "B", bob));
        const titles = instance.getChildNotes().map((note) => note.title);
        expect(titles).toContain("Bob");
        expect(titles).toContain("R(Ann, Bob)");
        expect(titles).toContain("Bob'");
        const lifted = instance.getChildNotes().find((note) => note.title === "Bob'");
        expect(lifted?.getOwnedLabelValue("selfReificationOf")).toBe(bob);

        clsInit(() => defineReification("helloFormula(A, B) = R(A, B); B'; A'"));
        clsInit(() => refreshReificationInstance(instance.noteId));
        expect(instance.getChildNotes().map((note) => note.title)).toContain("Ann'");

        clsInit(() => defineReification("outerFormula(A, B) = helloFormula(A, B)"));
        const outer = clsInit(() => expandReification("outerFormula", { A: ann, B: bob })).note;
        const token = outer.getChildNotes().find((note) => note.title === "helloFormula(Ann, Bob)");
        expect(token?.getOwnedLabelValue("reificationOf")).toBeTruthy();
        expect(token?.getOwnedLabelValue("reificationInstance")).toBeFalsy();

        expect(() => clsInit(() => defineReification("wideFormula(A, B, C) = mystery(A, B, C)"))).toThrow(/mystery/);
    });
});
