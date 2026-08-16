import { describe, expect, it } from "vitest";

import { init as clsInit } from "../context.js";
import noteService from "../notes.js";
import { getSql } from "../sql/index.js";
import flashcardService from "./flashcard_service.js";

function createTextNote(title: string, content = "Back content") {
    return clsInit(() => noteService.createNewNote({
        parentNoteId: "root",
        title,
        content,
        type: "text"
    }).note);
}

function runInContext<T>(fn: () => T) {
    return clsInit(fn);
}

describe("flashcard service", () => {
    it("creates one flashcard per note and adds the marker label", () => {
        const note = createTextNote("Flashcard source");

        const first = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));
        const second = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));

        expect(first.cardId).toBeTruthy();
        expect(second.cardId).toBe(first.cardId);
        expect(first.front).toBe("Flashcard source");
        expect(first.back).toBe("Back content");
        expect(note.hasLabel("flashcard")).toBe(true);

        const rowCount = getSql().getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcards
            WHERE noteId = ? AND isDeleted = 0`, [note.noteId]);
        expect(rowCount).toBe(1);
    });

    it("reviews a card and rejects stale scheduling revisions", () => {
        const note = createTextNote("Review source");
        const card = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));

        const response = runInContext(() => flashcardService.reviewCard(card.cardId, {
            rating: 3,
            expectedSchedulingRevision: card.schedulingRevision,
            clientRequestId: `${card.cardId}-good`
        }));

        expect(response.reviewId).toBeTruthy();
        expect(response.card.schedulingRevision).toBe(card.schedulingRevision + 1);

        const reviewCount = getSql().getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcard_reviews
            WHERE cardId = ?`, [card.cardId]);
        expect(reviewCount).toBe(1);

        expect(() => runInContext(() => flashcardService.reviewCard(card.cardId, {
            rating: 3,
            expectedSchedulingRevision: card.schedulingRevision,
            clientRequestId: `${card.cardId}-stale`
        }))).toThrow("Refresh before reviewing");

        const countAfterStaleReview = getSql().getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcard_reviews
            WHERE cardId = ?`, [card.cardId]);
        expect(countAfterStaleReview).toBe(1);
    });

    it("removes a note's flashcards and marker label", () => {
        const note = createTextNote("Remove source");
        const card = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));

        const response = runInContext(() => flashcardService.removeCardsForNote(note.noteId));

        expect(response.removedCount).toBe(1);
        expect(note.hasLabel("flashcard")).toBe(false);
        expect(flashcardService.getDueCards().cards.some((dueCard) => dueCard.cardId === card.cardId)).toBe(false);

        const deletedCount = getSql().getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcards
            WHERE cardId = ? AND isDeleted = 1`, [card.cardId]);
        expect(deletedCount).toBe(1);

        const recreated = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));
        expect(recreated.cardId).not.toBe(card.cardId);
        expect(note.hasLabel("flashcard")).toBe(true);
    });
});
