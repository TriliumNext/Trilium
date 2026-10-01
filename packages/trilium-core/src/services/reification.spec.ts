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
    listReificationsIncluding,
    reifyAttribute,
    retarget
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
});
