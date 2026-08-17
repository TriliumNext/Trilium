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

    it("returns the original result for duplicate client request IDs", () => {
        const note = createTextNote("Duplicate review source");
        const card = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));
        const clientRequestId = `${card.cardId}-duplicate`;

        const first = runInContext(() => flashcardService.reviewCard(card.cardId, {
            rating: 3,
            expectedSchedulingRevision: card.schedulingRevision,
            clientRequestId
        }));
        const duplicate = runInContext(() => flashcardService.reviewCard(card.cardId, {
            rating: 1,
            expectedSchedulingRevision: card.schedulingRevision,
            clientRequestId
        }));

        expect(duplicate.reviewId).toBe(first.reviewId);
        expect(duplicate.card.schedulingRevision).toBe(first.card.schedulingRevision);

        const reviewCount = getSql().getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcard_reviews
            WHERE cardId = ?`, [card.cardId]);
        expect(reviewCount).toBe(1);
    });

    it("rejects duplicate client request IDs from another card", () => {
        const firstNote = createTextNote("First duplicate source");
        const secondNote = createTextNote("Second duplicate source");
        const firstCard = runInContext(() => flashcardService.createCard({
            noteId: firstNote.noteId
        }));
        const secondCard = runInContext(() => flashcardService.createCard({
            noteId: secondNote.noteId
        }));
        const clientRequestId = `${firstCard.cardId}-shared`;

        runInContext(() => flashcardService.reviewCard(firstCard.cardId, {
            rating: 3,
            expectedSchedulingRevision: firstCard.schedulingRevision,
            clientRequestId
        }));

        expect(() => runInContext(() => flashcardService.reviewCard(secondCard.cardId, {
            rating: 3,
            expectedSchedulingRevision: secondCard.schedulingRevision,
            clientRequestId
        }))).toThrow("belongs to another flashcard");

        const secondReviewCount = getSql().getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcard_reviews
            WHERE cardId = ?`, [secondCard.cardId]);
        expect(secondReviewCount).toBe(0);
    });

    it("suspends, resumes, and resets a card", () => {
        const note = createTextNote("Lifecycle source");
        const card = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));

        const suspended = runInContext(() => flashcardService.setSuspended(card.cardId, {
            suspended: true,
            expectedSchedulingRevision: card.schedulingRevision
        }));
        expect(suspended.card.suspended).toBe(true);
        expect(suspended.card.schedulingRevision).toBe(card.schedulingRevision + 1);
        const dueWhileSuspended = flashcardService.getDueCards().cards
            .some((dueCard) => dueCard.cardId === card.cardId);
        expect(dueWhileSuspended).toBe(false);

        const resumed = runInContext(() => flashcardService.setSuspended(card.cardId, {
            suspended: false,
            expectedSchedulingRevision: suspended.card.schedulingRevision
        }));
        expect(resumed.card.suspended).toBe(false);

        const reviewed = runInContext(() => flashcardService.reviewCard(card.cardId, {
            rating: 3,
            expectedSchedulingRevision: resumed.card.schedulingRevision,
            clientRequestId: `${card.cardId}-before-reset`
        }));
        const reset = runInContext(() => flashcardService.resetCard(card.cardId, {
            expectedSchedulingRevision: reviewed.card.schedulingRevision
        }));

        expect(reset.card.suspended).toBe(false);
        expect(reset.card.state).toBe(0);
        expect(reset.card.schedulingRevision).toBe(reviewed.card.schedulingRevision + 1);

        const reviewCount = getSql().getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcard_reviews
            WHERE cardId = ?`, [card.cardId]);
        expect(reviewCount).toBe(1);
    });

    it("removes a note's flashcards and marker label", () => {
        const note = createTextNote("Remove source");
        const card = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));

        const response = runInContext(() => flashcardService.removeCardsForNote(note.noteId));

        expect(response.removedCount).toBe(1);
        expect(note.hasLabel("flashcard")).toBe(false);
        const isCardStillDue = flashcardService.getDueCards().cards
            .some((dueCard) => dueCard.cardId === card.cardId);
        expect(isCardStillDue).toBe(false);

        const deletedCount = getSql().getValue<number>(/*sql*/`
            SELECT COUNT(1) FROM flashcards
            WHERE cardId = ? AND isDeleted = 1`, [card.cardId]);
        expect(deletedCount).toBe(1);

        const recreated = runInContext(() => flashcardService.createCard({ noteId: note.noteId }));
        expect(recreated.cardId).not.toBe(card.cardId);
        expect(note.hasLabel("flashcard")).toBe(true);
    });
});
