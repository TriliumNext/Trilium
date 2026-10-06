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
import protectedSessionService from "./protected_session.js";
import specialNotesService from "./special_notes.js";
import { getSql } from "./sql/index.js";
import { encodeUtf8 } from "./utils/binary.js";
import dateUtils from "./utils/date.js";

const PROTECTED_KEY = encodeUtf8("0123456789abcdef");

function inboxNoteId(): string {
    return clsInit(() => specialNotesService.getInboxNote(dateUtils.localNowDate()).noteId);
}

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

    it("creates one note per attribute row, in the inbox, and repeats the call in place", () => {
        const sourceId = makeNote("Note A");
        const targetId = makeNote("Note B");

        const relation = clsInit(() => attributeService.createRelation(sourceId, "supports", targetId));
        const first = clsInit(() => reifyAttribute(relation.attributeId));

        expect(first.created).toBe(true);
        expect(first.note.title).toBe("supports(Note A, Note B)");
        expect(first.note.getParentBranches().some((branch) => branch.parentNoteId === inboxNoteId())).toBe(true);
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
            source.title = "Revised";
            source.save();
            noteService.triggerNoteTitleChanged(source);
        });

        expect(becca.getNote(note.noteId)?.title).toBe("isChildOf(Revised, Note B)");
    });

    it("lists the reification of a relation and the reifications that take it as an argument", () => {
        const alpha = makeNote("Alpha");
        const beta = makeNote("Beta");
        const gamma = makeNote("Gamma");
        const cites = clsInit(() => attributeService.createRelation(alpha, "cites", beta));
        const citesNote = clsInit(() => reifyAttribute(cites.attributeId)).note;
        const cause = clsInit(() => attributeService.createRelation(citesNote.noteId, "cause", gamma));
        const causeNote = clsInit(() => reifyAttribute(cause.attributeId)).note;

        const listed = listReificationsIncluding(cites.attributeId);
        expect(listed.map((item) => item.title)).toEqual([
            "cites(Alpha, Beta)",
            "cause(cites(Alpha, Beta), Gamma)"
        ]);
        expect(listed[0]).toMatchObject({ noteId: citesNote.noteId, direct: true });
        expect(listed[1]).toMatchObject({ noteId: causeNote.noteId, direct: false });
    });

    it("protects a reification of a protected note and does not copy the label value", () => {
        protectedSessionService.setDataKey(PROTECTED_KEY);
        try {
            const sourceId = clsInit(() => noteService.createNewNote({
                parentNoteId: "root",
                title: "Secret source",
                content: "",
                type: "text",
                isProtected: true
            }).note.noteId);
            const label = clsInit(() => attributeService.createLabel(sourceId, "confidence", "hidden-value"));
            const { note } = clsInit(() => reifyAttribute(label.attributeId));

            expect(note.isProtected).toBe(true);
            expect(note.getOwnedLabel("reificationLiteral")).toBeNull();
            const marker = note.getOwnedLabelValue("reificationGeneratedTitle");
            expect(marker).toBeTruthy();
            expect(marker).not.toContain("hidden-value");
            expect(marker).not.toContain("Secret source");

            const row = getSql().getRow<{ title: string | null; isProtected: number }>(
                "SELECT title, isProtected FROM notes WHERE noteId = ?",
                [ note.noteId ]
            );
            expect(row.isProtected).toBeTruthy();
            expect(row.title ?? "").not.toContain("hidden-value");
            expect(row.title ?? "").not.toContain("Secret source");

            const plainId = makeNote("Plain");
            const hiddenId = clsInit(() => noteService.createNewNote({
                parentNoteId: "root",
                title: "Hidden target",
                content: "",
                type: "text",
                isProtected: true
            }).note.noteId);
            const relation = clsInit(() => attributeService.createRelation(plainId, "links", hiddenId));
            const token = clsInit(() => reifyAttribute(relation.attributeId)).note;
            expect(token.isProtected).toBe(true);
            const relationRow = getSql().getRow<{ title: string | null }>(
                "SELECT title FROM notes WHERE noteId = ?",
                [ token.noteId ]
            );
            expect(relationRow.title ?? "").not.toContain("Hidden target");

            protectedSessionService.resetDataKey();
            expect(becca.getNote(note.noteId)?.getTitleOrProtected()).toBe("[protected]");
            expect(() => clsInit(() => reifyAttribute(label.attributeId))).not.toThrow();
            expect(becca.getNote(note.noteId)?.getOwnedLabel("reificationLiteral")).toBeNull();
        } finally {
            protectedSessionService.resetDataKey();
        }
    });

    it("refuses to reify a protected note without a protected session", () => {
        protectedSessionService.setDataKey(PROTECTED_KEY);
        try {
            const sourceId = clsInit(() => noteService.createNewNote({
                parentNoteId: "root",
                title: "Secret source",
                content: "",
                type: "text",
                isProtected: true
            }).note.noteId);
            const label = clsInit(() => attributeService.createLabel(sourceId, "confidence", "hidden-value"));
            protectedSessionService.resetDataKey();
            expect(() => clsInit(() => reifyAttribute(label.attributeId))).toThrow(ValidationError);
        } finally {
            protectedSessionService.resetDataKey();
        }
    });

    it("makes the relation name its own concept, apart from one instance of it", () => {
        const created = clsInit(() => createPredicateConcept("cites"));
        expect(created.created).toBe(true);
        expect(created.note.title).toBe("cites");
        expect(created.note.getOwnedLabelValue("reificationOfPredicate")).toBe("cites");
        expect(created.note.getOwnedLabelValue("iconClass")).toBe("bx bx-cube");
        expect(created.note.getParentBranches().some((branch) => branch.parentNoteId === inboxNoteId())).toBe(true);

        const again = clsInit(() => createPredicateConcept("cites"));
        expect(again.created).toBe(false);
        expect(again.note.noteId).toBe(created.note.noteId);

        const catalog = makeNote("Catalog");
        const connected = clsInit(() => connectPredicateConcept("links", catalog));
        expect(connected.created).toBe(true);
        expect(connected.note.noteId).toBe(catalog);
        expect(connected.note.getOwnedLabelValue("reificationOfPredicate")).toBe("links");

        const other = makeNote("Other");
        const kept = clsInit(() => connectPredicateConcept("links", other));
        expect(kept.note.noteId).toBe(catalog);
        expect(() => clsInit(() => connectPredicateConcept("mentions", catalog))).toThrow(ValidationError);
    });
});
